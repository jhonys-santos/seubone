// Reembolso x Painel de Erros: todo reembolso precisa ter o erro do pedido registrado (conferido ao vivo pelo ID da venda) ou dispensado com um motivo.
// Ligado por REEMBOLSO_EXIGE_ERRO=on (padrão: desligado). Só a dispensa é gravada (reembolso_erro_dispensa); "registrado" vem do Painel de Erros.
const db = require('../db');
const env = require('../config/env');
const errosStore = require('./errosStore');
const { registrarCaso } = require('./errosRegistro.service');
const notificacoes = require('./notificacoes.service');
const opcoes = require('../config/errosOpcoes');

const txt = (v) => String(v == null ? '' : v).trim();
const semZeros = (id) => txt(id).replace(/^0+/, '');
const BRT = -3 * 3600000;

const ligado = () => txt(env.reembolsoExigeErro).toLowerCase() === 'on';
/** "101428, 108123" -> ['101428', '108123'] (sem repetir). */
const idsDaVenda = (v) => [...new Set(txt(v).split(/[^0-9]+/).filter(Boolean))];

// ── Leitura ──────────────────────────────────────────────────────────────
async function casosPorId() {
  const r = await errosStore.listar();
  const rows = (r && (r.rows || r.data)) || [];
  const mapa = new Map();
  for (const c of rows) { const k = semZeros(c.idVenda); if (k && !mapa.has(k)) mapa.set(k, c); }
  return mapa;
}

/** Para cada ID: { idVenda, registrado, caso? } conferindo o Painel de Erros. */
async function conferir(ids) {
  const mapa = await casosPorId();
  return (ids || []).map((id) => {
    const c = mapa.get(semZeros(id));
    return c ? { idVenda: id, registrado: true, caso: { rowIndex: c.rowIndex, tipoResolucao: c.tipoResolucao || '', quemCadastrou: c.quemCadastrou || '', data: c.data || '', status: c.status || '' } } : { idVenda: id, registrado: false };
  });
}

async function dispensasDe(codigos) {
  if (!codigos.length) return new Map();
  const r = await db.query('select codigo, id_venda, motivo, por_nome, to_char(em at time zone \'America/Sao_Paulo\', \'DD/MM/YYYY\') as em from reembolso_erro_dispensa where codigo = any($1::text[])', [codigos]);
  const m = new Map(); r.rows.forEach((x) => m.set(x.codigo + '|' + semZeros(x.id_venda), x)); return m;
}

/** Situação do erro de cada reembolso: { [codigo]: [{ idVenda, estado: 'registrado'|'dispensado'|'pendente', ... }] }. */
async function situacaoDe(reembolsos) {
  const [mapa, disp] = await Promise.all([casosPorId(), dispensasDe(reembolsos.map((r) => r.codigo))]);
  const out = {};
  for (const r of reembolsos) {
    out[r.codigo] = idsDaVenda(r.idVenda).map((id) => {
      const c = mapa.get(semZeros(id));
      if (c) return { idVenda: id, estado: 'registrado', tipoResolucao: c.tipoResolucao || '', quemCadastrou: c.quemCadastrou || '', rowIndex: c.rowIndex };
      const d = disp.get(r.codigo + '|' + semZeros(id));
      if (d) return { idVenda: id, estado: 'dispensado', motivo: d.motivo, por: d.por_nome, em: d.em };
      return { idVenda: id, estado: 'pendente' };
    });
  }
  return out;
}

/** Reembolsos (reais, não negados) com algum ID de venda sem erro registrado nem dispensado. slug: só os dessa pessoa. */
async function pendentes({ slug } = {}) {
  const r = await db.query(
    `select codigo, solicitante_nome, solicitante_slug, dados, coluna, to_char(criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') as criado_em
       from finfin_demandas where formulario = 'reembolso_sac' and coalesce(modo, '') <> 'teste' and coluna <> 'negado' ${slug ? 'and solicitante_slug = $1' : ''} order by ordem`,
    slug ? [slug] : []);
  const lista = r.rows.map((x) => { const d = typeof x.dados === 'string' ? JSON.parse(x.dados || '{}') : (x.dados || {}); return { codigo: x.codigo, idVenda: d.id_venda || '', solicitante: x.solicitante_nome, slug: x.solicitante_slug, cliente: d.razao_social || '', valor: d.valor, coluna: x.coluna, criadoEm: x.criado_em }; });
  const sit = await situacaoDe(lista);
  return lista.filter((x) => sit[x.codigo].some((s) => s.estado === 'pendente')).map((x) => ({ ...x, ids: sit[x.codigo] }));
}

