// Ponto único de acesso aos tickets. Quem precisa de tickets (rotas, painéis,
// jobs) chama AQUI; este módulo decide, a cada chamada, se vai pro Postgres
// (TICKETS_BACKEND=db) ou pra planilha via Apps Script (padrão, como sempre
// foi). Assim a troca é uma variável de ambiente, e dá pra voltar na hora.
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./ticketsDb.service');

const usaBanco = () => env.ticketsBackend === 'db';

const post = (action, f) => chamarAppsScript(env.ticketsAppsScriptUrl, { method: 'POST', body: { action, ...f } });

const planilha = {
  listar: () => chamarAppsScript(env.ticketsAppsScriptUrl, { cache: true }),
  historico: (rowIndex) => chamarAppsScript(env.ticketsAppsScriptUrl, { params: { action: 'historico', rowIndex }, cache: true }),
  criar: (f) => post('criar', f),
  atribuir: (f) => post('atribuir', f),
  mudarStatus: (f) => post('mudarStatus', f),
  comentar: (f) => post('comentarTicket', f),
  adicionarAnexos: (f) => post('adicionarAnexos', f),
  removerAnexo: (f) => post('removerAnexo', f),
  atualizarFabrica: (f) => post('atualizarFabrica', f),
  atualizarSetor: (f) => post('atualizarSetor', f),
  atualizarNovoPrazo: (f) => post('atualizarNovoPrazo', f),
  atualizarAcompanhamento: (f) => post('atualizarAcompanhamento', f),
  definirLink: (f) => post('definirLink', f),
  marcarAtrasoNotificado: (f) => post('marcarAtrasoNotificado', f),
};

const store = {};
Object.keys(planilha).forEach((nome) => {
  store[nome] = (...args) => (usaBanco() ? banco[nome](...args) : planilha[nome](...args));
});

module.exports = store;
