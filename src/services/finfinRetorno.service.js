// Retorno do finfin: o financeiro move o card para "Concluído" e o finfin chama o hub (POST /webhooks/finfin/demandas) com o
// código do card e os anexos que o financeiro colocou. O hub:
//   1) guarda os anexos no Drive (mesmo caminho das outras solicitações) e os links no recibo local (finfin_demandas);
//   2) marca o card como concluído;
//   3) avisa o solicitante UMA vez (notificação do hub).
// É idempotente: o finfin pode repetir a chamada à vontade (mesmos anexos não sobem de novo, aviso não se repete).
const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const notificacoes = require('./notificacoes.service');
const financeiroDb = require('./financeiroDb.service');

const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ANEXOS = 20;
const TIMEOUT_DOWNLOAD_MS = 30000;
const str = (v) => String(v == null ? '' : v);

// ── Segredo ──────────────────────────────────────────────────────────────────
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
/** Comparação em tempo constante. */
function segredoConfere(recebido) {
  if (!env.finfinWebhookSecret || !recebido) return false;
  return crypto.timingSafeEqual(digest(recebido), digest(env.finfinWebhookSecret));
}
/** "Authorization: Bearer <segredo>" ou "X-Webhook-Secret: <segredo>". */
function segredoDaRequisicao(req) {
  const auth = str(req.headers.authorization);
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : str(req.headers['x-webhook-secret']).trim();
}

