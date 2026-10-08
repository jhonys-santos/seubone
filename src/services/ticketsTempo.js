// Início da contagem do tempo de TRATAMENTO de um ticket (TMR de Pedido atrasado e de Erro de Envio): o indicador é do agente
// que tratou o ticket, então o relógio dele começa quando o ticket foi atribuído a ele, não quando foi aberto.
//
// "dataAtribuicao" vem do histórico (ticketsDb.service.listar): a última atribuição ao responsável atual; se o histórico não
// tem nenhuma para ele (tickets antigos, em que a troca de responsável não ficou registrada), a última atribuição de qualquer
// pessoa. Sem nenhuma atribuição, ou se ela fosse depois do fechamento, vale a abertura (como era antes).
// Datas no formato "AAAA-MM-DDTHH:mm:ss" (Brasília), como o resto dos tickets.

const ms = (s) => { const t = new Date(s).getTime(); return Number.isFinite(t) ? t : null; };

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

/** Minutos de tratamento (do início do tratamento ao fechamento); NaN se faltar data. */
function minutosDeTratamento(t) {
  return (new Date(t.dataFechamento).getTime() - new Date(inicioDoTratamento(t)).getTime()) / 60000;
}

module.exports = { inicioDoTratamento, minutosDeTratamento };
