// Escala de serviço e Trocas de sábado (Painel SAC) em Postgres. Devolve o mesmo JSON que o Apps Script
// (apps-script/painel-sac) devolvia nas ações escala, escalaEquipe, sabadosConsultor, atualizarEscala,
// atualizarEscalaLote, solicitarTroca e responderTroca. "mes" é 0..11 (janeiro = 0), como o painel sempre usou.
const db = require('../db');

const STATUS_VALIDOS = ['T', 'F', 'FN', 'FM', 'TR', 'FE'];
const MESES_ROTULO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_POR_LINHA = 31;
const BRT = -3 * 3600000;

const inteiro = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? NaN : n; };
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const erro = (e) => ({ ok: false, erro: (e && e.message) || String(e) });

/** Hoje no fuso de Brasília (fixo UTC-3): { ano, mes (0..11), dia, dow (0=domingo), zero } onde zero é a meia-noite como Date.UTC. */
function hojeBrasilia(agora = Date.now()) {
  const d = new Date(agora + BRT);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), dow: d.getUTCDay(), zero: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) };
}
/** Dia da semana (0..6) de uma data do calendário, ou null se a data não existe (ex.: 31/04). */
function diaDaSemana(ano, mes, dia) {
  if (![ano, mes, dia].every(Number.isInteger)) return null;
  const d = new Date(Date.UTC(ano, mes, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes && d.getUTCDate() === dia ? d.getUTCDay() : null;
}

// ── Leitura ──────────────────────────────────────────────────────────────────
function diasParaLista(dias) {
  const lista = [];
  for (let i = 0; i < DIAS_POR_LINHA; i++) lista.push({ dia: i + 1, status: String(dias[i] || 'F').trim().toUpperCase() });
  return lista;
}

async function buscarEscala(slug, mes, ano, q = db) {
  if (!Number.isInteger(mes) || !Number.isInteger(ano)) return [];
  const r = await q.query('select dias from sac_escala where slug = $1 and ano = $2 and mes = $3', [slug, ano, mes]);
  return r.rows[0] ? diasParaLista(r.rows[0].dias) : [];
}

async function trocasPendentes(usuario) {
  const r = await db.query(
    `select id, solicitante, dia_sol, mes_sol, ano_sol, dia_alvo, mes_alvo, ano_alvo from sac_trocas
      where lower(btrim(alvo)) = $1 and btrim(status) = 'pendente' order by ordem`,
    [norm(usuario)],
  );
  return r.rows.map((t) => ({ id: String(t.id), solicitante: String(t.solicitante), dia_sol: t.dia_sol, mes_sol: t.mes_sol, ano_sol: t.ano_sol, dia_alvo: t.dia_alvo, mes_alvo: t.mes_alvo, ano_alvo: t.ano_alvo }));
}

/** Só os sábados que ainda não passaram (para escolher o que trocar). Dias que não existem no mês (ex.: 31/04) ficam de fora. */
async function listarSabados(slug, mes, ano, agora = Date.now()) {
  const hoje = hojeBrasilia(agora);
  return (await buscarEscala(slug, mes, ano)).filter((d) => diaDaSemana(ano, mes, d.dia) === 6 && Date.UTC(ano, mes, d.dia) >= hoje.zero);
}

/** Resposta da ação "escala" (escala própria + trocas que esperam resposta + sábados). */
async function escalaDaPessoa(slug, mes, ano, agora = Date.now()) {
  return {
    escala: await buscarEscala(slug, mes, ano),
    trocas_pendentes: await trocasPendentes(slug),
    sabados: await listarSabados(slug, mes, ano, agora),
  };
}

async function sabadosConsultor(alvo, mes, ano, agora = Date.now()) {
  return { sabados: await listarSabados(alvo, mes, ano, agora) };
}

/** Resposta da ação "escalaEquipe" (Home do gestor): todo mundo que tem escala, na mesma ordem de sempre. */
async function escalaEquipe(mes, ano) {
  const pessoas = (await db.query('select slug, nome from sac_escala_pessoas order by ordem, slug')).rows;
  const saida = [];
  for (const p of pessoas) saida.push({ slug: p.slug, nome: p.nome || p.slug, escala: await buscarEscala(p.slug, mes, ano) });
  return { pessoas: saida };
}

// ── Escrita da escala ────────────────────────────────────────────────────────
async function gravarDia(tx, slug, dia, mes, ano, status) {
  if (!Number.isInteger(dia) || dia < 1 || dia > DIAS_POR_LINHA || !Number.isInteger(mes) || mes < 0 || mes > 11 || !Number.isInteger(ano)) return false;
  const pessoa = await tx.query('select 1 from sac_escala_pessoas where slug = $1', [slug]);
  if (!pessoa.rowCount) return false;
  // Mês ainda sem linha: cria com todo mundo de folga ("F"), como a planilha fazia; o gestor ajusta depois.
  await tx.query(
    `insert into sac_escala (slug, ano, mes, rotulo, dias) values ($1, $2, $3, $4, array_fill('F'::text, array[${DIAS_POR_LINHA}]))
     on conflict (slug, ano, mes) do nothing`,
    [slug, ano, mes, `${MESES_ROTULO[mes]}/${ano}`],
  );
  await tx.query('update sac_escala set dias[$4] = $5, atualizado_em = now() where slug = $1 and ano = $2 and mes = $3', [slug, ano, mes, dia, status]);
  return true;
}

const statusDe = (v) => String(v || '').toUpperCase();

async function atualizarEscala({ slug, dia, mes, ano, status }) {
  const st = statusDe(status);
  if (!STATUS_VALIDOS.includes(st)) return { ok: false, erro: 'Status invalido.' };
  try {
    const salvou = await db.transaction((tx) => gravarDia(tx, String(slug), inteiro(dia), inteiro(mes), inteiro(ano), st));
    if (!salvou) return { ok: false, erro: 'Nao foi possivel localizar esse dia na planilha (mes ainda nao cadastrado?).' };
    return { ok: true };
  } catch (e) { return erro(e); }
}

async function atualizarEscalaLote({ slugs, dias, status }) {
  const st = statusDe(status);
  if (!STATUS_VALIDOS.includes(st)) return { ok: false, erro: 'Status invalido.' };
  const listaSlugs = Array.isArray(slugs) ? slugs : [];
  const listaDias = Array.isArray(dias) ? dias : [];
  try {
    return await db.transaction(async (tx) => {
      let gravados = 0, falhas = 0;
      for (const slug of listaSlugs) for (const d of listaDias) {
        if (await gravarDia(tx, String(slug), inteiro(d && d.dia), inteiro(d && d.mes), inteiro(d && d.ano), st)) gravados++; else falhas++;
      }
      return { ok: true, gravados, falhas };
    });
  } catch (e) { return erro(e); }
}

// ── Trocas ───────────────────────────────────────────────────────────────────
function dataHoraBr(agora) {
  const d = new Date(agora + BRT);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function solicitarTroca(solicitante, b, agora = Date.now()) {
  const sol = String(solicitante);
  const diaSol = inteiro(b.dia_solicitante), mesSol = inteiro(b.mes_solicitante), anoSol = inteiro(b.ano_solicitante);
  const alvo = String(b.consultor_alvo == null ? '' : b.consultor_alvo);
  const diaAlvo = inteiro(b.dia_alvo), mesAlvo = inteiro(b.mes_alvo), anoAlvo = inteiro(b.ano_alvo);

  if (diaDaSemana(anoSol, mesSol, diaSol) !== 6 || diaDaSemana(anoAlvo, mesAlvo, diaAlvo) !== 6) return { ok: false, erro: 'So e permitido trocar sabados.' };
  const hoje = hojeBrasilia(agora);
  if (Date.UTC(anoSol, mesSol, diaSol) < hoje.zero || Date.UTC(anoAlvo, mesAlvo, diaAlvo) < hoje.zero) return { ok: false, erro: 'Nao e possivel trocar um sabado que ja passou.' };
  if (hoje.dow === 5) return { ok: false, erro: 'Nao e possivel solicitar trocas na sexta-feira.' };

  try {
    return await db.transaction(async (tx) => {
      const ja = await tx.query(
        `select 1 from sac_trocas where status = 'pendente' and (
           (solicitante = $1 and dia_sol = $2 and mes_sol = $3 and ano_sol = $4) or
           (alvo = $1 and dia_alvo = $2 and mes_alvo = $3 and ano_alvo = $4)) limit 1`,
        [sol, diaSol, mesSol, anoSol],
      );
      if (ja.rowCount) return { ok: false, erro: 'Ja existe uma solicitacao pendente para este sabado.' };
      const id = 'TR' + agora;
      await tx.query(
        `insert into sac_trocas (id, solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, status, criada_em, criada_em_original)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente',$10,$11)`,
        [id, sol, diaSol, mesSol, anoSol, alvo, diaAlvo, mesAlvo, anoAlvo, new Date(agora).toISOString(), dataHoraBr(agora)],
      );
      return { ok: true, id };
    });
  } catch (e) { return erro(e); }
}

async function responderTroca(usuario, idTroca, aceitar, agora = Date.now()) {
  try {
    return await db.transaction(async (tx) => {
      const r = await tx.query('select * from sac_trocas where id = $1 for update', [String(idTroca == null ? '' : idTroca)]);
      const t = r.rows[0];
      if (!t) return { ok: false, erro: 'Troca nao encontrada.' };
      if (norm(t.alvo) !== norm(usuario)) return { ok: false, erro: 'Nao autorizado.' };
      if (String(t.status).trim() !== 'pendente') return { ok: false, erro: 'Esta troca ja foi respondida.' };
      await tx.query('update sac_trocas set status = $2, respondida_em = $3 where id = $1', [t.id, aceitar ? 'aceita' : 'recusada', new Date(agora).toISOString()]);
      if (aceitar) {
        // Quem pediu fica de folga no sábado dele e trabalha (TR) no do colega; o colega faz o inverso.
        await gravarDia(tx, t.solicitante, t.dia_sol, t.mes_sol, t.ano_sol, 'F');
        await gravarDia(tx, t.solicitante, t.dia_alvo, t.mes_alvo, t.ano_alvo, 'TR');
        await gravarDia(tx, t.alvo, t.dia_alvo, t.mes_alvo, t.ano_alvo, 'F');
        await gravarDia(tx, t.alvo, t.dia_sol, t.mes_sol, t.ano_sol, 'TR');
      }
      return { ok: true };
    });
  } catch (e) { return erro(e); }
}

module.exports = {
  buscarEscala, trocasPendentes, listarSabados, escalaDaPessoa, sabadosConsultor, escalaEquipe,
  atualizarEscala, atualizarEscalaLote, solicitarTroca, responderTroca, hojeBrasilia, diaDaSemana, STATUS_VALIDOS,
};
