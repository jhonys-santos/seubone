// Painel de Tickets em Postgres (Supabase). Cada função devolve EXATAMENTE o
// mesmo JSON que o Apps Script devolvia (apps-script/tickets/Code.gs), pra
// tela e os outros painéis não perceberem a troca. As regras de negócio
// (status, dedupe, anexos, histórico) foram portadas de lá, uma a uma.
const db = require('../db');

const AGORA_BRASILIA = "(now() at time zone 'America/Sao_Paulo')";
const FMT_ISO = `'YYYY-MM-DD"T"HH24:MI:SS'`;
const STATUS_ABERTO = 'Aberto';
const STATUS_RESOLVIDO = 'Resolvido';

const txt = (v) => String(v == null ? '' : v).trim();

/**
 * Aceita o que chega de fora (input date "2026-10-05", ISO com ou sem fuso,
 * dd/mm/aaaa) e devolve "YYYY-MM-DD HH:MM:SS" na hora de Brasília, ou null.
 * Data sem hora vira meia-noite, como a planilha fazia.
 */
function paraTimestampBrasilia(v) {
  const s = txt(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const b = new Date(d.getTime() - 3 * 3600000); // Brasília, UTC-3 fixo (sem horário de verão desde 2019)
    return b.toISOString().slice(0, 19).replace('T', ' ');
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]} 00:00:00`;
  return null;
}

const COLUNAS_LISTA = `
  row_index::int as "rowIndex", id_ticket as "idTicket", pedido, id_venda as "idVenda", identificador, fabrica, setor,
  responsavel, responsavel_slug as "responsavelSlug",
  coalesce(nullif(trim(status), ''), '${STATUS_ABERTO}') as status,
  to_char(data_abertura, ${FMT_ISO}) as "dataAbertura", to_char(data_fechamento, ${FMT_ISO}) as "dataFechamento",
  origem, link, observacao, anexos,
  tem_evento as "temEvento", to_char(data_evento, ${FMT_ISO}) as "dataEvento", entrega, aeroporto,
  to_char(ppe, ${FMT_ISO}) as ppe, to_char(previsao_finalizacao, ${FMT_ISO}) as "previsaoFinalizacao",
  to_char(p_folha, ${FMT_ISO}) as "pFolha", to_char(novo_prazo, ${FMT_ISO}) as "novoPrazo",
  atraso_notificado as "atrasoNotificado", negocio_id as "negocioId", codigo_rastreio as "codigoRastreio",
  to_char(previsao_entrega_transportadora, ${FMT_ISO}) as "previsaoEntregaTransportadora"`;

/** Nulo de data vira '' (a planilha devolvia vazio). */
function paraContrato(linha) {
  const o = { ...linha };
  ['dataAbertura', 'dataFechamento', 'dataEvento', 'ppe', 'previsaoFinalizacao', 'pFolha', 'novoPrazo', 'previsaoEntregaTransportadora']
    .forEach((k) => { if (o[k] == null) o[k] = ''; });
  return o;
}

// ── Upload de arquivos (continua no Google Drive, via Apps Script) ───────
let uploader = async (fotos, idTicket) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const env = require('../config/env');
  const r = await chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body: { action: 'salvarFotos', fotos, idTicket } });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Falha ao salvar no Drive');
  return r.urls || '';
};
/** Só para testes. */
function definirUploader(fn) { uploader = fn; }

// ── Histórico ────────────────────────────────────────────────────────────
async function logHist(q, rowIndex, idTicket, usuario, acao, detalhe, slug) {
  try {
    await q.query(
      'insert into ticket_historico (ticket_row_index, id_ticket, usuario, acao, detalhe, slug) values ($1,$2,$3,$4,$5,$6)',
      [rowIndex, idTicket || '', usuario || '—', acao || '', detalhe || '', slug || ''],
    );
  } catch (e) {
    // Mesma regra do Apps Script: histórico nunca derruba a ação principal.
    console.error('[tickets-db] falha ao gravar histórico:', e.message);
  }
}

const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);
const faltou = { ok: false, error: 'rowIndex ausente' };
const naoAchou = { ok: false, error: 'Ticket não encontrado.' };

// ── Leitura ──────────────────────────────────────────────────────────────
async function listar() {
  const r = await db.query(`select ${COLUNAS_LISTA} from tickets order by row_index`);
  return { ok: true, tickets: r.rows.map(paraContrato) };
}

async function historico(rowIndex) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: true, eventos: [] };
  const r = await db.query(
    `select to_char(quando, 'DD/MM/YYYY HH24:MI') as quando, usuario, acao, detalhe
       from ticket_historico where ticket_row_index = $1 order by id desc`,
    [n],
  );
  return { ok: true, eventos: r.rows };
}

// ── Escrita ──────────────────────────────────────────────────────────────
async function criar(f) {
  const identificador = txt(f.identificador);
  if (!identificador) return { ok: false, error: 'Identificador é obrigatório.' };
  const negocioId = txt(f.negocioId);

  const buscarExistente = async (q) => {
    const e = await q.query(
      'select row_index::int as "rowIndex", id_ticket as "idTicket" from tickets where negocio_id = $1 and lower(identificador) = lower($2) limit 1',
      [negocioId, identificador],
    );
    return e.rows[0] || null;
  };

  let criado;
  try {
    criado = await db.transaction(async (tx) => {
      if (negocioId) {
        // Serializa criações do mesmo negócio+identificador (a garantia final é o índice único 002).
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${negocioId}|${identificador.toLowerCase()}`]);
        const ja = await buscarExistente(tx);
        if (ja) return { ok: true, rowIndex: ja.rowIndex, idTicket: ja.idTicket, jaExistia: true };
      }
      const seq = await tx.query("select nextval(pg_get_serial_sequence('tickets', 'row_index')) as n");
      const rowIndex = Number(seq.rows[0].n);
      // "T" + (linha - 1), como na planilha; se esse rótulo já existir (dados antigos
      // tinham ids fora do padrão), sobe até achar um livre.
      let numero = rowIndex - 1;
      let idTicket = 'T' + String(numero).padStart(5, '0');
      while ((await tx.query('select 1 from tickets where id_ticket = $1 limit 1', [idTicket])).rows.length) {
        numero += 1;
        idTicket = 'T' + String(numero).padStart(5, '0');
      }
      await tx.query(
        `insert into tickets (row_index, id_ticket, pedido, id_venda, identificador, fabrica, responsavel, responsavel_slug,
                              status, data_abertura, origem, link, observacao, negocio_id, ppe, previsao_finalizacao, p_folha,
                              codigo_rastreio, previsao_entrega_transportadora)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${AGORA_BRASILIA}, $10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [rowIndex, idTicket, txt(f.pedido), txt(f.idVenda), identificador, txt(f.fabrica), txt(f.responsavel), txt(f.responsavelSlug),
          STATUS_ABERTO, txt(f.origem) || 'manual', txt(f.link), txt(f.observacao), negocioId,
          paraTimestampBrasilia(f.ppe), paraTimestampBrasilia(f.previsaoFinalizacao), paraTimestampBrasilia(f.pFolha),
          txt(f.codigoRastreio), paraTimestampBrasilia(f.previsaoEntregaTransportadora)],
      );
      await logHist(tx, rowIndex, idTicket, f.usuario || (f.origem === 'n8n' ? 'n8n' : ''), 'Ticket aberto',
        [identificador, txt(f.fabrica)].filter(Boolean).join(' · '), f.usuarioSlug);
      return { ok: true, rowIndex, idTicket };
    });
  } catch (e) {
    if (e && e.code === '23505' && negocioId) { // outro processo criou o mesmo negócio+identificador agora
      const ja = await buscarExistente(db);
      if (ja) return { ok: true, rowIndex: ja.rowIndex, idTicket: ja.idTicket, jaExistia: true };
    }
    throw e;
  }

  if (!criado.jaExistia && f.fotos && f.fotos.length) {
    try {
      const links = await uploader(f.fotos, criado.idTicket);
      if (links) await db.query('update tickets set anexos = $2 where row_index = $1', [criado.rowIndex, links]);
    } catch (e) {
      await logHist(db, criado.rowIndex, criado.idTicket, f.usuario, 'Falha ao salvar anexos', String((e && e.message) || e), f.usuarioSlug);
    }
  }
  return criado;
}

/** UPDATE de uma coluna + histórico. `quando` do UPDATE: lê id_ticket pelo RETURNING. */
async function atualizarCampos(f, sets, params, acao, detalhe, extra) {
  const n = inteiro(f.rowIndex);
  if (n == null) return faltou;
  const r = await db.query(
    `update tickets set ${sets} where row_index = $1 returning id_ticket as "idTicket"`,
    [n, ...params],
  );
  if (!r.rows.length) return naoAchou;
  const idTicket = r.rows[0].idTicket;
  await logHist(db, n, idTicket, f.usuario, acao, detalhe, f.usuarioSlug);
  return { ok: true, rowIndex: n, idTicket, ...(extra || {}) };
}

async function atribuir(f) {
  return atualizarCampos(f, 'responsavel = $2, responsavel_slug = $3', [txt(f.responsavel), txt(f.responsavelSlug)],
    'Responsável atribuído', f.responsavel || '');
}

async function definirLink(f) {
  const texto = txt(f.link);
  if (!inteiro(f.rowIndex)) return faltou;
  if (!texto) return { ok: false, error: 'Link vazio.' };
  return atualizarCampos(f, 'link = $2', [texto], 'Link adicionado', texto, { link: texto });
}

async function atualizarFabrica(f) {
  const texto = txt(f.fabrica);
  return atualizarCampos(f, 'fabrica = $2', [texto], 'Fábrica atualizada', texto || '(vazio)', { fabrica: texto });
}

async function atualizarSetor(f) {
  const texto = txt(f.setor);
  return atualizarCampos(f, 'setor = $2', [texto], 'Setor atualizado', texto || '(vazio)', { setor: texto });
}

async function atualizarNovoPrazo(f) {
  const valor = txt(f.novoPrazo);
  return atualizarCampos(f, 'novo_prazo = $2', [paraTimestampBrasilia(valor)], 'Novo prazo definido', valor || '(vazio)', { novoPrazo: valor });
}

async function atualizarAcompanhamento(f) {
  const temEvento = !!f.temEvento;
  const sets = ['tem_evento = $2', 'data_evento = $3', 'entrega = $4', 'aeroporto = $5'];
  const params = [temEvento, temEvento ? paraTimestampBrasilia(f.dataEvento) : null, txt(f.entrega), f.entrega === 'Aeroporto' ? txt(f.aeroporto) : ''];
  if (f.setor !== undefined) { sets.push('setor = $6'); params.push(txt(f.setor)); }
  const detalhe = [temEvento ? 'evento em ' + (f.dataEvento || '?') : '', f.entrega, f.setor ? 'setor: ' + f.setor : ''].filter(Boolean).join(' · ');
  return atualizarCampos(f, sets.join(', '), params, 'Acompanhamento atualizado', detalhe);
}

async function mudarStatus(f) {
  const n = inteiro(f.rowIndex);
  if (n == null || !f.status) return { ok: false, error: 'rowIndex/status ausente' };
  const status = txt(f.status);
  return db.transaction(async (tx) => {
    const atual = await tx.query('select status, id_ticket from tickets where row_index = $1 for update', [n]);
    if (!atual.rows.length) return naoAchou;
    const statusAtual = txt(atual.rows[0].status);
    const idTicket = atual.rows[0].id_ticket;
    if (statusAtual === STATUS_RESOLVIDO && status === STATUS_RESOLVIDO) return { ok: false, error: 'Esse ticket já está resolvido.' };

    let fechamento = 'data_fechamento';
    if (status === STATUS_RESOLVIDO) fechamento = AGORA_BRASILIA;
    else if (statusAtual === STATUS_RESOLVIDO) fechamento = 'null'; // reabriu: não deixa data de fechamento velha
    await tx.query(`update tickets set status = $2, data_fechamento = ${fechamento} where row_index = $1`, [n, status]);
    await logHist(tx, n, idTicket, f.usuario, 'Status alterado', `${statusAtual} → ${status}`, f.usuarioSlug);
    return { ok: true, rowIndex: n, idTicket, status };
  });
}

async function comentar(f) {
  const n = inteiro(f.rowIndex);
  if (n == null) return faltou;
  const texto = txt(f.comentario);
  if (!texto) return { ok: false, error: 'Comentário vazio.' };
  const r = await db.query('select id_ticket from tickets where row_index = $1', [n]);
  if (!r.rows.length) return naoAchou;
  await logHist(db, n, r.rows[0].id_ticket, f.usuario, 'Comentário', texto, f.usuarioSlug);
  return { ok: true, rowIndex: n, idTicket: r.rows[0].id_ticket };
}

async function adicionarAnexos(f) {
  const n = inteiro(f.rowIndex);
  if (n == null) return faltou;
  if (!f.fotos || !f.fotos.length) return { ok: false, error: 'Nenhum arquivo enviado.' };
  const t = await db.query('select id_ticket from tickets where row_index = $1', [n]);
  if (!t.rows.length) return naoAchou;
  const idTicket = t.rows[0].id_ticket;

  let novos = '';
  try { novos = await uploader(f.fotos, idTicket); } catch (e) { novos = ''; }
  if (!novos) return { ok: false, error: 'Não consegui salvar os arquivos.' };

  // Sempre acrescenta (nunca substitui), de forma atômica: dois anexos ao mesmo tempo não se perdem.
  const r = await db.query(
    `update tickets set anexos = case when trim(anexos) = '' then $2 else trim(anexos) || ',' || $2 end
      where row_index = $1 returning anexos`,
    [n, novos],
  );
  await logHist(db, n, idTicket, f.usuario, 'Anexo(s) adicionado(s)', `${f.fotos.length} arquivo(s)`, f.usuarioSlug);
  return { ok: true, rowIndex: n, idTicket, anexos: r.rows[0].anexos };
}

async function removerAnexo(f) {
  const n = inteiro(f.rowIndex);
  if (n == null) return faltou;
  if (!f.url) return { ok: false, error: 'Anexo não informado.' };
  return db.transaction(async (tx) => {
    const r = await tx.query('select anexos, id_ticket from tickets where row_index = $1 for update', [n]);
    if (!r.rows.length) return naoAchou;
    const restantes = txt(r.rows[0].anexos).split(',').map((s) => s.trim()).filter((s) => s && s !== f.url);
    const combinado = restantes.join(',');
    await tx.query('update tickets set anexos = $2 where row_index = $1', [n, combinado]);
    await logHist(tx, n, r.rows[0].id_ticket, f.usuario, 'Anexo removido', '', f.usuarioSlug);
    return { ok: true, rowIndex: n, idTicket: r.rows[0].id_ticket, anexos: combinado };
  });
}

async function marcarAtrasoNotificado(f) {
  const n = inteiro(f.rowIndex);
  if (n == null) return faltou;
  const r = await db.query('update tickets set atraso_notificado = $2 where row_index = $1', [n, !!f.notificado]);
  if (!r.rowCount) return naoAchou;
  return { ok: true, rowIndex: n }; // controle interno: não gera histórico
}

module.exports = {
  listar, historico, criar, atribuir, mudarStatus, comentar, adicionarAnexos, removerAnexo,
  atualizarFabrica, atualizarSetor, atualizarNovoPrazo, atualizarAcompanhamento, definirLink, marcarAtrasoNotificado,
  definirUploader, paraTimestampBrasilia,
};
