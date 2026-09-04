const env = require('./../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const notificacoesService = require('./notificacoes.service');
const usuariosService = require('./usuarios.service');

// Importa pedidos com PPF vencido do sistema Lulu e abre um Ticket "Pedido
// atrasado" pra cada negócio que ainda não tem um — mesmo espírito do
// checador de atraso por SLA interno (ticketsAtraso.service.js), só que
// aqui quem diz "está atrasado" é o sistema de origem, não uma conta feita
// aqui dentro.
//
// O parâmetro "dias" do endpoint da Lulu NÃO é um limite cumulativo —
// confirmado em teste direto: dias=10 devolveu atrasos de 1 a 9 dias e
// dias=30 devolveu de 12 a 30, com uma lacuna no meio (10-11). Como cada
// Ticket fica aberto até ser resolvido e essa checagem roda com frequência,
// só precisamos capturar cada negócio UMA vez, cedo — por isso consultamos
// as duas janelas e juntamos por negocio_id (a chave estável; idVenda pode
// vir nulo do lado deles), cobrindo a faixa observada de ponta a ponta.
const DIAS_CONSULTA = [10, 30];

// Roda 2x por dia (não de hora em hora) — 07h e 13h, horário de Brasília.
// Fuso fixo (UTC-3): Brasil não tem mais horário de verão desde 2019, então
// dá pra converter sem depender de fuso do servidor (o Render normalmente
// roda em UTC) nem de bibliotecas de fuso horário.
const HORARIOS_EXECUCAO_BRASILIA = [7, 13];
const FUSO_BRASILIA_OFFSET_HORAS = -3;

// Calcula o próximo instante (timestamp UTC) em que algum dos horários
// configurados ocorre em Brasília — sempre no futuro relativo a agora.
function proximaExecucaoTs_() {
  const agora = Date.now();
  const d = new Date(agora);
  const candidatos = HORARIOS_EXECUCAO_BRASILIA.map((horaBrasilia) => {
    let alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), horaBrasilia - FUSO_BRASILIA_OFFSET_HORAS, 0, 0, 0);
    if (alvo <= agora) alvo += 24 * 60 * 60 * 1000; // esse horário já passou hoje — tenta amanhã
    return alvo;
  });
  return Math.min(...candidatos);
}

async function buscarPedidosAtrasados() {
  const porNegocio = new Map();
  for (const dias of DIAS_CONSULTA) {
    try {
      const url = new URL(env.luluPedidosPpfVencidoUrl);
      url.searchParams.set('dias', dias);
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error('[tickets-lulu] falha ao consultar dias=' + dias + ': HTTP ' + resp.status);
        continue;
      }
      const json = await resp.json();
      (json.data || []).forEach((pedido) => {
        if (pedido.negocio_id) porNegocio.set(pedido.negocio_id, pedido);
      });
    } catch (err) {
      console.error('[tickets-lulu] falha ao consultar dias=' + dias + ':', err.message);
    }
  }
  return Array.from(porNegocio.values());
}

// Mesmo aviso usado no webhook manual/n8n — ticket importado nunca nasce
// com responsável (a atribuição continua manual, decidida pelo gestor).
function notificarGestoresSemResponsavel(rowIndex, idTicket, pedido) {
  const link = '/tickets#/t/' + rowIndex;
  const mensagem = `Ticket ${idTicket ? '#' + idTicket : '#' + rowIndex} (${pedido || 'sem pedido'}) aberto sem responsável.`;
  usuariosService
    .listarUsuarios()
    .filter((u) => u.role === 'gestor')
    .forEach((u) => {
      notificacoesService.adicionar(mensagem, link, u.slug).catch((err) => console.error('[tickets-lulu] falha ao notificar gestor:', err.message));
    });
}

// "link_card" costuma vir nulo da Lulu, mas o padrão da URL é sempre
// previsível a partir do negocio_id (confirmado nos exemplos reais que já
// vimos: .../business/<negocio_id>) — então montamos o link nós mesmos em
// vez de depender do campo, que falha na maioria dos pedidos.
const LULU_BUSINESS_URL_BASE = 'https://lulu.seubone.com/business/?businessId=';

