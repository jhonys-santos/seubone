// Ponto único de acesso ao Painel de Produção SBP (Wallac): decide, a cada chamada, se vai pro Postgres
// (WALLAC_BACKEND=db) ou pra planilha via Apps Script (padrão). Os cards de COMPRA vêm sempre da aba LTV.
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./wallacDb.service');

const usaBanco = () => env.wallacBackend === 'db';
const get = (params) => chamarAppsScript(env.wallacAppsScriptUrl, { params, cache: true });
const post = (body) => chamarAppsScript(env.wallacAppsScriptUrl, { method: 'POST', body });

const planilha = {
  cards: () => chamarAppsScript(env.wallacAppsScriptUrl, { cache: true }),
  mudarStatus: (chave, novoStatus) => post({ acao: 'mudar_status', chave, novo_status: novoStatus }),
  estoquePublico: () => get({ acao: 'estoque' }),
  estoqueAdmin: () => get({ acao: 'estoque_admin' }),
  adicionarProdutoEstoque: (d) => post({ acao: 'estoque_adicionar', produto: d.produto, quantidade: d.quantidade }),
  editarProdutoEstoque: (d) => post({ acao: 'estoque_editar', linha: d.linha, produto: d.produto, quantidade: d.quantidade }),
  removerProdutoEstoque: (d) => post({ acao: 'estoque_remover', linha: d.linha }),
  solicitarPersonalizacao: (d) => post({ acao: 'solicitar_personalizacao', ...d }),
  premiacaoHistorico: () => get({ acao: 'premiacao_historico' }),
  premiacaoSemanaAtual: () => get({ acao: 'premiacao_semana_atual' }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
