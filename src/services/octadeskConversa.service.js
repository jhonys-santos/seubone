// Abre uma conversa de WhatsApp com o cliente pelo Octadesk, a partir de um ticket de Erro de Envio.
// Usa POST /chat/send-template: a conversa nasce com uma mensagem MODELO já aprovada pela Meta (sem variáveis).
// O telefone vem da Lulu (guardado em ticket_entrega.lulu.cliente quando o ticket é importado).
const db = require('../db');
const env = require('../config/env');

const txt = (v) => String(v == null ? '' : v).trim();
const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

let fetchImpl = (...a) => fetch(...a);
/** Só para testes. */
function definirFetch(fn) { fetchImpl = fn; cacheNumero = null; cacheModelo = null; }

const configurado = () => !!(env.octadeskApiUrl && env.octadeskApiKey);

/**
 * Telefone da Lulu -> "+55DDDNUMERO". Aceita 10/11 dígitos (DDD + número) e 12/13 (já com 55).
 * Devolve null se não parecer um telefone brasileiro.
 */
function normalizarTelefone(v) {
  let d = txt(v).replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  return '+55' + d;
}

/** "+5584999998888" -> "(84) 99999-8888" */
function formatarTelefone(e164) {
  const d = txt(e164).replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return txt(e164);
}

