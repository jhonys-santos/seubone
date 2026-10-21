// e-Minutas LATAM que estão nos cards do Lulu: lê os cards pela API de integração (header x-integracao-key) e guarda os de transportadora LATAM no registro
// do Histórico (latam_emissoes, origem 'lulu').
//
// Hoje a API só entrega os cards da coluna "Alerta de Entrega" (LULU_ALERTA_ENTREGA_URL). Quando o Lulu liberar um endpoint para a coluna "Código de rastreio"
// (mesmo formato de card), basta configurar LULU_CODIGO_RASTREIO_URL: os dois são lidos e juntados.
const env = require('../config/env');
const emissoes = require('./latamEmissoes.service');

const PAGINAS_MAX = 40;

const urlsConfiguradas = () => [env.luluAlertaEntregaUrl, env.luluCodigoRastreioUrl].filter(Boolean);
const configurado = () => !!(env.luluIntegracaoKey && urlsConfiguradas().length);

let http = (url, init) => fetch(url, init);
/** Só para testes. */
function definirHttp(fn) { http = fn; }

async function buscarPaginas(urlBase) {
  const cards = [];
  for (let page = 1; page <= PAGINAS_MAX; page++) {
    const url = new URL(urlBase);
    url.searchParams.set('page', page);
    const resp = await http(url.toString(), { headers: { 'x-integracao-key': env.luluIntegracaoKey }, signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`Lulu respondeu HTTP ${resp.status}`);
    const json = await resp.json();
    cards.push(...(json.data || []));
    if (page >= ((json.meta && json.meta.totalPages) || 1)) break;
  }
  return cards;
}

/** Todos os cards das URLs configuradas, sem repetir o mesmo card. */
async function buscarCards() {
  const vistos = new Map();
  for (const u of urlsConfiguradas()) {
    for (const c of await buscarPaginas(u)) vistos.set(c.card_id || `${c.negocio_id}|${c.codigo_rastreio}`, c);
  }
  return [...vistos.values()];
}

/** Lê os cards do Lulu e guarda as e-Minutas LATAM no histórico. Devolve { lidos, latam, novos, atualizados, semCodigo }. */
async function puxar() {
  if (!configurado()) { const e = new Error('Integração com o Lulu sem configuração (LULU_INTEGRACAO_KEY).'); e.tipo = 'CREDENCIAL'; throw e; }
  let cards;
  try { cards = await buscarCards(); } catch (err) { const e = new Error('Não consegui ler os cards do Lulu agora: ' + err.message); e.tipo = 'INDISPONIVEL'; throw e; }
  return { lidos: cards.length, ...(await emissoes.importarCardsLulu(cards)) };
}

module.exports = { puxar, buscarCards, configurado, definirHttp };
