const env = require('./../config/env');
const ticketsStore = require('./ticketsStore');
const entrega = require('./ticketsEntrega.service');

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

// O campo Observação fica livre para quem trata o ticket. O que a Lulu informa (situação, previsão e as
// ocorrências) é guardado à parte (ticket_entrega) e aparece no cartão "Entrega" do ticket.

const LULU_BUSINESS_URL_BASE = 'https://lulu.seubone.com/business/?businessId=';

// Mesma lógica de retentativa do importador de Pedido atrasado: o "criar"
// do Code.gs já é idempotente por negocioId (dentro do lock), então uma
// retentativa nunca duplica — na pior das hipóteses recebe de volta o
// ticket que já tinha acabado de criar na tentativa anterior.
async function criarTicketComRetry_(card) {
  const body = {
    identificador: 'Erro de Envio',
    pedido: card.titulo_negocio || '',
    idVenda: card.id_pedido != null ? String(card.id_pedido) : '',
    negocioId: card.negocio_id,
    link: LULU_BUSINESS_URL_BASE + card.negocio_id,
    observacao: '',
    ppe: card.ppe || '',
    codigoRastreio: card.codigo_rastreio || '',
    previsaoEntregaTransportadora: card.previsao_entrega || '',
    origem: 'Lulu 2.0',
    usuario: 'Lulu 2.0',
  };
  let json;
  try {
    json = await ticketsStore.criar(body);
  } catch (err) {
    json = await ticketsStore.criar(body);
  }
  await guardarRetratoLulu_(json && json.rowIndex, card);
  return json;
}

// Só com o banco (a planilha não tem onde guardar). Nunca derruba a importação.
async function guardarRetratoLulu_(rowIndex, card) {
  if (env.ticketsBackend !== 'db' || !rowIndex) return;
  try {
    await entrega.salvarLulu(rowIndex, card);
  } catch (err) {
    console.error('[tickets-erro-envio] falha ao guardar dados de entrega do ticket ' + rowIndex + ':', err.message);
  }
}

async function importarErrosEnvio() {
  if ((env.ticketsBackend !== 'db' && !env.ticketsAppsScriptUrl) || !env.luluAlertaEntregaUrl || !env.luluIntegracaoKey) return;
  try {
    const cards = await buscarCardsAlertaEntrega();
    if (!cards.length) return;

    const ticketsJson = await ticketsStore.listar();
    if (!ticketsJson.ok || !Array.isArray(ticketsJson.tickets)) return;
    // Uma vez que já existe um ticket de ERRO DE ENVIO pra esse negócio (mesmo
    // já Resolvido), nunca abrimos outro — "Resolvido" aqui significa "já
    // tratamos isso". Ticket de outro identificador (ex.: Pedido atrasado,
    // que é atraso na produção) NÃO bloqueia: Erro de Envio é problema no
    // transporte, outro assunto, e precisa do seu próprio ticket.
    const ticketsErroEnvio = ticketsJson.tickets.filter((t) => t.negocioId && t.identificador === 'Erro de Envio');
    const negociosComTicket = new Set(ticketsErroEnvio.map((t) => t.negocioId));
    // Quem já tem ticket só ganha o retrato novo da Lulu (alertas e previsão mudam ao longo do dia).
    const ticketPorNegocio = new Map(ticketsErroEnvio.map((t) => [t.negocioId, t.rowIndex]));

    // Sequencial de propósito — mesmo motivo do importador de Pedido
    // atrasado: evita N chamadas simultâneas contra o LockService do Apps
    // Script, e uma falha isolada não pode descartar o resto do lote.
    for (const card of cards) {
      if (card.negocio_id && negociosComTicket.has(card.negocio_id)) {
        await guardarRetratoLulu_(ticketPorNegocio.get(card.negocio_id), card);
        continue;
      }
      if (!card.negocio_id) continue;
      try {
        const json = await criarTicketComRetry_(card);
        if (!json.ok) {
          console.error('[tickets-erro-envio] falha ao criar ticket pro negocio ' + card.negocio_id + ':', json.error);
        }
      } catch (err) {
        console.error('[tickets-erro-envio] falha ao criar ticket (após retentativa) pro negocio ' + card.negocio_id + ':', err.message);
      }
    }
    // Tickets antigos traziam as ocorrências escritas no campo Observação; agora elas aparecem no cartão "Entrega".
    // Depois que o retrato da Lulu está guardado, libera o campo (o texto original fica salvo em ticket_entrega).
    if (env.ticketsBackend === 'db') {
      const liberadas = await entrega.liberarObservacoesAutomaticas();
      if (liberadas) console.log('[tickets-erro-envio] observações automáticas liberadas:', liberadas);
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

module.exports = { iniciarImportacaoErroEnvio, importarErrosEnvio, buscarCardsAlertaEntrega };
