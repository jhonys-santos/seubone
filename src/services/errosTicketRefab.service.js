// Ticket de Refabricação automático: quando alguém registra um erro no Painel de Erros com tipo de resolução "Refabricação" ou "Brinde até 12 und."
// (os dois exigem produzir as unidades), o hub abre o ticket
// no painel de Tickets, com quem cadastrou o erro como responsável. Só vale para registros NOVOS (os já cadastrados não geram ticket).
// Ligado por ERROS_TICKET_REFAB=on (padrão: desligado). Uma falha aqui nunca derruba o registro do erro: devolve { ok: false, erro } e o caso fica salvo.
const env = require('../config/env');
const ticketsStore = require('./ticketsStore');

const txt = (v) => String(v == null ? '' : v).trim();
const semAcento = (s) => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ligado = () => semAcento(env.errosTicketRefab) === 'on';
// Resoluções que mandam produzir de novo (viram ticket de Refabricação): Refabricação e Brinde até 12 und. (o brinde também é produzido).
const RESOLUCOES_COM_TICKET = ['refabricacao', 'brinde ate 12 und.'];
const ehRefabricacao = (tipoResolucao) => RESOLUCOES_COM_TICKET.includes(semAcento(tipoResolucao));

/** "Fabrica Cacinho" -> "Fábrica Cacinho" (padrão dos tickets). Responsável que não é uma fábrica só ("João", "Fabrica A / B", "Expectativa do Cliente") fica em branco. */
function fabricaDoResponsavel(responsavel) {
  const r = txt(responsavel);
  if (!/^f[aá]brica\s+\S/i.test(r) || /[\/,]/.test(r)) return '';
  return 'Fábrica ' + r.replace(/^f[aá]brica\s+/i, '');
}

function montarObservacao(campos, rowIndex) {
  const linhas = [`Criado automaticamente do Painel de Erros · caso #${rowIndex}${txt(campos.idVenda) ? ' · ID venda ' + txt(campos.idVenda) : ''}`];
  if (txt(campos.tipoResolucao)) linhas.push('Resolução: ' + txt(campos.tipoResolucao));
  const problema = [txt(campos.tipoProblema), txt(campos.subproblema)].filter(Boolean).join(' · ');
  if (problema) linhas.push('Problema: ' + problema);
  const detalhes = [campos.qtd !== undefined && txt(campos.qtd) ? 'Qtd: ' + txt(campos.qtd) : '', txt(campos.setor) ? 'Setor: ' + txt(campos.setor) : '', txt(campos.responsavel) ? 'Responsável pelo erro: ' + txt(campos.responsavel) : ''].filter(Boolean);
  if (detalhes.length) linhas.push(detalhes.join(' · '));
  if (txt(campos.queFim)) linhas.push('Fim do produto: ' + txt(campos.queFim));
  if (txt(campos.descricao)) linhas.push('', txt(campos.descricao));
  return linhas.join('\n');
}

/** Já existe ticket de Refabricação ABERTO para esse ID de venda? (vale o migrado do Octadesk também.) Não cria outro para o mesmo pedido. */
async function ticketAbertoDaVenda(idVenda) {
  if (!idVenda) return null;
  const r = await ticketsStore.listar();
  const lista = r && Array.isArray(r.tickets) ? r.tickets : [];
  return lista.find((t) => semAcento(t.identificador) === 'refabricacao' && txt(t.idVenda) === idVenda && txt(t.status) !== 'Resolvido') || null;
}

/**
 * campos: o que o formulário do erro mandou (idVenda, nomeCard, linkPedido, tipoProblema, subproblema, qtd, setor, responsavel, queFim, descricao, tipoResolucao, fotosUrls).
 * ctx:    { rowIndex (do caso), usuario, usuarioSlug } = quem cadastrou, vindo da sessão.
 * Devolve { ignorado: true } (desligado ou resolução que não manda produzir), { ok: true, idTicket, rowIndex, jaExistia? } ou { ok: false, erro }.
 */
async function criarParaCaso(campos, ctx) {
  campos = campos || {};
  if (!ligado() || !ehRefabricacao(campos.tipoResolucao)) return { ignorado: true };
  const { rowIndex, usuario, usuarioSlug } = ctx || {};
  try {
    const idVenda = txt(campos.idVenda);
    const existente = await ticketAbertoDaVenda(idVenda);
    if (existente) return { ok: true, jaExistia: true, idTicket: existente.idTicket, rowIndex: existente.rowIndex };

    const criado = await ticketsStore.criar({
      pedido: txt(campos.nomeCard) || idVenda || 'Sem nome', idVenda, identificador: 'Refabricação', fabrica: fabricaDoResponsavel(campos.responsavel),
      responsavel: txt(usuario), responsavelSlug: txt(usuarioSlug), link: txt(campos.linkPedido), observacao: montarObservacao(campos, rowIndex),
      origem: 'Painel de Erros', usuario: txt(usuario), usuarioSlug: txt(usuarioSlug),
    });
    if (!criado || !criado.ok) return { ok: false, erro: (criado && criado.error) || 'o painel de Tickets não aceitou o ticket' };

    // Histórico "Responsável atribuído" (é dele que o tempo de tratamento começa a contar); falhar aqui não desfaz o ticket.
    try { await ticketsStore.atribuir({ rowIndex: criado.rowIndex, responsavel: txt(usuario), responsavelSlug: txt(usuarioSlug), usuario: txt(usuario), usuarioSlug: txt(usuarioSlug) }); } catch (e) { /* já saiu com responsável */ }

    // Os anexos do erro (links do Drive) vão junto, sem copiar arquivo. Só com os tickets no banco.
    const links = (Array.isArray(campos.fotosUrls) ? campos.fotosUrls : []).map(txt).filter(Boolean).join(',');
    if (links && env.ticketsBackend === 'db') {
      try { await require('../db').query('update tickets set anexos = $2 where row_index = $1', [criado.rowIndex, links]); } catch (e) { console.error('[erros-ticket-refab] anexos:', e.message); }
    }
    // Deixa registrado no histórico do caso (só com o Painel de Erros no banco).
    if (env.errosBackend === 'db' && rowIndex) {
      try { await require('./errosDb.service').registrarNoHistorico(rowIndex, idVenda, usuario, usuarioSlug, 'Ticket de Refabricação criado', criado.idTicket); } catch (e) { /* só histórico */ }
    }
    return { ok: true, idTicket: criado.idTicket, rowIndex: criado.rowIndex };
  } catch (e) {
    console.error('[erros-ticket-refab] falha ao criar o ticket:', e.message);
    return { ok: false, erro: String((e && e.message) || e) };
  }
}

module.exports = { criarParaCaso, ligado, ehRefabricacao, fabricaDoResponsavel, montarObservacao };
