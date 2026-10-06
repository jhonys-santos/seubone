// Ponto único de acesso à Auditoria de Qualidade: decide, a cada chamada, se vai pro Postgres
// (AUDITORIA_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./auditoriaDb.service');

const usaBanco = () => env.auditoriaBackend === 'db';

const planilha = {
  listar: () => chamarAppsScript(env.auditoriaAppsScriptUrl, { cache: true }),
  criar: (b) => chamarAppsScript(env.auditoriaAppsScriptUrl, { method: 'POST', body: b }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
