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

module.exports = {
  inicializar,
  listarUsuarios,
  buscarPorUsuario,
  buscarPorSlug,
  autenticar,
  sessaoPublica,
  podeAcessarPainel,
  criarOuAtualizarUsuario,
};
