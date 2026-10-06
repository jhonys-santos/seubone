#!/usr/bin/env node
// Importa os casos do Painel de Erros (e o histórico) da planilha para o Postgres,
// lendo direto do Apps Script, com os mesmos dados que o painel recebe hoje.
//
//   node scripts/importar-erros.js              # relatório (NÃO grava nada)
//   node scripts/importar-erros.js --aplicar    # grava (só se as tabelas estiverem vazias)
//   node scripts/importar-erros.js --aplicar --refazer   # apaga o que já tem e importa de novo
//
// Antes: rodar db/migrations/005_erros.sql e publicar o Code.gs novo do Painel de Erros
// (ação historicoCompleto). Depois de importar: ligar ERROS_BACKEND=db.
const path = require('path');
const { parseNumero, extrairLink } = require('../src/services/errosDb.service');

const t = (v) => String(v == null ? '' : v).trim();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function paraData(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t(texto));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const COLUNAS = [
  'row_index', 'data', 'auditoria', 'id_venda', 'nome_card', 'descricao', 'link_pedido', 'quem_cadastrou', 'culpa_de', 'setor', 'responsavel',
  'empresa', 'tipo_problema', 'subproblema', 'qtd', 'custo', 'tipo_produto', 'linha', 'que_fim', 'tipo_resolucao', 'status', 'foto',
  'aprovacao_refab', 'comentario_aprovacao', 'comentario_final', 'registrado_por_slug',
];
function valoresDoCaso(x, avisos) {
  let data = null;
  if (t(x.data)) {
    data = paraData(x.data);
    if (data == null) avisos.push(`caso linha ${x.rowIndex}: data não reconhecida "${t(x.data).slice(0, 30)}" -> ficará vazia`);
  }
  const num = (v) => (v === '' || v == null ? null : Number(v));
  // O link derivado do texto da descrição não é gravado: continua sendo derivado na leitura, como na planilha.
  const link = t(x.linkPedido) === extrairLink(x.descricao) ? '' : t(x.linkPedido);
  return [
    Number(x.rowIndex), data, !!x.auditoria, t(x.idVenda), t(x.nomeCard), x.descricao == null ? '' : String(x.descricao), link, t(x.quemCadastrou),
    t(x.culpaDe), t(x.setor), t(x.responsavel), t(x.empresa), t(x.tipoProblema), t(x.subproblema), num(x.qtd), num(x.custo), t(x.tipoProduto),
    t(x.linha), t(x.queFim), t(x.tipoResolucao), t(x.status), t(x.foto), t(x.aprovacaoRefab), t(x.comentarioAprovacao), t(x.comentarioFinal),
    t(x.registradoPorSlug),
  ];
}

function analisar({ rows, eventos }) {
  const rel = { total: rows.length, eventos: eventos ? eventos.length : null, avisos: [], semData: 0, orfaos: 0, refabPendentes: 0 };
  const linhas = new Set();
  for (const x of rows) {
    if (!Number.isInteger(Number(x.rowIndex)) || Number(x.rowIndex) < 2) rel.avisos.push(`caso com rowIndex inválido: ${x.rowIndex}`);
    linhas.add(Number(x.rowIndex));
    if (!t(x.data)) rel.semData++;
    if (t(x.aprovacaoRefab) === 'Pendente') rel.refabPendentes++;
    valoresDoCaso(x, rel.avisos);
  }
  if (eventos) rel.orfaos = eventos.filter((e) => !linhas.has(Number(e.rowIndex))).length;
  return rel;
}

