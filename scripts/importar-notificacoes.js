#!/usr/bin/env node
// Importa as notificações ainda não apagadas da planilha (aba "Notificacoes" do
// Registro de Demandas) para o Postgres. São poucas e de vida curta (somem quando
// lidas), então é rápido; rode logo antes de ligar NOTIFICACOES_BACKEND=db.
//
//   node scripts/importar-notificacoes.js              # relatório (não grava)
//   node scripts/importar-notificacoes.js --aplicar    # grava (tabela precisa estar vazia)
//   node scripts/importar-notificacoes.js --aplicar --refazer
const path = require('path');

async function importar(lista, db, { refazer = false } = {}) {
  return db.transaction(async (tx) => {
    const ja = await tx.query('select count(*)::int as n from notificacoes');
    if (ja.rows[0].n > 0) {
      if (!refazer) throw new Error(`A tabela notificacoes já tem ${ja.rows[0].n} linhas. Use --refazer para apagar e importar de novo.`);
      await tx.query('delete from notificacoes');
    }
    let n = 0;
    for (const x of lista) {
      if (!x.id) continue;
      const criada = x.criadoEm && !Number.isNaN(Date.parse(x.criadoEm)) ? new Date(x.criadoEm).toISOString() : null;
      await tx.query(
        `insert into notificacoes (id, mensagem, link, destinatario, lida_por, criada_em)
         values ($1, $2, $3, $4, $5::text[], coalesce($6::timestamptz, now()))`,
        [String(x.id), String(x.mensagem || ''), x.link || null, x.destinatario || '', Array.isArray(x.lidaPor) ? x.lidaPor : [], criada],
      );
      n++;
    }
    return n;
  });
}

async function principal() {
  const env = require('../src/config/env');
  const u = new URL(env.registroDemandasAppsScriptUrl);
  u.searchParams.set('segredo', env.appsScriptSharedSecret);
  u.searchParams.set('action', 'listarNotificacoes');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(170000) });
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error('Apps Script não devolveu a lista de notificações.');
  const gerais = lista.filter((x) => !x.destinatario).length;
  console.log(`Notificações na planilha: ${lista.length} (${gerais} gerais, ${lista.length - gerais} direcionadas)`);
  if (!process.argv.includes('--aplicar')) { console.log('Nada foi gravado (modo relatório). Use --aplicar.'); return; }
  const db = require('../src/db');
  const n = await importar(lista, db, { refazer: process.argv.includes('--refazer') });
  const c = await db.query('select count(*)::int as n from notificacoes');
  console.log(`Importadas: ${n}. No banco agora: ${c.rows[0].n}.`);
  await db.fechar();
}

module.exports = { importar };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