// ── Dispensa ─────────────────────────────────────────────────────────────
function motivoValido(m) { return txt(m).length >= 3; }

async function gravarDispensa(q, { codigo, idVenda, motivo, usuario }) {
  await q.query(
    `insert into reembolso_erro_dispensa (codigo, id_venda, motivo, por_slug, por_nome) values ($1,$2,$3,$4,$5)
     on conflict (codigo, id_venda) do update set motivo = excluded.motivo, por_slug = excluded.por_slug, por_nome = excluded.por_nome, em = now()`,
    [codigo, txt(idVenda), txt(motivo).slice(0, 300), txt(usuario.slug), txt(usuario.nome)]);
}

/** Dispensa a pedido de quem criou o reembolso (ou de um gestor), para um reembolso que já existe. */
async function dispensar({ codigo, idVenda, motivo, usuario }) {
  if (!motivoValido(motivo)) return { ok: false, erro: 'Informe o motivo (pelo menos 3 letras).' };
  const r = await db.query("select solicitante_slug, dados from finfin_demandas where codigo = $1 and formulario = 'reembolso_sac'", [txt(codigo)]);
  const x = r.rows[0];
  if (!x) return { ok: false, erro: 'Reembolso não encontrado.' };
  if (usuario.role !== 'gestor' && x.solicitante_slug !== usuario.slug) return { ok: false, erro: 'Só quem pediu o reembolso (ou um gestor) pode dispensar o erro.' };
  const d = typeof x.dados === 'string' ? JSON.parse(x.dados || '{}') : (x.dados || {});
  if (!idsDaVenda(d.id_venda).some((i) => semZeros(i) === semZeros(idVenda))) return { ok: false, erro: 'Esse ID de venda não pertence a esse reembolso.' };
  await gravarDispensa(db, { codigo: txt(codigo), idVenda, motivo, usuario });
  return { ok: true };
}

// ── Formulário de reembolso: conferir antes de enviar / gravar depois ────
/** Chamado antes de criar o card: cada ID de venda precisa ter erro registrado ou uma dispensa com motivo no corpo. */
async function validarAntesDeEnviar(corpo) {
  if (!ligado()) return { ok: true };
  const ids = idsDaVenda(corpo && corpo.idVenda);
  if (!ids.length) return { ok: true };
  const dispensas = Array.isArray(corpo.erroDispensas) ? corpo.erroDispensas : [];
  for (const c of await conferir(ids)) {
    if (c.registrado) continue;
    const d = dispensas.find((x) => semZeros(x && x.idVenda) === semZeros(c.idVenda));
    if (!d || !motivoValido(d.motivo)) return { ok: false, http: 422, erro: `A venda ${c.idVenda} ainda não tem erro registrado. Registre o erro ou marque que não será necessário (com o motivo).` };
  }
  return { ok: true };
}

/** Chamado depois que o card existe: grava as dispensas informadas, já com o código do reembolso. */
async function gravarDispensasDoEnvio(corpo, codigo, usuario) {
  if (!ligado() || !codigo) return;
  const ids = idsDaVenda(corpo && corpo.idVenda).map(semZeros);
  for (const d of Array.isArray(corpo.erroDispensas) ? corpo.erroDispensas : []) {
    if (!ids.includes(semZeros(d && d.idVenda)) || !motivoValido(d.motivo)) continue;
    try { await gravarDispensa(db, { codigo, idVenda: d.idVenda, motivo: d.motivo, usuario }); } catch (e) { console.error('[reembolso-erro] falha ao gravar a dispensa:', e.message); }
  }
}

// ── Registrar o erro pelo formulário de reembolso ────────────────────────
const OBRIGATORIOS = [['nomeCard', 'o nome do card/cliente'], ['descricao', 'a descrição do erro'], ['linkPedido', 'o link do pedido'], ['setor', 'o setor do problema'], ['responsavel', 'o responsável'], ['tipoProblema', 'o tipo de problema']];

/**
 * campos: { idVenda, nomeCard, descricao, linkPedido, setor, responsavel, tipoProblema, subproblema, qtd, tipoResolucao }, arquivos: ['data:...;base64,...'].
 * Sobe os arquivos para o Drive e registra o caso pelo mesmo caminho do Painel de Erros. Devolve { ok, rowIndex? , jaExistia? } ou { ok: false, erro }.
 */
