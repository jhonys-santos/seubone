#!/usr/bin/env node
// Testes ISOLADOS da integração com o Demandas do finfin. Nada aqui mexe no Registro do hub (nem no n8n).
// Precisa de FINFIN_DEMANDAS_TOKEN no .env só para os comandos que falam com o finfin.
//
//   node scripts/finfin-testar.js --listas                 # nomes de demanda aceitos hoje no finfin + equivalência com a lista do hub
//   node scripts/finfin-testar.js                          # PRÉVIA do card de um registro de exemplo (não envia nada)
//   node scripts/finfin-testar.js --registro RD1760000000  # prévia de um registro real do banco (somente leitura)
//   node scripts/finfin-testar.js --enviar                 # cria UM card de teste, com "[TESTE]" no título (combine com --registro se quiser)
//   node scripts/finfin-testar.js --consultar DM-0042      # mostra o card
//   node scripts/finfin-testar.js --cancelar DM-0042       # move o card para "Cancelado" (para limpar os testes)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const F = require('../src/services/finfinDemandas.service');

// Mesma lista do formulário do Registro (views/registro-demandas/index.ejs).
const DEMANDAS_DO_HUB = ['NF Urgente', 'Nota de Remessa', 'Baixa de comprovante', 'Análise de termo de compromisso', 'Nota de Conta e Ordem', 'Link de pagamento',
  'Orçamento - Extrema/MG', 'Ajuste de nota fiscal', 'Ajuste de orçamento', 'Envio de boleto', 'Liberação p/envio', 'Nota de Devolução', 'Amostras', 'Nota de Brinde',
  'Manifesto', 'Cancelamento de Boleto', 'Pedidos retidos', 'Outros'];

const args = process.argv.slice(2);
const valor = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const tem = (flag) => args.includes(flag);
const mostrar = (o) => console.log(JSON.stringify(o, (k, v) => (k === 'conteudo_base64' ? `<${String(v).length} caracteres base64>` : v), 2));

function registroDeExemplo() {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  return {
    id: 'RD-EXEMPLO-' + hoje, solicitante: 'Jhonys Santos', email: 'jhonys@seubone.com', numeroCorporativo: '(84) 90000-0000', empresa: 'SeuBoné', tipoDemanda: 'Avulsa',
    demandaSolicitada: 'NF Urgente', data: hoje, dataVencimento: hoje, idCompra: '0000', linkCard: 'https://lulu.seubone.com/business/?businessId=teste',
    observacao: 'TESTE da integração do hub com o finfin. Pode cancelar este card.', anexos: [],
  };
}

async function registroDoBanco(id) {
  const db = require('../src/db');
  const r = await db.query(
    `select id, to_char(data, 'YYYY-MM-DD') as data, to_char(data_vencimento, 'YYYY-MM-DD') as "dataVencimento", id_compra as "idCompra", link_card as "linkCard",
            solicitante, empresa, numero_corporativo as "numeroCorporativo", tipo_demanda as "tipoDemanda", demanda_solicitada as "demandaSolicitada",
            observacao, email, anexos from registro_demandas where id = $1`, [id]);
  await db.fechar();
  if (!r.rows[0]) throw new Error('Registro não encontrado: ' + id);
  const x = r.rows[0];
  // No banco os anexos já são links do Drive (o arquivo em si não fica aqui): vão como links no card.
  let lista = x.anexos;
  if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }   // a coluna guarda o JSON como texto
  return { ...x, anexos: [], anexosDrive: Array.isArray(lista) ? lista : [] };
}

(async () => {
  if (tem('--listas')) {
    const r = await F.listarDemandas();
    console.log('Resposta do finfin (?listas=1):'); mostrar(r.bruto);
    console.log('\nNomes de demanda aceitos:', r.nomes.length ? r.nomes : '(não consegui identificar a lista na resposta acima: me mande esse JSON)');
    if (r.nomes.length) {
      console.log('\nLista do hub  ->  nome no finfin');
      for (const d of DEMANDAS_DO_HUB) { const n = F.resolverDemanda(d, r.nomes); console.log(`  ${d.padEnd(34)} ${n ? (n === d ? '= ' + n : '→ ' + n) : '✗ NÃO EXISTE no finfin'}`); }
    }
    return;
  }
  if (valor('--consultar')) { mostrar(await F.consultarCard(valor('--consultar'))); return; }
  if (valor('--cancelar')) { mostrar(await F.moverCard(valor('--cancelar'), 'cancelado')); return; }

  const registro = valor('--registro') ? await registroDoBanco(valor('--registro')) : registroDeExemplo();
  let demandasFinfin = null;
  if (F.configurado()) { const l = await F.listarDemandas(); if (l.nomes.length) demandasFinfin = l.nomes; }
  const { payload, avisos, erros } = F.montarCard(registro, { demandasFinfin, prefixoTitulo: tem('--enviar') ? '[TESTE] ' : '' });
  console.log(`Prévia do card (${demandasFinfin ? 'validado com a lista real do finfin' : 'SEM validar a demanda: lista do finfin indisponível'}):`); mostrar(payload);
  avisos.forEach((a) => console.log('AVISO:', a));
  erros.forEach((e) => console.log('ERRO:', e));
  if (!tem('--enviar')) { console.log('\n(prévia: nada foi enviado; use --enviar para criar um card de teste)'); return; }
  if (erros.length) { console.log('\nNão enviei: corrija os erros acima.'); process.exitCode = 1; return; }
  const r = await F.criarCard(payload);
  mostrar(r);
  if (r.ok) console.log(`\nCard criado: ${r.codigo}. Para consultar: --consultar ${r.codigo}   |   para limpar: --cancelar ${r.codigo}`);
  else process.exitCode = 1;
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
