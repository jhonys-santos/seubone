#!/usr/bin/env node
// Backup do banco para as planilhas (abas "bkp AAAA-MM-DD <nome>"). O agendador do hub roda isso
// sozinho seg-sex depois das 20h; este script serve para testar ou rodar na hora.
//
//   node scripts/backup-planilhas.js --simular   # lê o banco e mostra o que enviaria (não envia)
//   node scripts/backup-planilhas.js --agora     # envia de verdade para as planilhas
const backup = require('../src/services/backupPlanilhas.service');
const db = require('../src/db');

async function principal() {
  const simular = process.argv.includes('--simular');
  if (!simular && !process.argv.includes('--agora')) {
    console.log('Use --simular (só mostra) ou --agora (envia para as planilhas).');
    process.exit(1);
  }
  const ativas = backup.areasAtivas();
  if (!ativas.length) {
    console.log('Nenhuma área está no banco (flags *_BACKEND=db) ou falta a URL do Apps Script. Nada a fazer.');
    return;
  }
  const r = await backup.rodarBackup({ simular });
  console.log(`Data do backup: ${r.data}${simular ? ' (simulação, nada foi enviado)' : ''}`);
  for (const a of r.areas) {
    if (a.erro) console.log(`  ✗ ${a.rotulo}: ${a.erro}`);
    else console.log(`  ✓ ${a.rotulo}: ${a.abas.map((x) => `${x.nome} (${x.linhas} linhas)`).join(', ')}${a.removidas && a.removidas.length ? ` | apagadas: ${a.removidas.join(', ')}` : ''}`);
  }
  if (!r.ok) process.exitCode = 1;
}

principal()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.fechar && db.fechar());
