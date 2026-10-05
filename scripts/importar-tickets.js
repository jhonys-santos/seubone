#!/usr/bin/env node
// Importa os tickets (e o histórico) da planilha para o Postgres, lendo direto
// do Apps Script — mesmos dados e mesmas datas que o painel recebe hoje.
//
//   node scripts/importar-tickets.js              # relatório (NÃO grava nada)
//   node scripts/importar-tickets.js --aplicar    # grava (só se as tabelas estiverem vazias)
//   node scripts/importar-tickets.js --aplicar --refazer   # apaga o que já tem e importa de novo
//
// Antes: rodar db/migrations/001_tickets.sql no Supabase e definir DATABASE_URL.
// Depois de importar sem problemas: rodar db/migrations/002_tickets_unicidade.sql.
const path = require('path');
const { paraTimestampBrasilia } = require('../src/services/ticketsDb.service');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const CAMPOS_DATA = ['dataAbertura', 'dataFechamento', 'dataEvento', 'ppe', 'previsaoFinalizacao', 'pFolha', 'novoPrazo', 'previsaoEntregaTransportadora'];
const t = (v) => String(v == null ? '' : v).trim();

/** Uma linha de ticket (formato do Apps Script) -> valores na ordem das colunas do INSERT. */
const COLUNAS_INSERT = [
  'row_index', 'id_ticket', 'pedido', 'id_venda', 'identificador', 'fabrica', 'setor', 'responsavel', 'responsavel_slug', 'status',
  'data_abertura', 'data_fechamento', 'origem', 'link', 'observacao', 'anexos', 'tem_evento', 'data_evento', 'entrega', 'aeroporto',
  'ppe', 'previsao_finalizacao', 'p_folha', 'novo_prazo', 'atraso_notificado', 'negocio_id', 'codigo_rastreio', 'previsao_entrega_transportadora',
];
function valoresDoTicket(x, avisos) {
  const data = (campo) => {
    const bruto = t(x[campo]);
    if (!bruto) return null;
    const ts = paraTimestampBrasilia(bruto);
    if (ts == null) avisos.push(`ticket ${x.rowIndex} (${x.idTicket}): ${campo} não reconhecida "${bruto.slice(0, 40)}" -> ficará vazia`);
    return ts;
  };
  return [
    Number(x.rowIndex), t(x.idTicket), t(x.pedido), t(x.idVenda), t(x.identificador), t(x.fabrica), t(x.setor), t(x.responsavel), t(x.responsavelSlug),
    t(x.status) || 'Aberto', data('dataAbertura'), data('dataFechamento'), t(x.origem), t(x.link), t(x.observacao), t(x.anexos),
    !!x.temEvento, data('dataEvento'), t(x.entrega), t(x.aeroporto),
    data('ppe'), data('previsaoFinalizacao'), data('pFolha'), data('novoPrazo'), !!x.atrasoNotificado, t(x.negocioId), t(x.codigoRastreio),
    data('previsaoEntregaTransportadora'),
  ];
}

/** Confere a origem sem gravar: devolve o relatório (problemas que merecem atenção antes de importar). */
function analisar({ tickets, eventos }) {
  const rel = { total: tickets.length, eventos: eventos ? eventos.length : null, avisos: [], duplicadosIdTicket: [], duplicadosNegocio: [], statusVazio: 0, semData: 0, orfaos: 0 };
  const porId = new Map(); const porNegocio = new Map(); const linhas = new Set();
  for (const x of tickets) {
    if (!Number.isInteger(Number(x.rowIndex)) || Number(x.rowIndex) < 2) rel.avisos.push(`ticket com rowIndex inválido: ${x.rowIndex} (${x.idTicket})`);
    linhas.add(Number(x.rowIndex));
    const id = t(x.idTicket);
    if (!id) rel.avisos.push(`ticket da linha ${x.rowIndex} sem idTicket`);
    else { if (!porId.has(id)) porId.set(id, []); porId.get(id).push(x.rowIndex); }
    if (t(x.negocioId)) {
      const k = `${t(x.negocioId)}|${t(x.identificador).toLowerCase()}`;
      if (!porNegocio.has(k)) porNegocio.set(k, []);
      porNegocio.get(k).push(`${x.idTicket}(linha ${x.rowIndex}, ${x.status})`);
    }
    if (!t(x.status)) rel.statusVazio++;
    if (!t(x.dataAbertura)) rel.semData++;
    valoresDoTicket(x, rel.avisos);
  }
  rel.duplicadosIdTicket = [...porId.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} nas linhas ${v.join(', ')}`);
  rel.duplicadosNegocio = [...porNegocio.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k.split('|')[1] || '?'} / negócio ${k.split('|')[0].slice(0, 8)}…: ${v.join(' + ')}`);
  if (eventos) rel.orfaos = eventos.filter((e) => !linhas.has(Number(e.rowIndex))).length;
  return rel;
}

