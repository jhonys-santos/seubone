const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');

// Os usuários do hub (login, senha, papel, slug, painéis liberados) ficam
// numa aba própria ("HubUsuarios") da planilha do Painel SAC, em vez de um
// arquivo local — assim sobrevivem a qualquer redeploy no Render, que não
// tem disco persistente no plano free. Fica em cache na memória do processo:
// carregado uma vez no boot (ver inicializar() em server.js) e atualizado a
// cada criação/edição, pra não bater no Apps Script em toda requisição.
let cache = [];

async function inicializar() {
  cache = await buscarUsuariosRemoto();
}

async function buscarUsuariosRemoto() {
  const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
    params: { action: 'hubListarUsuarios' },
  });
  if (!json || !Array.isArray(json.usuarios)) {
    throw new Error(
      'Não foi possível carregar os usuários do hub via Apps Script' + (json && json.erro ? ': ' + json.erro : '')
    );
  }
  return json.usuarios;
}

function listarUsuarios() {
  return cache;
}

function buscarPorUsuario(usuario) {
  const alvo = String(usuario || '').trim().toLowerCase();
  return listarUsuarios().find((u) => u.usuario.toLowerCase() === alvo) || null;
}

function buscarPorSlug(slug) {
  return listarUsuarios().find((u) => u.slug === slug) || null;
}

async function autenticar(usuario, senha) {
  const registro = buscarPorUsuario(usuario);
  if (!registro) return null;
  const senhaOk = await bcrypt.compare(String(senha || ''), registro.senhaHash);
  if (!senhaOk) return null;
  return sessaoPublica(registro);
}

function sessaoPublica(registro) {
  return {
    id: registro.id,
    usuario: registro.usuario,
    nome: registro.nome,
    slug: registro.slug,
    role: registro.role,
    tipo: registro.tipo,
    paineis: registro.paineis && registro.paineis.length ? registro.paineis : null, // null = acesso a todos os painéis
    indicadoresPendentes: !!registro.indicadoresPendentes, // true = ainda não tem KPIs mapeados na planilha
  };
}

function podeAcessarPainel(usuarioSessao, painel) {
  if (!usuarioSessao.paineis) return true; // sem lista = libera tudo
  return usuarioSessao.paineis.includes(painel);
}

// Além do allowlist geral (podeAcessarPainel), um painel do catálogo pode se
// restringir ainda mais por "somenteRole" (um papel) e/ou "somenteSlugs"
// (lista de usuários específicos) — quando QUALQUER um dos dois bate, o
// painel aparece (ex: Corridas Avulsas é só do Wallac + qualquer gestor).
// Sem nenhum dos dois campos no catálogo, fica liberado como sempre.
function podeVerPainelRestrito(usuarioSessao, painel) {
  if (!painel.somenteRole && !painel.somenteSlugs) return true;
  if (painel.somenteRole && usuarioSessao.role === painel.somenteRole) return true;
  if (painel.somenteSlugs && painel.somenteSlugs.includes(usuarioSessao.slug)) return true;
  return false;
}

async function criarOuAtualizarUsuario({ usuario, senha, nome, slug, role, tipo, paineis, indicadoresPendentes }) {
  const existente = buscarPorUsuario(usuario);
  const senhaHash = await bcrypt.hash(senha, 10);

  const registro = {
    id: existente ? existente.id : `u-${slug}`,
    usuario,
    senhaHash,
    nome,
    slug,
    role,
    tipo: tipo || null,
    paineis: paineis && paineis.length ? paineis : [],
    indicadoresPendentes: !!indicadoresPendentes,
  };

  await chamarAppsScript(env.painelSacAppsScriptUrl, {
    method: 'POST',
    body: { action: 'hubSalvarUsuario', ...registro },
  });

  if (existente) {
    Object.assign(existente, registro);
  } else {
    cache.push(registro);
  }

  return registro;
}

async function alterarSenha(usuario, senhaAtual, senhaNova) {
  const existente = buscarPorUsuario(usuario);
  if (!existente) return { ok: false, erro: 'Usuário não encontrado.' };

  const senhaOk = await bcrypt.compare(String(senhaAtual || ''), existente.senhaHash);
  if (!senhaOk) return { ok: false, erro: 'Senha atual incorreta.' };

  const senhaHash = await bcrypt.hash(senhaNova, 10);
  const registro = { ...existente, senhaHash };

  await chamarAppsScript(env.painelSacAppsScriptUrl, {
    method: 'POST',
    body: { action: 'hubSalvarUsuario', ...registro },
  });

  Object.assign(existente, registro);
  return { ok: true };
}

module.exports = {
  inicializar,
  listarUsuarios,
  buscarPorUsuario,
  buscarPorSlug,
  autenticar,
  sessaoPublica,
  podeAcessarPainel,
  podeVerPainelRestrito,
  criarOuAtualizarUsuario,
  alterarSenha,
};
