// Ponto único de acesso aos Pedidos Urgentes: decide, a cada chamada, se vai pro Postgres
// (PEDIDOS_URGENTES_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./pedidosUrgentesDb.service');

const usaBanco = () => env.pedidosUrgentesBackend === 'db';

const planilha = {
  listar: (status, desde, ate) => chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, { params: { action: 'list', status, desde, ate }, cache: true }),
  criar: (b) => chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, { method: 'POST', body: { ...b, action: 'create' } }),
  despachar: (b) => chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, { method: 'POST', body: { action: 'despachar', id: b.id, despachadoPor: b.despachadoPor } }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
