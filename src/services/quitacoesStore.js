// Ponto único de acesso às Quitações Pendentes: decide, a cada chamada, se vai pro Postgres
// (QUITACOES_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./quitacoesDb.service');

const usaBanco = () => env.quitacoesBackend === 'db';

const planilha = {
  // cache: false deixa a leitura sempre fresca (usada antes de autorizar "marcar como pago").
  listar: (status, desde, ate, { cache = true } = {}) => chamarAppsScript(env.quitacoesAppsScriptUrl, { params: { action: 'lista', status, desde, ate }, cache }),
  cadastrar: (b) => chamarAppsScript(env.quitacoesAppsScriptUrl, { method: 'POST', body: { ...b, action: 'cadastrar' } }),
  marcarPago: (id) => chamarAppsScript(env.quitacoesAppsScriptUrl, { method: 'POST', body: { action: 'marcarPago', id } }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
