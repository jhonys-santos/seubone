const env = require('./../config/env');
const { chamarAppsScript } = require('./appsScriptClient');

// Importa os cards que estão na coluna "Alerta de Entrega" da Lulu (atraso,
// extravio, retido fiscal, tentativa de entrega falhou etc.) e abre um
// Ticket "Erro de Envio" pra cada negócio que ainda não tem um — mesmo
// espírito do ticketsImportLulu.service.js (Pedido atrasado), só que aqui
// TODO card devolvido pelo endpoint conta (não filtramos por "situacao":
// o próprio fato de estar nessa coluna já é o critério, por decisão
// explícita — mesmo um card já marcado ENTREGUE ali dentro ainda precisa
// de acompanhamento até sair da coluna).
const PAGINAS_MAX = 20; // trava de segurança — o endpoint é paginado, mas nunca deve chegar nem perto disso

// Roda 2x por dia (07h e 13h, horário de Brasília) — mesmo horário do
// importador de Pedido atrasado, por simplicidade (mesmo espírito: cedo,
// antes de decisões do dia, e no meio da tarde). Fuso fixo (UTC-3): Brasil
// não tem mais horário de verão desde 2019.
const HORARIOS_EXECUCAO_BRASILIA = [7, 13];
const FUSO_BRASILIA_OFFSET_HORAS = -3;

function proximaExecucaoTs_() {
  const agora = Date.now();
  const d = new Date(agora);
  const candidatos = HORARIOS_EXECUCAO_BRASILIA.map((horaBrasilia) => {
    let alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), horaBrasilia - FUSO_BRASILIA_OFFSET_HORAS, 0, 0, 0);
    if (alvo <= agora) alvo += 24 * 60 * 60 * 1000;
    return alvo;
  });
  return Math.min(...candidatos);
}

async function buscarCardsAlertaEntrega() {
  const cards = [];
  for (let page = 1; page <= PAGINAS_MAX; page++) {
    const url = new URL(env.luluAlertaEntregaUrl);
    url.searchParams.set('page', page);
    const resp = await fetch(url, { headers: { 'x-integracao-key': env.luluIntegracaoKey } });
    if (!resp.ok) {
      console.error('[tickets-erro-envio] falha ao consultar page=' + page + ': HTTP ' + resp.status);
      break;
    }
    const json = await resp.json();
    const pagina = json.data || [];
    cards.push(...pagina);
    const totalPages = (json.meta && json.meta.totalPages) || 1;
    if (page >= totalPages) break;
  }
  return cards;
}

// Junta as ocorrências do card (cada uma com categoria/descrição/local/data)
// num texto só, por decisão do usuário — sem tentar categorizar/estruturar
// isso no ticket por enquanto.
function montarObservacao_(card) {
  const alertas = card.alertas || [];
  const linhas = alertas.map((a) => {
    const quando = a.ocorrida_em ? new Date(a.ocorrida_em).toLocaleDateString('pt-BR') : '';
    const partes = [a.categoria, a.descricao, a.local, quando].filter(Boolean);
    return '- ' + partes.join(' · ');
  });
  const cabecalho = 'Situação: ' + (card.situacao || '—') + '.';
  return linhas.length ? cabecalho + '\n' + linhas.join('\n') : cabecalho;
}

const LULU_BUSINESS_URL_BASE = 'https://lulu.seubone.com/business/?businessId=';

// Mesma lógica de retentativa do importador de Pedido atrasado: o "criar"
// do Code.gs já é idempotente por negocioId (dentro do lock), então uma
// retentativa nunca duplica — na pior das hipóteses recebe de volta o
// ticket que já tinha acabado de criar na tentativa anterior.
async function criarTicketComRetry_(card) {
  const body = {
    action: 'criar',
    identificador: 'Erro de Envio',
    pedido: card.titulo_negocio || '',
    idVenda: card.id_pedido != null ? String(card.id_pedido) : '',
    negocioId: card.negocio_id,
    link: LULU_BUSINESS_URL_BASE + card.negocio_id,
    observacao: montarObservacao_(card),
    ppe: card.ppe || '',
    codigoRastreio: card.codigo_rastreio || '',
    previsaoEntregaTransportadora: card.previsao_entrega || '',
    origem: 'Lulu 2.0',
    usuario: 'Lulu 2.0',
  };
  try {
    return await chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body });
  } catch (err) {
    return chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body });
  }
}

async function importarErrosEnvio() {
  if (!env.ticketsAppsScriptUrl || !env.luluAlertaEntregaUrl || !env.luluIntegracaoKey) return;
  try {
    const cards = await buscarCardsAlertaEntrega();
    if (!cards.length) return;

    const ticketsJson = await chamarAppsScript(env.ticketsAppsScriptUrl, { cache: true });
    if (!ticketsJson.ok || !Array.isArray(ticketsJson.tickets)) return;
    // Mesma regra do importador de Pedido atrasado: uma vez que já existe
    // QUALQUER ticket pra esse negócio (mesmo já Resolvido), nunca abrimos
    // outro — "Resolvido" aqui significa "já tratamos isso".
    const negociosComTicket = new Set(
      ticketsJson.tickets.filter((t) => t.negocioId).map((t) => t.negocioId)
    );

    // Sequencial de propósito — mesmo motivo do importador de Pedido
    // atrasado: evita N chamadas simultâneas contra o LockService do Apps
    // Script, e uma falha isolada não pode descartar o resto do lote.
    for (const card of cards) {
      if (!card.negocio_id || negociosComTicket.has(card.negocio_id)) continue;
      try {
        const json = await criarTicketComRetry_(card);
        if (!json.ok) {
          console.error('[tickets-erro-envio] falha ao criar ticket pro negocio ' + card.negocio_id + ':', json.error);
        }
      } catch (err) {
        console.error('[tickets-erro-envio] falha ao criar ticket (após retentativa) pro negocio ' + card.negocio_id + ':', err.message);
      }
    }
  } catch (err) {
    console.error('[tickets-erro-envio] falha na importação:', err.message);
  }
}

function agendarProximaExecucao_() {
  const proximaTs = proximaExecucaoTs_();
  const delay = proximaTs - Date.now();
  console.log('[tickets-erro-envio] próxima checagem agendada para', new Date(proximaTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  setTimeout(async () => {
    await importarErrosEnvio();
    agendarProximaExecucao_();
  }, delay);
}

function iniciarImportacaoErroEnvio() {
  importarErrosEnvio();
  agendarProximaExecucao_();
}

module.exports = { iniciarImportacaoErroEnvio, importarErrosEnvio };