async function chamar(metodo, caminho, corpo) {
  const base = String(env.octadeskApiUrl).replace(/\/+$/, '');
  const r = await fetchImpl(base + caminho, {
    method: metodo,
    headers: { 'X-API-KEY': env.octadeskApiKey, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, corpo: j };
}

// Número de WhatsApp de origem e id do modelo: configurados por nome, resolvidos na API e guardados em memória.
let cacheNumero = null;
let cacheModelo = null;

async function numeroDeOrigem() {
  if (env.octadeskNumero) return normalizarOrigem(env.octadeskNumero);
  if (cacheNumero) return cacheNumero;
  const r = await chamar('GET', '/chat/numbers');
  const lista = Array.isArray(r.corpo) ? r.corpo : [];
  if (r.status !== 200 || !lista.length) throw new Error('Não achei um número de WhatsApp na conta do Octadesk.');
  if (lista.length > 1) throw new Error('A conta tem mais de um número de WhatsApp: defina OCTADESK_NUMERO com o que deve enviar.');
  cacheNumero = normalizarOrigem(lista[0].number);
  return cacheNumero;
}
const normalizarOrigem = (n) => '+' + txt(n).replace(/\D/g, '');

async function idDoModelo() {
  if (cacheModelo) return cacheModelo;
  const nome = env.octadeskTemplate;
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await chamar('GET', `/chat/templates-message?page=${pagina}&limit=100`);
    if (r.status !== 200) throw new Error(`O Octadesk não listou os modelos de mensagem (HTTP ${r.status}).`);
    const lista = Array.isArray(r.corpo) ? r.corpo : [];
    const m = lista.find((x) => x.name === nome);
    if (m) {
      if (m.status !== 'approved' || m.enable === false) throw new Error(`O modelo "${nome}" não está aprovado/ativo no Octadesk.`);
      cacheModelo = m.id;
      return cacheModelo;
    }
    if (lista.length < 100) break;
  }
  throw new Error(`Não achei o modelo "${nome}" no Octadesk.`);
}

/** Dados do cliente e da conversa para a tela (o telefone vem do retrato da Lulu). */
function resumoParaTela(lulu, linha) {
  const cli = (lulu && lulu.cliente) || {};
  const tel = normalizarTelefone(cli.telefone);
  return {
    configurado: configurado(),
    nome: txt(cli.nome),
    telefone: tel ? formatarTelefone(tel) : '',
    podeAbrir: configurado() && !!tel,
    motivoSemBotao: !configurado() ? 'O Octadesk ainda não está configurado no hub.' : (!tel ? 'Sem telefone do cliente nos dados da Lulu.' : ''),
    modelo: env.octadeskTemplate,
    abertaEm: linha && linha.conversa_aberta_em ? new Date(linha.conversa_aberta_em).toISOString() : null,
    abertaPor: (linha && linha.conversa_aberta_por) || '',
  };
}

const MENSAGEM_ERRO = {
  400: 'O Octadesk recusou os dados (telefone ou modelo inválido).',
  401: 'O Octadesk recusou a chave de API do hub. Avise o time técnico.',
  403: 'A chave de API do hub não tem permissão para abrir conversas.',
  404: 'O Octadesk não encontrou o recurso (confira OCTADESK_API_URL).',
  429: 'O Octadesk pediu para esperar um pouco. Tente de novo em instantes.',
};

/**
 * Abre a conversa. Se já foi aberta por este ticket, só abre de novo com `reenviar` (a tela pede a confirmação).
 * Registra quem abriu no histórico do ticket.
 */
async function abrirConversa(rowIndex, usuario, usuarioSlug, { reenviar = false } = {}) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: false, erro: 'rowIndex ausente' };
  if (!configurado()) return { ok: false, erro: 'O Octadesk ainda não está configurado no hub.' };
  const t = await db.query('select row_index::int as "rowIndex", id_ticket as "idTicket" from tickets where row_index = $1', [n]);
  if (!t.rows[0]) return { ok: false, erro: 'Ticket não encontrado.' };
  const l = await db.query('select lulu, conversa_aberta_em, conversa_aberta_por from ticket_entrega where ticket_row_index = $1', [n]);
  const linha = l.rows[0];
  const info = resumoParaTela(linha && linha.lulu, linha);
  if (!info.podeAbrir) return { ok: false, erro: info.motivoSemBotao };
  if (info.abertaEm && !reenviar) return { ok: false, jaAberta: true, abertaEm: info.abertaEm, abertaPor: info.abertaPor, erro: 'Já existe uma conversa aberta por este ticket.' };

  const telefone = normalizarTelefone(linha.lulu.cliente.telefone);
  let resp;
  try {
    const [origem, modeloId] = await Promise.all([numeroDeOrigem(), idDoModelo()]);
    resp = await chamar('POST', '/chat/send-template', {
      origin: { contact: { channel: 'whatsapp', code: origem } },
      target: { contact: { channel: 'whatsapp', code: telefone, ...(info.nome ? { name: info.nome } : {}) } },
      content: { templateMessage: { id: modeloId, variables: [] } },
      options: { automaticAssign: true },
    });
  } catch (e) {
    return { ok: false, erro: (e && e.message) || String(e) };
  }
  const roomKey = resp.corpo && resp.corpo.result && resp.corpo.result.roomKey;
  if (resp.status < 200 || resp.status >= 300 || !roomKey) {
    const detalhe = txt(resp.corpo && (resp.corpo.errorMessage || (resp.corpo.error && resp.corpo.error.message) || resp.corpo.message));
    return { ok: false, erro: MENSAGEM_ERRO[resp.status] ? MENSAGEM_ERRO[resp.status] + (detalhe && resp.status === 400 ? ` (${detalhe.slice(0, 160)})` : '') : `O Octadesk não abriu a conversa (HTTP ${resp.status}${detalhe ? ': ' + detalhe.slice(0, 160) : ''}).` };
  }

  const quem = usuario || '—';
  await db.query(
    `insert into ticket_entrega (ticket_row_index, conversa_aberta_em, conversa_aberta_por, conversa_room_key) values ($1, now(), $2, $3)
     on conflict (ticket_row_index) do update set conversa_aberta_em = now(), conversa_aberta_por = excluded.conversa_aberta_por, conversa_room_key = excluded.conversa_room_key`,
    [n, quem, roomKey],
  );
  try {
    await db.query(
      'insert into ticket_historico (ticket_row_index, id_ticket, usuario, acao, detalhe, slug) values ($1,$2,$3,$4,$5,$6)',
      [n, t.rows[0].idTicket, quem, 'Conversa aberta no Octadesk', `WhatsApp final ${telefone.slice(-4)} · modelo ${env.octadeskTemplate}${reenviar ? ' · nova abertura' : ''}`, usuarioSlug || ''],
    );
  } catch (e) { console.error('[octadesk] falha ao gravar histórico:', e.message); }
  return { ok: true, abertaEm: new Date().toISOString(), abertaPor: quem };
}

module.exports = { abrirConversa, resumoParaTela, normalizarTelefone, formatarTelefone, definirFetch, configurado };
