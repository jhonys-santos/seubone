// Integração com o módulo Demandas do finfin (Grupo SB): kanban "Envio de demandas - Gerais" da SeuBoné.
// Documentação: api-demandas-seubone-gerais.md (finfin). Autenticação: "Authorization: Bearer <token>" (nunca na URL).
//
// Esta peça só ENVIA/CONSULTA/MOVE cards. Ela NÃO está ligada ao Registro do hub: o Registro continua gravando como sempre e
// avisando o n8n. A ligação (enviar o mesmo registro para o finfin) entra depois que os testes isolados estiverem 100%.
const crypto = require('crypto');
const env = require('../config/env');

const MAX_ANEXOS = 10;
const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024;   // por arquivo
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;      // somados, por pedido (o limite do hub é 20 MB: acima de 4 MB vão só os links do Drive)
const TIMEOUT_MS = 20000;

const str = (v) => String(v == null ? '' : v);
const normalizar = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ── HTTP ─────────────────────────────────────────────────────────────────────
let http = (url, init) => fetch(url, init);
/** Só para testes. */
function definirHttp(fn) { http = fn; }

const configurado = () => !!env.finfinDemandasToken;

async function chamar(metodo, { query = null, corpo = null } = {}) {
  if (!env.finfinDemandasToken) throw new Error('FINFIN_DEMANDAS_TOKEN não configurado.');
  const url = new URL(env.finfinDemandasUrl);
  if (query) Object.entries(query).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  const init = { method: metodo, headers: { Authorization: `Bearer ${env.finfinDemandasToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (corpo) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corpo); }
  const resp = await http(url.toString(), init);
  const texto = await resp.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* resposta que não é JSON */ }
  return { status: resp.status, json, texto: json ? null : texto.slice(0, 300) };
}

/** Resultado padronizado: { ok, status, ...corpo } ; em erro traz "erro" (texto) e "erros" (campo -> mensagem) quando o finfin devolve. */
function resultado(r) {
  const j = r.json || {};
  if (r.status >= 200 && r.status < 300 && j.ok !== false) return { ok: true, status: r.status, ...j };
  const erro = r.status === 401 ? 'Token recusado pelo finfin (401).'
    : r.status === 429 ? 'Limite de requisições do finfin atingido (429): tente de novo em instantes.'
    : r.status === 422 ? 'O finfin recusou os dados (422).'
    : j.erro || j.error || (r.texto ? `Resposta inesperada do finfin (HTTP ${r.status}).` : `Falha no finfin (HTTP ${r.status}).`);
  return { ok: false, status: r.status, erro, erros: j.erros || null };
}

const criarCard = async (payload) => resultado(await chamar('POST', { corpo: payload }));
const consultarCard = async (codigo) => resultado(await chamar('GET', { query: { codigo } }));
const moverCard = async (codigo, coluna) => resultado(await chamar('PATCH', { corpo: { codigo, coluna } }));
/** Lista de nomes de demanda aceitos hoje (aba "Tipos de demanda" do finfin): GET ?listas=1. Devolve o JSON cru em "bruto". */
async function listarDemandas() {
  const r = resultado(await chamar('GET', { query: { listas: '1' } }));
  return { ...r, nomes: r.ok ? extrairNomesDemandas(r) : [], bruto: r };
}

/** O formato exato do GET ?listas=1 não está na documentação: procura, em qualquer ponto do JSON, a lista que contém "NF Urgente". */
function extrairNomesDemandas(json) {
  const texto = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str(x.nome || x.name || x.label || x.valor || x.value || x.titulo || '') : '');
  let achado = null;
  (function varrer(no, profundidade) {
    if (achado || profundidade > 6 || no == null) return;
    if (Array.isArray(no)) {
      const nomes = no.map(texto).filter(Boolean);
      if (nomes.length && nomes.some((n) => normalizar(n) === 'nf urgente')) { achado = nomes; return; }
      no.forEach((x) => varrer(x, profundidade + 1));
    } else if (typeof no === 'object') Object.values(no).forEach((x) => varrer(x, profundidade + 1));
  })(json, 0);
  return achado || [];
}

// ── Tradução do Registro do hub para o card do finfin ────────────────────────
/** Id estável (UUID) do card a partir do id do registro: reenviar o mesmo registro nunca duplica o card. */
function uuidDoRegistro(idRegistro) {
  const h = crypto.createHash('sha1').update('seubone-hub:registro-demandas:' + str(idRegistro)).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;   // versão 5, variante RFC 4122
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Acha, na lista do finfin, o nome da demanda que corresponde ao do hub (igual, ou igual sem acento/caixa). null se não houver. */
function resolverDemanda(nomeHub, listaFinfin, aliases = {}) {
  const alvo = normalizar(aliases[nomeHub] || nomeHub);
  if (!Array.isArray(listaFinfin) || !listaFinfin.length) return str(aliases[nomeHub] || nomeHub);   // sem lista: manda como está
  return listaFinfin.find((n) => normalizar(n) === alvo) || null;
}

const dataBr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso)); return m ? `${m[3]}/${m[2]}/${m[1]}` : str(iso); };
const cortar = (s, n) => (str(s).length > n ? str(s).slice(0, n - 1).trimEnd() + '…' : str(s));

/**
 * Monta o corpo do POST a partir de um registro do hub.
 * registro: { id (RD…), solicitante, email, numeroCorporativo, demandaSolicitada, tipoDemanda, empresa, data, dataVencimento,
 *             idCompra, linkCard, observacao, anexos: [{ nome, tipo, base64 }], anexosDrive?: [url…] }
 * opcoes:   { demandasFinfin: [nomes aceitos], aliases: { nomeNoHub: nomeNoFinfin }, prefixoTitulo: '[TESTE] ' }
 * Devolve { payload, avisos, erros } — "erros" não vazio = não dá para enviar (ex.: demanda inexistente no finfin).
 */
function montarCard(registro, opcoes = {}) {
  const avisos = [], erros = [];
  const r = registro || {};
  const demanda = resolverDemanda(r.demandaSolicitada, opcoes.demandasFinfin, opcoes.aliases || {});
  if (!demanda) erros.push(`A demanda "${r.demandaSolicitada}" não existe na lista do finfin (veja finfin-testar --listas e informe o equivalente em aliases).`);
  const nome = cortar(str(r.solicitante).trim(), 120);
  if (!nome) erros.push('Solicitante vazio.');
  if (!str(r.email).trim()) erros.push('E-mail do solicitante vazio.');
  if (!str(r.observacao).trim()) erros.push('Descrição vazia.');

  let link = str(r.linkCard).trim();
  if (/^http:\/\//i.test(link)) { link = 'https://' + link.slice(7); avisos.push('O link do card era http:// e foi enviado como https://.'); }
  if (!/^https:\/\//i.test(link)) erros.push('O link do card precisa começar com https:// (o finfin exige link do Lulu na SeuBoné).');

  const linhas = [
    `ID da venda: ${str(r.idCompra).trim()}`,
    `Data de vencimento: ${dataBr(r.dataVencimento)}`,
    `Data da solicitação: ${dataBr(r.data)}`,
    `Tipo de demanda: ${str(r.tipoDemanda).trim()}`,
    `Empresa solicitante: ${str(r.empresa).trim()}`,
    `Origem: Hub SeuBoné${r.id ? ' (' + r.id + ')' : ''}`,
  ];

  const campos = {
    solicitante_nome: nome,
    solicitante_email: str(r.email).trim(),
    demanda_solicitada: demanda || str(r.demandaSolicitada),
    titulo: cortar(`${opcoes.prefixoTitulo || ''}${nome} - ${demanda || str(r.demandaSolicitada)} - Venda ${str(r.idCompra).trim()}`, 200),
    descricao: '',
    link_lulu: link,
  };
  if (str(r.numeroCorporativo).trim()) campos.telefone = str(r.numeroCorporativo).trim();
  if (normalizar(campos.demanda_solicitada) === 'outros') campos.especificacao = 'Ver descrição';

  // Anexos: vão como arquivo se couberem nos limites do finfin; senão vão só os links do Drive (o hub guarda os arquivos no Drive).
  const arquivos = Array.isArray(r.anexos) ? r.anexos.filter((a) => a && (a.base64 || a.conteudo_base64)) : [];
  const tamanhos = arquivos.map((a) => Math.floor(str(a.base64 || a.conteudo_base64).length * 0.75));
  const total = tamanhos.reduce((s, n) => s + n, 0);
  const cabe = arquivos.length <= MAX_ANEXOS && tamanhos.every((n) => n <= MAX_ARQUIVO_BYTES) && total <= MAX_TOTAL_BYTES;
  const links = Array.isArray(r.anexosDrive) ? r.anexosDrive.map((x) => (typeof x === 'string' ? x : x && (x.url || x.link) ? (x.nome ? str(x.nome) + ': ' : '') + str(x.url || x.link) : '')).filter(Boolean) : [];
  const anexos = cabe ? arquivos.map((a) => ({ nome: str(a.nome || 'arquivo'), tipo: str(a.tipo || 'application/octet-stream'), conteudo_base64: str(a.base64 || a.conteudo_base64) })) : [];
  if (arquivos.length && !cabe) {
    avisos.push(`Anexos acima do limite do finfin (${arquivos.length} arquivo(s), ~${(total / 1048576).toFixed(1)} MB; máx. ${MAX_ANEXOS} arquivos, ${MAX_TOTAL_BYTES / 1048576} MB somados): enviados só como links.`);
    if (!links.length) avisos.push('Sem links do Drive para listar: os anexos não irão no card.');
  }
  if (links.length && (!cabe || !arquivos.length)) linhas.push('', 'Anexos (Drive):', ...links.map((u) => '- ' + u));
  campos.descricao = linhas.join('\n') + '\n\n' + str(r.observacao).trim();

  const payload = { id: uuidDoRegistro(r.id || `${r.idCompra}|${r.solicitante}|${r.data}`), empresa: 'seubone', formulario: 'gerais', campos };
  if (anexos.length) payload.anexos = anexos;
  return { payload, avisos, erros };
}

module.exports = {
  configurado, criarCard, consultarCard, moverCard, listarDemandas, extrairNomesDemandas,
  montarCard, resolverDemanda, uuidDoRegistro, normalizar, definirHttp, MAX_ANEXOS, MAX_ARQUIVO_BYTES, MAX_TOTAL_BYTES,
};
