// Ponto único de acesso ao Foco da Semana e à Agenda da Semana: decide, a cada chamada, se vai
// pro Postgres (AGENDA_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./agendaDb.service');

const usaBanco = () => env.agendaBackend === 'db';
const post = (body) => chamarAppsScript(env.agendaSemanaAppsScriptUrl, { method: 'POST', body });

const planilha = {
  ler: () => chamarAppsScript(env.agendaSemanaAppsScriptUrl, { params: { action: 'ler' }, cache: true }),
  salvarFoco: (texto) => post({ action: 'salvarFoco', texto }),
  adicionarEvento: (dia, hora, descricao, tipo) => post({ action: 'adicionarEvento', dia, hora, descricao, tipo }),
  editarEvento: (linha, dia, hora, descricao, tipo) => post({ action: 'editarEvento', linha, dia, hora, descricao, tipo }),
  excluirEvento: (linha) => post({ action: 'excluirEvento', linha }),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
