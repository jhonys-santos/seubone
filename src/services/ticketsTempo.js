// Tempo de TRATAMENTO de um ticket (TMR de Pedido atrasado e de Erro de Envio): o indicador é do agente que tratou o ticket.
//  - O relógio dele começa quando o ticket foi atribuído a ele (não quando foi aberto);
//  - e só conta o HORÁRIO DE TRABALHO: segunda a quinta das 08h às 18h e sexta das 08h às 17h, sem descontar almoço.
//    Noite, sábado e domingo ficam de fora (ainda não há lista de feriados: feriado conta como dia útil).
//
// "dataAtribuicao" vem do histórico (ticketsDb.service.listarComAtribuicao): a última atribuição ao responsável atual; se o
// histórico não tem nenhuma para ele (tickets antigos, em que a troca de responsável não ficou registrada), a última atribuição de
// qualquer pessoa. Sem nenhuma atribuição, ou se ela fosse depois do fechamento, vale a abertura.
// Datas no formato "AAAA-MM-DDTHH:mm:ss" (Brasília), como o resto dos tickets.

const ABRE_H = 8;
const FECHA_SEG_A_QUI_H = 18;
const FECHA_SEXTA_H = 17;
const HORA_MS = 3600000;

const ms = (s) => { const t = new Date(s).getTime(); return Number.isFinite(t) ? t : null; };

/** "AAAA-MM-DDTHH:mm:ss" (horário de Brasília, sem fuso) -> milissegundos como se fosse UTC (só para conta de calendário). */
function relogio(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? '' : s));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

/**
 * Minutos de expediente entre duas datas (texto "AAAA-MM-DDTHH:mm:ss"): seg-qui 08-18, sex 08-17, sem sábado e domingo.
 * Começar antes das 08h conta a partir das 08h; terminar depois do fim do expediente conta até o fim. NaN se faltar data ou fim < início.
 */
function minutosUteisEntre(inicio, fim) {
  const a = relogio(inicio), b = relogio(fim);
  if (a == null || b == null || b < a) return NaN;
  const primeiroDia = Math.floor(a / 86400000) * 86400000;
  let total = 0;
  for (let dia = primeiroDia; dia <= b; dia += 86400000) {
    const dow = new Date(dia).getUTCDay();              // 0 = domingo ... 6 = sábado
    if (dow === 0 || dow === 6) continue;
    const abre = dia + ABRE_H * HORA_MS;
    const fecha = dia + (dow === 5 ? FECHA_SEXTA_H : FECHA_SEG_A_QUI_H) * HORA_MS;
    const de = Math.max(abre, a), ate = Math.min(fecha, b);
    if (ate > de) total += (ate - de) / 60000;
  }
  return total;
}

/** Data/hora (texto) em que começa a contar o tempo de tratamento do ticket. */
function inicioDoTratamento(t) {
  const abertura = ms(t.dataAbertura);
  const atribuicao = ms(t.dataAtribuicao);
  const fechamento = ms(t.dataFechamento);
  if (atribuicao == null) return t.dataAbertura;
  if (fechamento != null && atribuicao > fechamento) return t.dataAbertura;
  if (abertura != null && atribuicao < abertura) return t.dataAbertura;
  return t.dataAtribuicao;
}

/** Minutos de tratamento EM HORÁRIO DE TRABALHO (da atribuição ao fechamento); NaN se faltar data. */
function minutosDeTratamento(t) {
  const m = minutosUteisEntre(inicioDoTratamento(t), t.dataFechamento);
  if (Number.isFinite(m)) return m;
  // datas num formato que não é "AAAA-MM-DDTHH:mm:ss" (ex.: planilha): sem como separar o expediente, cai no tempo corrido.
  return minutosCorridosDeTratamento(t);
}

/** Minutos corridos (24h) da atribuição ao fechamento: o tempo que o cliente espera. */
function minutosCorridosDeTratamento(t) {
  return (new Date(t.dataFechamento).getTime() - new Date(inicioDoTratamento(t)).getTime()) / 60000;
}

module.exports = { inicioDoTratamento, minutosDeTratamento, minutosCorridosDeTratamento, minutosUteisEntre };
