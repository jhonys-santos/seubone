#!/usr/bin/env node
// Testes ISOLADOS da integração com o Demandas do finfin. Nada aqui mexe no Registro antigo (nem no n8n).
// Precisa de FINFIN_DEMANDAS_TOKEN no .env só para os comandos que falam com o finfin.
//
//   node scripts/finfin-testar.js --listas                 # nomes de demanda aceitos hoje no finfin + equivalência com a lista antiga do hub
//   node scripts/finfin-testar.js                          # PRÉVIA do card de um pedido de exemplo (não envia nada)
//   node scripts/finfin-testar.js --enviar                 # cria UM card de teste, com "[TESTE]" no título
//   node scripts/finfin-testar.js --consultar DM-0042      # mostra o card
//   node scripts/finfin-testar.js --cancelar DM-0042       # move o card para "Cancelado" (para limpar os testes)
// Opções do pedido de exemplo: --demanda "NF Urgente"  --email voce@seubone.com
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const F = require('../src/services/finfinDemandas.service');

const args = process.argv.slice(2);
const valor = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const tem = (flag) => args.includes(flag);
const mostrar = (o) => console.log(JSON.stringify(o, (k, v) => (k === 'conteudo_base64' ? `<${String(v).length} caracteres base64>` : v), 2));

(async () => {
  if (tem('--listas')) {
    const r = await F.listarDemandas();
    console.log('Resposta do finfin (?listas=1):'); mostrar(r.bruto);
    console.log('\nNomes de demanda aceitos:', r.nomes.length ? r.nomes : '(não consegui identificar a lista na resposta acima: me mande esse JSON)');
    if (r.nomes.length) {
      console.log('\nLista antiga do hub  ->  nome no finfin');
      for (const d of F.DEMANDAS_RESERVA) { const n = F.resolverDemanda(d, r.nomes); console.log(`  ${d.padEnd(34)} ${n ? (n === d ? '= ' + n : '→ ' + n) : '✗ NÃO EXISTE no finfin'}`); }
    }
    return;
  }
  if (valor('--consultar')) { mostrar(await F.consultarCard(valor('--consultar'))); return; }
  if (valor('--cancelar')) { mostrar(await F.moverCard(valor('--cancelar'), 'cancelado')); return; }

  let demandasFinfin = null;
  if (F.configurado()) { const l = await F.listarDemandas(); if (l.nomes.length) demandasFinfin = l.nomes; }
  const { payload, erros } = F.montarCard({
    solicitante: 'Jhonys Santos', email: valor('--email') || 'jhonys@seubone.com', telefone: '', demandaSolicitada: valor('--demanda') || 'NF Urgente',
    descricao: 'TESTE da integração do hub com o finfin. Pode cancelar este card.', linkLulu: 'https://lulu.seubone.com/business/?businessId=teste', anexos: [],
  }, { demandasFinfin, prefixoTitulo: '[TESTE] ' });
  console.log(`Prévia do card (${demandasFinfin ? 'validado com a lista real do finfin' : 'SEM validar a demanda: lista do finfin indisponível'}):`); mostrar(payload);
  erros.forEach((e) => console.log('ERRO:', e));
  if (!tem('--enviar')) { console.log('\n(prévia: nada foi enviado; use --enviar para criar um card de teste)'); return; }
  if (erros.length) { console.log('\nNão enviei: corrija os erros acima.'); process.exitCode = 1; return; }
  const r = await F.criarCard(payload);
  mostrar(r);
  if (r.ok) console.log(`\nCard criado: ${r.codigo}. Para consultar: --consultar ${r.codigo}   |   para limpar: --cancelar ${r.codigo}`);
  else process.exitCode = 1;
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