async function importar({ rows, eventos }, db, { refazer = false } = {}) {
  const avisos = [];
  return db.transaction(async (tx) => {
    const existe = await tx.query('select count(*)::int as n from erros_casos');
    if (existe.rows[0].n > 0) {
      if (!refazer) throw new Error(`A tabela erros_casos já tem ${existe.rows[0].n} linhas. Use --refazer para apagar e importar de novo.`);
      await tx.query('delete from erros_historico');
      await tx.query('delete from erros_casos');
    }
    const ordenados = [...rows].sort((a, b) => Number(a.rowIndex) - Number(b.rowIndex));
    for (const x of ordenados) {
      const v = valoresDoCaso(x, avisos);
      await tx.query(`insert into erros_casos (${COLUNAS.join(', ')}) values (${v.map((_, i) => '$' + (i + 1)).join(', ')})`, v);
    }
    // o próximo caso novo continua depois do maior rowIndex importado
    await tx.query(`select setval(pg_get_serial_sequence('erros_casos', 'row_index'), greatest((select max(row_index) from erros_casos), 1))`);

    let nEventos = 0;
    if (eventos && eventos.length) {
      const validos = eventos.filter((e) => Number.isInteger(Number(e.rowIndex)));
      for (let i = 0; i < validos.length; i += 200) {
        const lote = validos.slice(i, i + 200);
        const params = []; const linhas = [];
        lote.forEach((e) => {
          const ts = ISO.test(t(e.quando)) ? t(e.quando).replace('T', ' ') : null;
          if (!ts) avisos.push(`evento do caso ${e.rowIndex}: data inválida "${t(e.quando).slice(0, 30)}" -> usada a data de agora`);
          const cru = (v) => String(v == null ? '' : v);
          const b = params.length;
          params.push(Number(e.rowIndex), t(e.idVenda), ts, cru(e.usuario) || '—', cru(e.acao), cru(e.detalhe), cru(e.slug));
          linhas.push(`($${b + 1}, $${b + 2}, coalesce($${b + 3}::timestamp, (now() at time zone 'America/Sao_Paulo')), $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
        });
        await tx.query(`insert into erros_historico (caso_row_index, id_venda, quando, usuario, acao, detalhe, slug) values ${linhas.join(', ')}`, params);
        nEventos += lote.length;
      }
    }
    return { casos: ordenados.length, eventos: nEventos, avisos };
  });
}

/** Lê do banco o que o painel receberia e compara, caso a caso e campo a campo, com a origem. */
async function conferir({ rows }, listar) {
  const lido = (await listar()).rows;
  const porLinha = new Map(lido.map((x) => [x.rowIndex, x]));
  const problemas = [];
  for (const o of rows) {
    const d = porLinha.get(Number(o.rowIndex));
    if (!d) { problemas.push(`linha ${o.rowIndex}: não está no banco`); continue; }
    for (const k of Object.keys(o)) {
      if (k === 'rowIndex' || !(k in d)) continue;
      let esperado = o[k];
      if (typeof d[k] === 'boolean') esperado = !!esperado;
      else if (k === 'qtd' || k === 'custo') esperado = esperado === '' || esperado == null ? '' : Number(esperado);
      else if (k === 'descricao') esperado = esperado == null ? '' : String(esperado);
      else esperado = t(esperado);
      if (k === 'data' && esperado && !paraData(esperado)) continue; // data fora do padrão: foi avisada
      if (d[k] !== esperado) problemas.push(`linha ${o.rowIndex} campo ${k}: origem "${String(esperado).slice(0, 40)}" x banco "${String(d[k]).slice(0, 40)}"`);
    }
  }
  if (lido.length !== rows.length) problemas.push(`quantidade: origem ${rows.length} x banco ${lido.length}`);
  return problemas;
}

/** Histórico de TODOS os casos: como o painel mostra (mais novo primeiro, dd/MM/aaaa HH:mm) x origem. */
async function conferirHistorico({ eventos }, db) {
  if (!eventos) return [];
  const formata = (iso) => (ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : iso);
  const esperado = new Map();
  for (const e of eventos) {
    const k = Number(e.rowIndex);
    if (!esperado.has(k)) esperado.set(k, []);
    esperado.get(k).push({ quando: formata(String(e.quando)), usuario: String(e.usuario || '—'), acao: String(e.acao || ''), detalhe: String(e.detalhe || '') });
  }
  const r = await db.query(`select caso_row_index::int as n, to_char(quando, 'DD/MM/YYYY HH24:MI') as quando, usuario, acao, detalhe from erros_historico order by caso_row_index, id`);
  const obtido = new Map();
  for (const x of r.rows) { if (!obtido.has(x.n)) obtido.set(x.n, []); obtido.get(x.n).push({ quando: x.quando, usuario: x.usuario, acao: x.acao, detalhe: x.detalhe }); }
  const problemas = [];
  for (const k of new Set([...esperado.keys(), ...obtido.keys()])) {
    if (JSON.stringify(esperado.get(k) || []) !== JSON.stringify(obtido.get(k) || [])) problemas.push(`caso linha ${k}: histórico diferente (origem ${(esperado.get(k) || []).length} x banco ${(obtido.get(k) || []).length} eventos)`);
  }
  return problemas;
}

async function buscarOrigem() {
  const env = require('../src/config/env');
  const pegar = async (extra) => {
    const u = new URL(env.errosAppsScriptUrl);
    u.searchParams.set('segredo', env.appsScriptSharedSecret);
    Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(170000) });
    return r.json();
  };
  const lista = await pegar();
  if (!lista.ok || !Array.isArray(lista.rows)) throw new Error('Apps Script não devolveu os casos: ' + (lista.error || '?'));
  let eventos = null;
  const h = await pegar({ action: 'historicoCompleto' });
  if (h.ok && Array.isArray(h.eventos)) eventos = h.eventos;
  return { rows: lista.rows, eventos };
}

async function principal() {
  const aplicar = process.argv.includes('--aplicar');
  const refazer = process.argv.includes('--refazer');
  console.log('Lendo do Apps Script (pode levar um minuto, a planilha é lenta)...');
  const origem = await buscarOrigem();
  const rel = analisar(origem);
  console.log(`\nCasos: ${rel.total} | Eventos de histórico: ${rel.eventos == null ? 'NÃO LIDOS (publique o Code.gs novo do Painel de Erros)' : rel.eventos}`);
  console.log(`Sem data: ${rel.semData} | Na fila de Refabricação (Pendente): ${rel.refabPendentes} | Eventos sem caso: ${rel.orfaos}`);
  if (rel.avisos.length) console.log(`Avisos (${rel.avisos.length}):\n  ` + rel.avisos.slice(0, 30).join('\n  '));
  if (!aplicar) { console.log('\nNada foi gravado (modo relatório). Use --aplicar para importar.'); return; }

  const db = require('../src/db');
  const r = await importar(origem, db, { refazer });
  console.log(`\nImportados: ${r.casos} casos e ${r.eventos} eventos.`);
  const problemas = await conferir(origem, () => require('../src/services/errosDb.service').listar());
  if (problemas.length) { console.log(`\nCONFERÊNCIA: ${problemas.length} diferenças:\n  ` + problemas.slice(0, 40).join('\n  ')); process.exitCode = 1; }
  else console.log('CONFERÊNCIA: todos os campos de todos os casos batem com a origem.');
  const probHist = await conferirHistorico(origem, db);
  if (probHist.length) { console.log(`CONFERÊNCIA DO HISTÓRICO: ${probHist.length} diferenças:\n  ` + probHist.slice(0, 40).join('\n  ')); process.exitCode = 1; }
  else if (origem.eventos) console.log(`CONFERÊNCIA DO HISTÓRICO: os ${origem.eventos.length} eventos de todos os casos batem com a origem.`);
  await db.fechar();
}

module.exports = { analisar, importar, conferir, conferirHistorico, valoresDoCaso };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
