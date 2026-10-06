// Ponto único de acesso aos casos do Painel de Erros: decide, a cada chamada, se
// vai pro Postgres (ERROS_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./errosDb.service');

const usaBanco = () => env.errosBackend === 'db';
const post = (body) => chamarAppsScript(env.errosAppsScriptUrl, { method: 'POST', body });

const planilha = {
  listar: () => chamarAppsScript(env.errosAppsScriptUrl, { cache: true }),
  historico: (rowIndex) => chamarAppsScript(env.errosAppsScriptUrl, { params: { action: 'historico', rowIndex }, cache: true }),
  criar: (fields, usuario, usuarioSlug) => post({ action: 'criar', fields, usuario, usuarioSlug }),
  auditar: (rowIndex, fields, usuario, usuarioSlug) => post({ action: 'audit', rowIndex, fields, usuario, usuarioSlug }),
  decidirRefab: (rowIndex, decisao, comentario, usuario, usuarioSlug) => post({ action: 'decidirRefab', rowIndex, decisao, comentario, usuario, usuarioSlug }),
  finalizarRefab: (rowIndex, usuario, usuarioSlug) => post({ action: 'finalizarRefab', rowIndex, usuario, usuarioSlug }),
  comentarCaso: (rowIndex, comentario, usuario, usuarioSlug) => post({ action: 'comentarCaso', rowIndex, comentario, usuario, usuarioSlug }),
  setStatus: (rowIndex, status, usuario) => post({ action: 'setStatus', rowIndex, status, usuario }),
  setSetor: (rowIndex, setor, usuario) => post({ action: 'setSetor', rowIndex, setor, usuario }),
  setDescricao: (rowIndex, descricao, usuario) => post({ action: 'setDescricao', rowIndex, descricao, usuario }),
  adicionarAnexos: (rowIndex, fotos, usuario, usuarioSlug) => post({ action: 'adicionarAnexos', rowIndex, fotos, usuario, usuarioSlug }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

// Só salva arquivo no Drive (não toca em planilha nem banco): sempre via Apps Script.
store.salvarFotoPreCaso = (fotos) => post({ action: 'salvarFotoPreCaso', fotos });

module.exports = store;
