#!/usr/bin/env node
// Simula o finfin chamando o webhook do hub (card concluído + anexos). Usa FINFIN_WEBHOOK_SECRET do .env (nunca o imprime).
//
//   node scripts/finfin-webhook-testar.js --codigo DM-0042                       # conclui o card (sem anexos) no hub de produção
//   node scripts/finfin-webhook-testar.js --codigo DM-0042 --anexo C:\pasta\nf.pdf   # com anexo (pode repetir --anexo)
//   node scripts/finfin-webhook-testar.js --codigo DM-0042 --coluna fazendo        # só muda a coluna
//   node scripts/finfin-webhook-testar.js --codigo DM-0042 --url http://localhost:3000/webhooks/finfin/demandas
// Só faz efeito em cards que o hub criou (os que estão na tabela finfin_demandas).
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const valores = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const um = (flag, padrao) => valores(flag)[0] || padrao;

(async () => {
  const segredo = process.env.FINFIN_WEBHOOK_SECRET;
  if (!segredo) { console.error('FINFIN_WEBHOOK_SECRET não está no .env.'); process.exit(1); }
  const codigo = um('--codigo');
  if (!codigo) { console.error('Informe --codigo DM-0042'); process.exit(1); }
  const anexos = valores('--anexo').map((p) => ({ nome: path.basename(p), tipo: /\.pdf$/i.test(p) ? 'application/pdf' : /\.png$/i.test(p) ? 'image/png' : /\.xml$/i.test(p) ? 'text/xml' : 'application/octet-stream', conteudo_base64: fs.readFileSync(p).toString('base64') }));
  const corpo = { evento: 'card.movido', codigo, coluna: { chave: um('--coluna', 'concluido') }, ...(anexos.length ? { anexos } : {}) };
  const url = um('--url', 'https://seubone.onrender.com/webhooks/finfin/demandas');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo}` }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(120000) });
  console.log('HTTP', r.status, await r.text());
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
