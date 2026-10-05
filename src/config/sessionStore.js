// Onde ficam as sessões de login. SESSION_STORE=pg usa o Postgres (sobrevive a
// deploys do Render); qualquer outro valor usa arquivos em disco, como sempre foi.
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const env = require('./env');

const UMA_HORA_MS = 60 * 60 * 1000;

function criarStoreArquivos() {
  // A pasta não é versionada: num deploy novo ela não existe. Sem criar, a store
  // falha em silêncio e o login fica preso num loop de redirecionamento.
  const dir = path.join(env.dataDir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const FileStore = require('session-file-store')(session);
  return new FileStore({ path: dir, logFn: () => {} });
}

/**
 * express-session "toca" a sessão em TODA requisição para renovar a validade; no
 * Postgres isso seria uma escrita a mais por clique. Aqui renova no máximo 1x por hora
 * por sessão (a validade é de 7 dias, então a diferença é imperceptível).
 */
function limitarToques(store) {
  const ultimo = new Map();
  const tocar = store.touch.bind(store);
  store.touch = (sid, sess, cb) => {
    const agora = Date.now();
    if (agora - (ultimo.get(sid) || 0) < UMA_HORA_MS) return cb();
    if (ultimo.size > 5000) ultimo.clear();
    ultimo.set(sid, agora);
    return tocar(sid, sess, cb);
  };
  return store;
}

function criarStorePostgres() {
  const PgStore = require('connect-pg-simple')(session);
  const { obterPool } = require('../db');
  const store = new PgStore({
    pool: obterPool(),
    tableName: 'sessoes',
    createTableIfMissing: false, // a tabela vem de db/migrations/004_sessoes.sql
    pruneSessionInterval: 60 * 15, // apaga sessões vencidas a cada 15 min
    errorLog: (e) => console.error('[sessao]', e && e.message),
  });
  return limitarToques(store);
}

function criarStore() {
  return env.sessionStore === 'pg' ? criarStorePostgres() : criarStoreArquivos();
}

module.exports = { criarStore, limitarToques };