// Uma retentativa por pedido — picos de lentidão/rede pontuais no Apps
// Script acontecem (confirmado nesta mesma sessão, chamadas isoladas já
// levaram 20-30s+ às vezes), e num lote de dezenas/centenas de chamadas
// sequenciais isso É esperado acontecer eventualmente. Sem isso, um
// pedido que falhasse ficava de fora até a próxima checagem agendada.
async function criarTicketComRetry_(pedido) {
  const body = {
    action: 'criar',
    identificador: 'Pedido atrasado',
    pedido: pedido.cliente || '',
    idVenda: pedido.id_venda != null ? String(pedido.id_venda) : '',
    negocioId: pedido.negocio_id,
    link: LULU_BUSINESS_URL_BASE + pedido.negocio_id,
    observacao: `Importado automaticamente do sistema. PPF vencido há ${pedido.dias_atraso_ppf} dia(s).`,
    pFolha: pedido.ppf || '',
    previsaoFinalizacao: pedido.ppp || '',
    ppe: pedido.ppe || '',
    origem: 'Lulu 2.0',
    usuario: 'Lulu 2.0',
  };
  try {
    return await chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body });
  } catch (err) {
    await new Promise((r) => setTimeout(r, 2000));
    return chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body });
  }
}

async function importarAtrasosLulu() {
  if (!env.ticketsAppsScriptUrl || !env.luluPedidosPpfVencidoUrl) return;
  try {
    const pedidos = await buscarPedidosAtrasados();
    if (!pedidos.length) return;

    const ticketsJson = await chamarAppsScript(env.ticketsAppsScriptUrl, { cache: true });
    if (!ticketsJson.ok || !Array.isArray(ticketsJson.tickets)) return;
    // Uma vez que já existe QUALQUER ticket pra esse negócio (mesmo já
    // Resolvido), nunca abrimos outro — mesmo que a Lulu ainda mostre o
    // pedido como atrasado. Resolvido aqui significa "já tratamos isso",
    // não "a Lulu concorda que terminou"; reabrir de novo só porque a Lulu
    // ainda não atualizou geraria os mesmos duplicados de antes.
    const negociosComTicket = new Set(
      ticketsJson.tickets.filter((t) => t.negocioId).map((t) => t.negocioId)
    );

    // Sequencial de propósito: evita disparar N chamadas simultâneas contra
    // o LockService do Apps Script (e contra o próprio sistema da Lulu) de
    // uma vez só, especialmente na primeira importação com backlog maior.
    // Cada pedido tem seu próprio try/catch — uma falha isolada (mesmo após
    // a retentativa) não pode derrubar o restante do lote inteiro, senão um
    // único soluço de rede no meio do caminho descarta dezenas de pedidos
    // que já estavam prontos pra virar ticket.
    for (const pedido of pedidos) {
      if (negociosComTicket.has(pedido.negocio_id)) continue;
      try {
        const json = await criarTicketComRetry_(pedido);
        if (json.ok) {
          notificarGestoresSemResponsavel(json.rowIndex, json.idTicket, pedido.cliente);
        } else {
          console.error('[tickets-lulu] falha ao criar ticket pro negocio ' + pedido.negocio_id + ':', json.error);
        }
      } catch (err) {
        console.error('[tickets-lulu] falha ao criar ticket (após retentativa) pro negocio ' + pedido.negocio_id + ':', err.message);
      }
    }
  } catch (err) {
    console.error('[tickets-lulu] falha na importação:', err.message);
  }
}

// setTimeout até o próximo horário (não setInterval) — reagenda sozinho a
// cada execução, então nunca "desalinha" do relógio de parede como um
// intervalo fixo desalinharia com o tempo.
function agendarProximaExecucao_() {
  const proximaTs = proximaExecucaoTs_();
  const delay = proximaTs - Date.now();
  console.log('[tickets-lulu] próxima checagem agendada para', new Date(proximaTs).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  setTimeout(async () => {
    await importarAtrasosLulu();
    agendarProximaExecucao_();
  }, delay);
}

function iniciarImportacaoLulu() {
  // Roda uma vez já ao subir o servidor — cobre o caso de o servidor ter
  // ficado fora do ar durante um dos dois horários (deploy, reinício).
  importarAtrasosLulu();
  agendarProximaExecucao_();
}

module.exports = { iniciarImportacaoLulu, importarAtrasosLulu };
