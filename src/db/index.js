// Acesso ao Postgres (Supabase). Interface mínima — query() e transaction() —
// pra dar pra trocar o motor nos testes (PGlite em memória) sem tocar nos
// serviços que usam o banco.
const env = require('../config/env');

let adaptador = null;
let pool = null;

function criarPool() {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL não configurada (use a string do pooler do Supabase).');
  }
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(env.databaseUrl);
  return new Pool({
    connectionString: env.databaseUrl,
    // Supabase exige SSL; o certificado do pooler não vem de uma CA pública
    // conhecida pelo Node, daí rejectUnauthorized: false (a conexão continua
    // criptografada).
    ssl: local ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

function obterPool() {
  if (!pool) {
    pool = criarPool();
    pool.on('error', (e) => console.error('[db] erro numa conexão ociosa:', e.message));
  }
  return pool;
}

/** Só para testes: troca o motor ({ query, transaction }). */
function definirAdaptador(a) { adaptador = a; }

/** SELECT/INSERT/UPDATE simples. Devolve o resultado do driver ({ rows, rowCount }). */
async function query(texto, params) {
  if (adaptador) return adaptador.query(texto, params);
  return obterPool().query(texto, params);
}

/** Executa `fn(tx)` numa transação; tx.query(texto, params). Faz rollback se fn lançar. */
async function transaction(fn) {
  if (adaptador) return adaptador.transaction(fn);
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn({ query: (t, p) => cliente.query(t, p) });
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* conexão já caiu */ }
    throw e;
  } finally {
    cliente.release();
  }
}

async function fechar() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { query, transaction, definirAdaptador, fechar };
