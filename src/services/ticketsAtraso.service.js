const ticketsStore = require('./ticketsStore');
const notificacoesService = require('./notificacoes.service');
const env = require('../config/env');

// Checagem periódica de tickets atrasados — avisa o responsável (só ele,
// não o gestor) quando o prazo (SLA por identificador, mesma conta do
// dashboard) vence. Roda no próprio processo do hub (Render Starter fica
// sempre de pé, não é free tier que dorme) em vez de um gatilho no Apps
// Script, porque assim dá pra reaproveitar direto o notificacoesService e
// testar/depurar sem precisar de outro ciclo de deploy no Apps Script.
//
// "Já notificado" fica salvo na própria planilha (coluna Atraso Notificado)
// pra não repetir o aviso a cada checagem enquanto o ticket continuar
// atrasado — e é limpo automaticamente se o ticket deixar de estar atrasado
// (resolvido, reaberto com prazo novo etc.), permitindo notificar de novo
// caso volte a atrasar.
const SLA_DIAS = { 'Pedido atrasado': 1, 'Erro de Envio': 1 };
// Refabricação: 5 dias úteis (sem sábado e domingo), contando o dia da abertura como o 1º = 49h de expediente (4 x 10h + 9h da sexta).
const SLA_DIAS_UTEIS = { 'Refabricação': 5 };
function somarDiasUteis(base, n) {
  const d = new Date(base.getTime());
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  for (let falta = n - 1; falta > 0; ) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) falta--; }
  return d;
}
const STATUS_RESOLVIDO = 'Resolvido';
const INTERVALO_MS = 60 * 60 * 1000; // granularidade do SLA é em dias — checar a cada hora já é sobra

function diasParaPrazo(dataAberturaIso, identificador) {
  const dias = SLA_DIAS[identificador];
  const diasUteis = SLA_DIAS_UTEIS[identificador];
  if ((dias == null && diasUteis == null) || !dataAberturaIso) return null;
  const abertura = new Date(dataAberturaIso);
  if (isNaN(abertura.getTime())) return null;
  const aberturaSemHora = new Date(abertura.getFullYear(), abertura.getMonth(), abertura.getDate());
  let prazo = new Date(aberturaSemHora.getTime());
  if (diasUteis != null) prazo = somarDiasUteis(prazo, diasUteis);
  else prazo.setDate(prazo.getDate() + dias);
  const hojeSemHora = new Date();
  hojeSemHora.setHours(0, 0, 0, 0);
  return Math.round((prazo.getTime() - hojeSemHora.getTime()) / 86400000);
}

async function checarAtrasos() {
  if (env.ticketsBackend !== 'db' && !env.ticketsAppsScriptUrl) return;
  try {
    const json = await ticketsStore.listar();
    if (!json.ok || !Array.isArray(json.tickets)) return;

    // Em paralelo — cada chamada ao Apps Script custa ~2-3s de latência
    // própria (independente do que faz); rodando uma por vez o tempo total
    // cresce com a quantidade de tickets e prende o lock da planilha por
    // mais tempo (disputando com ações de usuário nesse intervalo).
    await Promise.allSettled(json.tickets.map(async (t) => {
      if (t.status === STATUS_RESOLVIDO || !t.responsavelSlug) return;
      const dias = diasParaPrazo(t.dataAbertura, t.identificador);
      const atrasado = dias != null && dias < 0;

      if (atrasado && !t.atrasoNotificado) {
        const mensagem = `Ticket ${t.idTicket ? '#' + t.idTicket : '#' + t.rowIndex} (${t.pedido || 'sem cliente'}) está atrasado (${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}).`;
        await notificacoesService.adicionar(mensagem, '/tickets#/t/' + t.rowIndex, t.responsavelSlug);
        await ticketsStore.marcarAtrasoNotificado({ rowIndex: t.rowIndex, notificado: true });
      } else if (!atrasado && t.atrasoNotificado) {
        await ticketsStore.marcarAtrasoNotificado({ rowIndex: t.rowIndex, notificado: false });
      }
    }));
  } catch (err) {
    console.error('[tickets] falha ao checar atrasos:', err.message);
  }
}

function iniciarChecagemAtrasos() {
  checarAtrasos();
  setInterval(checarAtrasos, INTERVALO_MS);
}

module.exports = { iniciarChecagemAtrasos, checarAtrasos, diasParaPrazo };