// ── Download de anexo por link (só de hosts permitidos) ───────────────────────
let baixar = async (url, { comToken = false } = {}) => {
  const headers = {};
  if (comToken && env.finfinDemandasToken) headers.Authorization = `Bearer ${env.finfinDemandasToken}`;
  const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o anexo`);
  const tam = Number(r.headers.get('content-length') || 0);
  if (tam > MAX_ARQUIVO_BYTES) throw new Error('anexo maior que 15 MB');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_ARQUIVO_BYTES) throw new Error('anexo maior que 15 MB');
  return { buffer: buf, tipo: str(r.headers.get('content-type')).split(';')[0] };
};
/** Só para testes. */
function definirBaixar(fn) { baixar = fn; }

function hostPermitido(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const permitidos = str(env.finfinAnexosHosts).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const h = u.hostname.toLowerCase();
  return permitidos.some((p) => h === p || h.endsWith('.' + p)) ? { host: h, doFinfin: h === 'finfinsb.com.br' || h.endsWith('.finfinsb.com.br') } : null;
}

// ── Leitura do que o finfin mandou (formato tolerante: a documentação do finfin não define o webhook) ──
function normalizarEvento(b) {
  const x = b && typeof b === 'object' ? b : {};
  const card = x.card && typeof x.card === 'object' ? x.card : {};
  const col = x.coluna != null ? x.coluna : x.para != null ? x.para : card.coluna;
  const chave = (col && typeof col === 'object' ? col.chave || col.nome : col) || '';
  const anexos = Array.isArray(x.anexos) ? x.anexos : Array.isArray(card.anexos) ? card.anexos : [];
  return {
    codigo: str(x.codigo || card.codigo).trim(),
    id: str(x.id || card.id).trim(),
    chave: str(chave).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    concluidoPor: str(x.concluido_por || x.responsavel || x.por || '').trim().slice(0, 120),
    comentario: str(x.comentario || x.observacao || '').trim().slice(0, 2000),
    anexos,
  };
}
const ehConcluido = (chave) => ['concluido', 'finalizado', 'concluida'].includes(chave);

/** Cada anexo vira { nome, tipo, buffer } (conteúdo em mãos) ou { nome, tipo, url } (só o link, de host que não podemos baixar). */
async function prepararAnexos(lista) {
  if (lista.length > MAX_ANEXOS) { const e = new Error(`Máximo de ${MAX_ANEXOS} anexos por chamada.`); e.http = 422; throw e; }
  const prontos = [];
  let total = 0;
  for (const a of lista) {
    if (!a || typeof a !== 'object') continue;
    const nome = str(a.nome || a.name || 'anexo').slice(0, 200);
    const tipo = str(a.tipo || a.type || a.mime || 'application/octet-stream');
    const b64 = a.conteudo_base64 || a.base64;
    const url = str(a.url || a.link || a.download_url || '').trim();
    let buffer = null, tipoFinal = tipo;
    if (b64) {
      buffer = Buffer.from(str(b64).replace(/^data:[^,]*,/, ''), 'base64');
    } else if (url) {
      const permitido = hostPermitido(url);
      if (!permitido) { prontos.push({ nome, tipo, url, soLink: true }); continue; }
      try {
        const d = await baixar(url, { comToken: permitido.doFinfin });
        buffer = d.buffer; if (d.tipo && tipo === 'application/octet-stream') tipoFinal = d.tipo;
      } catch (e) { const er = new Error(`Não consegui baixar o anexo "${nome}": ${e.message}`); er.http = 502; throw er; }
    } else continue;
    if (!buffer.length) continue;
    if (buffer.length > MAX_ARQUIVO_BYTES) { const e = new Error(`O anexo "${nome}" passa de 15 MB.`); e.http = 422; throw e; }
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) { const e = new Error('Os anexos somados passam de 20 MB.'); e.http = 422; throw e; }
    prontos.push({ nome, tipo: tipoFinal, buffer });
  }
  return prontos;
}

// ── Processamento ────────────────────────────────────────────────────────────
/**
 * Aplica um evento do finfin. Devolve { http, corpo }. "origem": 'webhook' (o finfin chamou o hub, com anexos) ou 'consulta' (o hub descobriu
 *  consultando o finfin: marca e avisa, mas não traz arquivos).
 *  - card que não nasceu no hub (formulário público do finfin etc.): 200 { ignorado: true }, para o finfin não ficar repetindo;
 *  - coluna que não é "Concluído": só atualiza a coluna do recibo;
 *  - "Concluído": guarda anexos novos, marca concluído e avisa o solicitante uma única vez.
 */
async function processarEvento(body, { origem = 'webhook' } = {}) {
  const ev = normalizarEvento(body);
  if (!ev.codigo && !ev.id) return { http: 400, corpo: { ok: false, erro: 'Informe "codigo" (DM-…) ou "id" do card.' } };
  if (!ev.chave) return { http: 400, corpo: { ok: false, erro: 'Informe a coluna do card ("coluna": { "chave": "concluido" }).' } };

  const achado = await db.query('select ordem from finfin_demandas where (codigo <> \'\' and codigo = $1) or id_finfin = $2', [ev.codigo, ev.id]);
  if (!achado.rowCount) return { http: 200, corpo: { ok: true, ignorado: true, motivo: 'card não foi criado pelo hub' } };

  if (!ehConcluido(ev.chave)) {
    await db.query('update finfin_demandas set coluna = $2, atualizado_em = now() where ordem = $1', [achado.rows[0].ordem, ev.chave]);
    return { http: 200, corpo: { ok: true, codigo: ev.codigo, coluna: ev.chave, concluido: false } };
  }

  const prontos = await prepararAnexos(ev.anexos);
  let aviso = null, avisoAnexos = null;
  const resultado = await db.transaction(async (tx) => {
    const r = await tx.query('select * from finfin_demandas where ordem = $1 for update', [achado.rows[0].ordem]);
    const linha = r.rows[0];
    let atuais = linha.anexos_retorno;
    if (typeof atuais === 'string') { try { atuais = JSON.parse(atuais); } catch (e) { atuais = []; } }
    atuais = Array.isArray(atuais) ? atuais : [];
    const chaves = new Set(atuais.map((a) => a.hash || a.url));
    // O finfin devolve TODOS os anexos do card: o que o solicitante mandou ao criar não é "do financeiro" (mesmo hash = ignora).
    let enviadosPeloSolicitante = linha.anexos_enviados;
    if (typeof enviadosPeloSolicitante === 'string') { try { enviadosPeloSolicitante = JSON.parse(enviadosPeloSolicitante); } catch (e) { enviadosPeloSolicitante = []; } }
    for (const a of Array.isArray(enviadosPeloSolicitante) ? enviadosPeloSolicitante : []) if (a && a.hash) chaves.add(a.hash);

    // Só sobe o que ainda não temos (mesmo conteúdo = mesmo hash).
    const novos = [];
    for (const p of prontos) {
      const hash = p.buffer ? crypto.createHash('sha256').update(p.buffer).digest('hex') : null;
      const chave = hash || p.url;
      if (chaves.has(chave)) continue;
      chaves.add(chave);
      novos.push({ ...p, hash });
    }
    const paraDrive = novos.filter((n) => n.buffer);
    let enviados = [];
    if (paraDrive.length) {
      enviados = await financeiroDb.anexosProcessados('registro', paraDrive.map((n) => ({ nome: n.nome, tipo: n.tipo, base64: n.buffer.toString('base64') })));
    }
    let i = 0;
    const gravar = novos.map((n) => {
      if (!n.buffer) return { nome: n.nome, tipo: n.tipo, url: n.url, externo: true, recebido_em: new Date().toISOString() };
      const d = enviados[i++] || {};
      return { nome: d.nome || n.nome, tipo: n.tipo, url: d.url || '', downloadUrl: d.downloadUrl || '', hash: n.hash, recebido_em: new Date().toISOString() };
    });
    const todos = [...atuais, ...gravar];

    const primeiraVez = !linha.notificado_em;
    await tx.query(
      `update finfin_demandas set coluna = 'concluido', atualizado_em = now(), concluido_em = coalesce(concluido_em, now()),
              anexos_retorno = $2::json, concluido_por = case when $3 <> '' then $3 else concluido_por end,
              comentario_retorno = case when $4 <> '' then $4 else comentario_retorno end,
              notificado_em = coalesce(notificado_em, now()),
              retorno_webhook_em = case when $5 then coalesce(retorno_webhook_em, now()) else retorno_webhook_em end
        where ordem = $1`,
      [linha.ordem, JSON.stringify(todos), ev.concluidoPor, ev.comentario, origem === 'webhook'],
    );
    const dados = { slug: linha.solicitante_slug || null, codigo: linha.codigo || ev.codigo, demanda: linha.demanda };
    if (primeiraVez) aviso = { ...dados, anexos: todos.length };
    else if (gravar.length) avisoAnexos = { ...dados, novos: gravar.length };   // já tinha sido avisado da conclusão (ex.: pela consulta); agora chegaram arquivos
    return { codigo: linha.codigo || ev.codigo, anexosNovos: gravar.length, anexosTotal: todos.length, notificado: primeiraVez };
  });

  // Aviso fora da transação: se falhar, o card já está concluído (e o finfin não precisa repetir).
  if (aviso) {
    const msg = `Sua solicitação ${aviso.codigo} (${aviso.demanda}) foi concluída pelo financeiro.${aviso.anexos ? ` ${aviso.anexos} anexo(s) do financeiro.` : ''}`;
    try { await notificacoes.adicionar(msg, '/registro-demandas/novo', aviso.slug); }
    catch (e) { console.error('[finfin-retorno] card concluído, mas falhou ao criar a notificação:', e.message); }
  }
  if (avisoAnexos) {
    const msg = `O financeiro enviou ${avisoAnexos.novos} anexo(s) na solicitação ${avisoAnexos.codigo} (${avisoAnexos.demanda}).`;
    try { await notificacoes.adicionar(msg, '/registro-demandas/novo', avisoAnexos.slug); }
    catch (e) { console.error('[finfin-retorno] falhou ao avisar dos anexos:', e.message); }
  }
  return { http: 200, corpo: { ok: true, concluido: true, ...resultado } };
}

module.exports = { processarEvento, normalizarEvento, segredoConfere, segredoDaRequisicao, definirBaixar, hostPermitido, MAX_ARQUIVO_BYTES, MAX_TOTAL_BYTES };
