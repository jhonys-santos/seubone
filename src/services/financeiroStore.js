// Ponto único de acesso a Registro de Demandas, Reembolso, Pagamento e Corridas Avulsas:
// decide, a cada chamada, se vai pro Postgres (FINANCEIRO_BACKEND=db) ou pras planilhas via
// Apps Script (padrão). Os webhooks do n8n e as notificações continuam no hub, como antes.
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./financeiroDb.service');

const usaBanco = () => env.financeiroBackend === 'db';
const get = (url, params) => chamarAppsScript(url, { params, cache: true });
const post = (url, body) => chamarAppsScript(url, { method: 'POST', body });

const planilha = {
  listarRegistros: () => get(env.registroDemandasAppsScriptUrl, { action: 'list' }),
  listarReembolsos: () => get(env.registroDemandasAppsScriptUrl, { action: 'listReembolso' }),
  listarPagamentos: () => get(env.corridasPagamentosAppsScriptUrl, { action: 'list' }),
  criarRegistro: (b) => post(env.registroDemandasAppsScriptUrl, { action: 'create', ...b }),
  criarReembolso: (b) => post(env.registroDemandasAppsScriptUrl, { action: 'createReembolso', ...b }),
  criarPagamento: (b) => post(env.corridasPagamentosAppsScriptUrl, { action: 'create', ...b }),
  marcarRegistro: (b) => post(env.registroDemandasAppsScriptUrl, { action: 'marcar', ...b }),
  marcarReembolso: (b) => post(env.registroDemandasAppsScriptUrl, { action: 'marcarReembolso', ...b }),
  marcarPagamento: (b) => post(env.corridasPagamentosAppsScriptUrl, { action: 'marcar', ...b }),
  listarCorridas: (desde, ate) => get(env.corridasAvulsasAppsScriptUrl, { action: 'lista', desde, ate }),
  cadastrarCorrida: (b) => post(env.corridasAvulsasAppsScriptUrl, { action: 'cadastrar', ...b }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