/** Grava no banco (numa transação) e devolve quantos foram. Recusa tabela não vazia, a não ser com refazer. */
async function importar({ tickets, eventos }, db, { refazer = false } = {}) {
  const avisos = [];
  return db.transaction(async (tx) => {
    const existe = await tx.query('select count(*)::int as n from tickets');
    if (existe.rows[0].n > 0) {
      if (!refazer) throw new Error(`A tabela tickets já tem ${existe.rows[0].n} linhas. Use --refazer para apagar e importar de novo.`);
      await tx.query('delete from ticket_historico');
      await tx.query('delete from tickets');
    }
    const ordenados = [...tickets].sort((a, b) => Number(a.rowIndex) - Number(b.rowIndex));
    const cols = COLUNAS_INSERT.join(', ');
    for (const x of ordenados) {
      const v = valoresDoTicket(x, avisos);
      await tx.query(`insert into tickets (${cols}) values (${v.map((_, i) => '$' + (i + 1)).join(', ')})`, v);
    }
    // próximo ticket novo continua depois do maior rowIndex importado
    await tx.query(`select setval(pg_get_serial_sequence('tickets', 'row_index'), (select max(row_index) from tickets))`);

    let nEventos = 0;
    if (eventos && eventos.length) {
      const validos = eventos.filter((e) => Number.isInteger(Number(e.rowIndex)));
      for (let i = 0; i < validos.length; i += 200) {
        const lote = validos.slice(i, i + 200);
        const params = []; const linhas = [];
        lote.forEach((e, k) => {
          const ts = ISO.test(t(e.quando)) ? t(e.quando).replace('T', ' ') : null;
          if (!ts) avisos.push(`evento do ticket ${e.rowIndex}: data inválida "${t(e.quando).slice(0, 30)}" -> usada a data de agora`);
          const b = params.length;
          // Texto do histórico entra exatamente como está na planilha (sem aparar espaços): é um registro do que aconteceu.
          const cru = (v) => String(v == null ? '' : v);
          params.push(Number(e.rowIndex), t(e.idTicket), ts, cru(e.usuario) || '—', cru(e.acao), cru(e.detalhe), cru(e.slug));
          linhas.push(`($${b + 1}, $${b + 2}, coalesce($${b + 3}::timestamp, (now() at time zone 'America/Sao_Paulo')), $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
        });
        await tx.query(`insert into ticket_historico (ticket_row_index, id_ticket, quando, usuario, acao, detalhe, slug) values ${linhas.join(', ')}`, params);
        nEventos += lote.length;
      }
    }
    return { tickets: ordenados.length, eventos: nEventos, avisos };
  });
}

/** Lê do banco o que o painel receberia e compara, ticket a ticket e campo a campo, com a origem. */
async function conferir({ tickets }, listar) {
  const lido = (await listar()).tickets;
  const porLinha = new Map(lido.map((x) => [x.rowIndex, x]));
  const problemas = [];
  for (const o of tickets) {
    const d = porLinha.get(Number(o.rowIndex));
    if (!d) { problemas.push(`linha ${o.rowIndex}: não está no banco`); continue; }
    for (const k of Object.keys(d)) {
      let esperado = o[k];
      if (typeof d[k] === 'boolean') esperado = !!esperado;
      else if (k === 'rowIndex') esperado = Number(esperado);
      else esperado = t(esperado) || (k === 'status' ? 'Aberto' : '');
      if (CAMPOS_DATA.includes(k) && esperado && !ISO.test(esperado)) continue; // texto que não era data: foi avisado
      if (d[k] !== esperado) problemas.push(`linha ${o.rowIndex} campo ${k}: origem "${String(esperado).slice(0, 40)}" x banco "${String(d[k]).slice(0, 40)}"`);
    }
  }
  if (lido.length !== tickets.length) problemas.push(`quantidade: origem ${tickets.length} x banco ${lido.length}`);
  return problemas;
}

/** Compara o histórico de TODOS os tickets: como o painel mostra (mais novo primeiro, dd/MM/aaaa HH:mm) x origem. */
async function conferirHistorico({ eventos }, db) {
  if (!eventos) return [];
  const formata = (iso) => (ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : iso);
  const esperado = new Map();
  for (const e of eventos) {
    const k = Number(e.rowIndex);
    if (!esperado.has(k)) esperado.set(k, []);
    esperado.get(k).push({ quando: formata(String(e.quando)), usuario: String(e.usuario || '—'), acao: String(e.acao || ''), detalhe: String(e.detalhe || '') });
  }
  const r = await db.query(`select ticket_row_index::int as n, to_char(quando, 'DD/MM/YYYY HH24:MI') as quando, usuario, acao, detalhe
                              from ticket_historico order by ticket_row_index, id`);
  const obtido = new Map();
  for (const x of r.rows) { if (!obtido.has(x.n)) obtido.set(x.n, []); obtido.get(x.n).push({ quando: x.quando, usuario: x.usuario, acao: x.acao, detalhe: x.detalhe }); }
  const problemas = [];
  for (const k of new Set([...esperado.keys(), ...obtido.keys()])) {
    const a = JSON.stringify(esperado.get(k) || []); const b = JSON.stringify(obtido.get(k) || []);
    if (a !== b) problemas.push(`ticket linha ${k}: histórico diferente (origem ${(esperado.get(k) || []).length} x banco ${(obtido.get(k) || []).length} eventos)`);
  }
  return problemas;
}

async function buscarOrigem() {
  const env = require('../src/config/env');
  const pegar = async (extra) => {
    const u = new URL(env.ticketsAppsScriptUrl);
    u.searchParams.set('segredo', env.appsScriptSharedSecret);
    Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(170000) });
    return r.json();
  };
  const lista = await pegar();
  if (!lista.ok || !Array.isArray(lista.tickets)) throw new Error('Apps Script não devolveu os tickets: ' + (lista.error || '?'));
  let eventos = null;
  const h = await pegar({ action: 'historicoCompleto' });
  if (h.ok && Array.isArray(h.eventos)) eventos = h.eventos;
  return { tickets: lista.tickets, eventos };
}

async function principal() {
  const aplicar = process.argv.includes('--aplicar');
  const refazer = process.argv.includes('--refazer');
  console.log('Lendo do Apps Script (pode levar um minuto, a planilha é lenta)...');
  const origem = await buscarOrigem();
  const rel = analisar(origem);
  console.log(`\nTickets: ${rel.total} | Eventos de histórico: ${rel.eventos == null ? 'NÃO LIDOS (publique o Code.gs novo no Apps Script)' : rel.eventos}`);
  console.log(`Sem data de abertura: ${rel.semData} | Status vazio (vira "Aberto"): ${rel.statusVazio} | Eventos sem ticket: ${rel.orfaos}`);
  console.log(`idTicket repetido entre tickets diferentes (já era assim na planilha; é mantido): ${rel.duplicadosIdTicket.length}${rel.duplicadosIdTicket.length ? '\n  ' + rel.duplicadosIdTicket.join('\n  ') : ''}`);
  console.log(`Mesmo negócio + mesmo identificador (impede o índice único 002): ${rel.duplicadosNegocio.length}${rel.duplicadosNegocio.length ? '\n  ' + rel.duplicadosNegocio.join('\n  ') : ''}`);
  if (rel.avisos.length) console.log(`Avisos (${rel.avisos.length}):\n  ` + rel.avisos.slice(0, 30).join('\n  '));
  if (!aplicar) { console.log('\nNada foi gravado (modo relatório). Use --aplicar para importar.'); return; }

  const db = require('../src/db');
  const r = await importar(origem, db, { refazer });
  console.log(`\nImportados: ${r.tickets} tickets e ${r.eventos} eventos.`);
  const problemas = await conferir(origem, () => require('../src/services/ticketsDb.service').listar());
  if (problemas.length) { console.log(`\nCONFERÊNCIA: ${problemas.length} diferenças:\n  ` + problemas.slice(0, 40).join('\n  ')); process.exitCode = 1; }
  else console.log('CONFERÊNCIA: todos os campos de todos os tickets batem com a origem.');
  const probHist = await conferirHistorico(origem, db);
  if (probHist.length) { console.log(`CONFERÊNCIA DO HISTÓRICO: ${probHist.length} diferenças:\n  ` + probHist.slice(0, 40).join('\n  ')); process.exitCode = 1; }
  else if (origem.eventos) console.log(`CONFERÊNCIA DO HISTÓRICO: os ${origem.eventos.length} eventos de todos os tickets batem com a origem.`);
  await db.fechar();
}

module.exports = { analisar, importar, conferir, conferirHistorico, valoresDoTicket };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