async function registrarErro({ campos, arquivos, usuario }) {
  const c = campos || {};
  const idVenda = txt(c.idVenda);
  if (!idsDaVenda(idVenda).length) return { ok: false, erro: 'Informe o ID da venda.' };
  for (const [k, nome] of OBRIGATORIOS) if (!txt(c[k])) return { ok: false, erro: `Informe ${nome} do erro (venda ${idVenda}).` };
  const lista = (Array.isArray(arquivos) ? arquivos : []).filter((a) => typeof a === 'string' && a.startsWith('data:'));
  if (!lista.length) return { ok: false, erro: `Anexe ao menos 1 foto, áudio ou vídeo mostrando o erro (venda ${idVenda}).` };
  if ((await conferir([idVenda]))[0].registrado) return { ok: true, jaExistia: true };

  const salvos = await errosStore.salvarFotoPreCaso(lista);
  if (!salvos.ok || salvos.falhas > 0 || (salvos.urls || []).length !== lista.length) {
    return { ok: false, erro: `Não consegui salvar todos os anexos do erro (venda ${idVenda})${salvos.erroExemplo ? ': ' + salvos.erroExemplo : ''}. Tente de novo.` };
  }
  const json = await registrarCaso({
    idVenda, nomeCard: txt(c.nomeCard), descricao: txt(c.descricao), linkPedido: txt(c.linkPedido), quemCadastrou: usuario.nome, setor: txt(c.setor), responsavel: txt(c.responsavel),
    tipoProblema: txt(c.tipoProblema), subproblema: txt(c.subproblema), qtd: txt(c.qtd) === '' ? '' : Number(c.qtd), tipoResolucao: txt(c.tipoResolucao) || 'Reembolso total',
    auditoria: false, status: 'novo', fotosUrls: salvos.urls,
  }, usuario);
  if (!json.ok && json.duplicado) return { ok: true, jaExistia: true };
  return json.ok ? { ok: true, rowIndex: json.rowIndex, ticketRefab: json.ticketRefab } : { ok: false, erro: json.error || json.erro || 'Não consegui registrar o erro.' };
}

// ── Opções do formulário ─────────────────────────────────────────────────
async function opcoesDoFormulario() {
  const r = await errosStore.listar();
  const rows = (r && (r.rows || r.data)) || [];
  const distintos = (campo) => [...new Set(rows.map((x) => txt(x[campo])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { ...opcoes, causas: distintos('tipoProblema'), detalhes: distintos('subproblema') };
}

// ── Aviso diário no sino ─────────────────────────────────────────────────
function agoraBrasilia(agora = Date.now()) {
  const d = new Date(agora + BRT);
  return { dia: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hora: d.getUTCHours() };
}

/** Uma vez por dia útil (08h-18h, Brasília), avisa cada solicitante com reembolsos sem erro. Devolve quantas pessoas foram avisadas. */
async function avisarPendentes(agora = Date.now()) {
  if (!ligado()) return 0;
  const t = agoraBrasilia(agora);
  if (t.dow === 0 || t.dow === 6 || t.hora < 8 || t.hora >= 18) return 0;
  const porPessoa = new Map();
  for (const p of await pendentes()) { if (p.slug) (porPessoa.get(p.slug) || porPessoa.set(p.slug, []).get(p.slug)).push(p.codigo); }
  let avisados = 0;
  for (const [slug, codigos] of porPessoa) {
    const novo = await db.query('insert into reembolso_erro_aviso (slug, dia, qtd) values ($1, $2::date, $3) on conflict (slug, dia) do nothing returning slug', [slug, t.dia, codigos.length]);
    if (!novo.rowCount) continue;
    const lista = codigos.slice(0, 6).join(', ') + (codigos.length > 6 ? '...' : '');
    await notificacoes.adicionar(`Você tem ${codigos.length} reembolso(s) sem o erro registrado: ${lista}. Registre o erro ou marque que não será necessário.`, '/registro-demandas/historico-reembolso', slug);
    avisados++;
  }
  return avisados;
}

let relogio = null;
function iniciarAvisoPendentes() {
  if (relogio) return;
  const rodar = () => avisarPendentes().catch((e) => console.error('[reembolso-erro] falha no aviso diário:', e.message));
  setTimeout(rodar, 60 * 1000);
  relogio = setInterval(rodar, 30 * 60 * 1000);
}

module.exports = {
  ligado, idsDaVenda, conferir, situacaoDe, pendentes, dispensar, validarAntesDeEnviar, gravarDispensasDoEnvio, registrarErro, opcoesDoFormulario,
  avisarPendentes, iniciarAvisoPendentes, motivoValido,
};
