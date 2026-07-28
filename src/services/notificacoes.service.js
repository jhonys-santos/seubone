const { chamarAppsScript } = require('./appsScriptClient');
const usuariosService = require('./usuarios.service');
const env = require('../config/env');

// Notificações do sininho (topo da sidebar) — avisam qualquer usuário
// logado quando uma solicitação (Registro, Reembolso, Pagamento) volta do
// financeiro marcada como concluída. Guardadas na mesma planilha do
// Registro/Reembolso (aba "Notificacoes"), em vez de arquivo local — o
// Render (plano Free) não tem disco persistente, então um arquivo local se
// perderia a cada deploy (e possivelmente a cada vez que o serviço "dorme"
// por inatividade e acorda de novo).
//
// "Lida" é por usuário (lidaPor: [slug, slug...]), não um booleano único —
// cada pessoa marca como lida pra si, sem afetar o que os outros veem. Uma
// notificação só é apagada de vez quando TODO MUNDO que tem acesso ao hub
// já leu (nesse ponto ela não serve mais pra ninguém, aí sim libera espaço
// na planilha).

async function listarTodas() {
  const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
    params: { action: 'listarNotificacoes' },
  });
  return Array.isArray(json) ? json : [];
}

// Remove notificações que já foram lidas por todos os usuários cadastrados
// no hub. Roda depois de toda escrita — o volume é pequeno, então isso é
// barato mesmo rodando com frequência.
async function podar(lista) {
  const todosSlugs = usuariosService.listarUsuarios().map((u) => u.slug);
  if (!todosSlugs.length) return; // cache de usuários ainda não carregado — não arrisca apagar
  const paraApagar = lista.filter((n) => todosSlugs.every((slug) => (n.lidaPor || []).includes(slug)));
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
    .filter((n) => !(n.lidaPor || []).includes(slug))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

async function adicionar(mensagem, link) {
  await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
    method: 'POST',
    body: { action: 'criarNotificacao', mensagem, link: link || null },
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
