const { chamarAppsScript } = require('./appsScriptClient');
const usuariosService = require('./usuarios.service');
const env = require('../config/env');

// Notificações do sininho (topo da sidebar) — avisam quando uma solicitação
// (Registro, Reembolso, Pagamento) volta do financeiro marcada como
// concluída. Guardadas na mesma planilha do Registro/Reembolso (aba
// "Notificacoes"), em vez de arquivo local — o Render (plano Free) não tem
// disco persistente, então um arquivo local se perderia a cada deploy.
//
// Duas formas de notificação:
// - Direcionada (destinatario = slug de quem criou a solicitação): só essa
//   pessoa vê, e ela é apagada assim que essa única pessoa marcar como
//   lida — não faz sentido esperar "todo mundo" ler algo que só era pra
//   uma pessoa.
// - Broadcast (destinatario vazio): visível pra todo usuário logado — é o
//   modo antigo, mantido como fallback pra solicitações antigas que não
//   têm quem criou registrado, ou pra quando quem chamou adicionar() não
//   informou um destinatário.
// Em ambos os casos, "lidaPor" é por usuário — cada um marca como lida pra
// si, sem afetar o que os outros veem.

async function listarTodas() {
  const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
    params: { action: 'listarNotificacoes' },
  });
  return Array.isArray(json) ? json : [];
}

// Remove notificações direcionadas já lidas pelo destinatário, e
// notificações broadcast já lidas por todos os usuários cadastrados no
// hub. Roda depois de toda escrita — o volume é pequeno, então isso é
// barato mesmo rodando com frequência.
async function podar(lista) {
  const todosSlugs = usuariosService.listarUsuarios().map((u) => u.slug);
  if (!todosSlugs.length) return; // cache de usuários ainda não carregado — não arrisca apagar
  const paraApagar = lista.filter((n) => {
    if (n.destinatario) return (n.lidaPor || []).includes(n.destinatario);
    return todosSlugs.every((slug) => (n.lidaPor || []).includes(slug));
  });
  await Promise.all(
    paraApagar.map((n) =>
      chamarAppsScript(env.registroDemandasAppsScriptUrl, {
        method: 'POST',
        body: { action: 'excluirNotificacao', id: n.id },
      })
    )
  );
}

async function listarNaoLidas(slug) {
  const lista = await listarTodas();
  return lista
    .filter((n) => (!n.destinatario || n.destinatario === slug) && !(n.lidaPor || []).includes(slug))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

async function adicionar(mensagem, link, destinatarioSlug) {
  await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
    method: 'POST',
    body: { action: 'criarNotificacao', mensagem, link: link || null, destinatario: destinatarioSlug || null },
  });
  await podar(await listarTodas());
}

async function marcarLida(id, slug) {
  const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
    method: 'POST',
    body: { action: 'marcarNotificacaoLida', id, slug },
  });
  await podar(await listarTodas());
  return !!json.ok;
}

module.exports = { listarNaoLidas, adicionar, marcarLida };
