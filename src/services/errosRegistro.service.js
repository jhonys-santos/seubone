// Registro de um erro novo no Painel de Erros com todos os efeitos que acompanham: aviso aos gestores quando entra na fila de aprovação de Refabricação,
// ticket de Refabricação automático (ERROS_TICKET_REFAB) e aviso quando o anexo não foi salvo. Usado pela tela do Painel de Erros e pelo formulário de Reembolso,
// para os dois registrarem o erro exatamente do mesmo jeito.
const errosStore = require('./errosStore');
const notificacoesService = require('./notificacoes.service');
const usuariosService = require('./usuarios.service');
const ticketRefab = require('./errosTicketRefab.service');

// Avisa todo gestor quando um caso entra na fila de aprovação de Refabricação — não deixa uma falha aqui derrubar o create/audit, só loga
// (o caso já foi salvo, essa é só a notificação).
function notificarGestoresRefab(idVenda, nomeCard, rowIndex) {
  const link = '/erros?refab=' + rowIndex;
  const mensagem = `Caso #${idVenda || rowIndex} (${nomeCard || 'sem nome'}) aguardando aprovação de Refabricação.`;
  usuariosService
    .listarUsuarios()
    .filter((u) => u.role === 'gestor')
    .forEach((u) => {
      notificacoesService.adicionar(mensagem, link, u.slug).catch((err) => console.error('[erros] falha ao notificar gestor:', err.message));
    });
}

/** usuario: { nome, slug } da sessão (a autoria nunca vem do navegador). Devolve o mesmo JSON do errosStore.criar (+ ticketRefab). */
async function registrarCaso(campos, usuario) {
  const json = await errosStore.criar(campos, usuario.nome, usuario.slug);
  if (json.ok && json.entrouAprovacaoRefab) notificarGestoresRefab(campos.idVenda, campos.nomeCard, json.rowIndex);
  // Erro novo com resolução "Refabricação": abre o ticket no painel de Tickets (se ERROS_TICKET_REFAB=on). Falha aqui não desfaz o caso.
  if (json.ok) {
    const t = await ticketRefab.criarParaCaso(campos, { rowIndex: json.rowIndex, usuario: usuario.nome, usuarioSlug: usuario.slug });
    if (!t.ignorado) json.ticketRefab = t;
  }
  // O caso é criado mesmo se o anexo falhar (nunca perde o registro por causa da mídia): avisa direto quem cadastrou, além do toast na hora.
  if (json.ok && json.fotosSalvas === false) {
    notificacoesService
      .adicionar(`Caso #${campos.idVenda || json.rowIndex} foi registrado, mas o anexo (foto/áudio/vídeo) não foi salvo. Abra o caso e anexe de novo.`, '/erros#/casos/' + json.rowIndex, usuario.slug)
      .catch((err) => console.error('[erros] falha ao notificar sobre anexo não salvo:', err.message));
  }
  return json;
}

module.exports = { registrarCaso, notificarGestoresRefab };
