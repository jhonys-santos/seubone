// Escala do Manifesto: quem faz o Manifesto em cada data, a que horas, e as trocas entre pessoas (Postgres).
// O alerta do Manifesto lê daqui quando MANIFESTO_ESCALA=on; para datas sem linha vale o rodízio semanal da Agenda (ver eventosDoAlerta).
const db = require('../db');
const env = require('../config/env');
const usuarios = require('./usuarios.service');

const BRT = -3 * 3600000;
const HORA_PADRAO = '17:45';
const HORA_SEXTA = '16:45';
const DIAS_ALERTA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

const txt = (v) => String(v == null ? '' : v).trim();
const semAcento = (s) => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const erro = (mensagem) => ({ ok: false, erro: mensagem });
const p2 = (n) => String(n).padStart(2, '0');

/** Hoje em Brasília: { data: 'AAAA-MM-DD', dow, minutos }. */
function hojeBrasilia(agora = Date.now()) {
  const d = new Date(agora + BRT);
  return { data: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, dow: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/** 'AAAA-MM-DD' válida (existe no calendário)? */
function dataValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const diaDaSemana = (data) => new Date(data + 'T12:00:00Z').getUTCDay();
/** Horário padrão do dia: 17:45 (sexta 16:45). */
const horaPadrao = (data) => (diaDaSemana(data) === 5 ? HORA_SEXTA : HORA_PADRAO);
const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(txt(h));
const ligado = () => semAcento(env.manifestoEscala) === 'on';

const brData = (data) => data.split('-').reverse().join('/');
const pessoa = (slug) => usuarios.buscarPorSlug(slug) || null;
/** Nome curto exibido na escala e no alerta (o do cadastro do usuário). */
const nomeDe = (slug) => { const u = pessoa(slug); return u ? u.nome : ''; };

const COLUNAS = "to_char(data, 'YYYY-MM-DD') as data, slug, nome, hora";

// ── Leitura ──────────────────────────────────────────────────────────────
/** mes: 0..11 (janeiro = 0), como o resto do hub. Devolve só as datas que têm linha. */
async function doMes(ano, mes) {
  const a = Number(ano), m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 0 || m > 11) return [];
  const ini = `${a}-${p2(m + 1)}-01`;
  const r = await db.query(`select ${COLUNAS} from manifesto_escala where data >= $1::date and data < ($1::date + interval '1 month') order by data`, [ini]);
  return r.rows;
}

async function doDia(data) {
  const r = await db.query(`select ${COLUNAS} from manifesto_escala where data = $1::date`, [data]);
  return r.rows[0] || null;
}

async function proximosDe(slug, aPartirDe) {
  const r = await db.query(`select ${COLUNAS} from manifesto_escala where slug = $1 and data >= $2::date order by data limit 12`, [slug, aPartirDe]);
  return r.rows;
}

/** Datas futuras (depois de hoje) de uma pessoa, para escolher o dia da troca. */
async function datasFuturasDe(slug, agora = Date.now()) {
  const r = await db.query(`select ${COLUNAS} from manifesto_escala where slug = $1 and data > $2::date order by data limit 40`, [txt(slug), hojeBrasilia(agora).data]);
  return r.rows;
}

// ── Gestor: definir / limpar um dia, rodízio ─────────────────────────────
/**
 * slug: pessoa da escala; '' = "sem Manifesto neste dia"; null/undefined = apaga a linha (volta ao rodízio semanal da Agenda).
 * hora: HH:MM (vazio = padrão do dia).
 */
async function definirDia({ data, slug, hora }, porSlug) {
  if (!dataValida(data)) return erro('Data inválida.');
  if (slug == null) {
    await db.query('delete from manifesto_escala where data = $1::date', [data]);
    return { ok: true, removido: true };
  }
  const s = txt(slug);
  if (s && !pessoa(s)) return erro('Usuário não encontrado.');
  const h = txt(hora) || horaPadrao(data);
  if (!horaValida(h)) return erro('Horário inválido: use HH:MM (ex.: 17:45).');
  const antes = (await db.query("select slug, hora from manifesto_escala where data = $1::date", [data])).rows[0];
  await db.query(
    `insert into manifesto_escala (data, slug, nome, hora, atualizado_por, atualizado_em) values ($1::date, $2, $3, $4, $5, now())
     on conflict (data) do update set slug = excluded.slug, nome = excluded.nome, hora = excluded.hora, atualizado_por = excluded.atualizado_por, atualizado_em = now()`,
    [data, s, s ? nomeDe(s) : '', h, txt(porSlug)]);
  return { ok: true, data, slug: s, hora: h, mudouPessoa: !antes || antes.slug !== s };
}

/**
 * Preenche as datas SEM linha do mês com o rodízio semanal da Agenda ("Manifesto - Fulano" por dia da semana, de segunda a sexta).
 * eventosAgenda: [{ dia: 'Segunda', hora: '17:45', descricao: 'Manifesto - Nathalia', tipo: 'Escala' }]. Não mexe em datas que já têm linha.
 */
async function preencherRodizio({ ano, mes, eventosAgenda }, porSlug) {
  const a = Number(ano), m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 0 || m > 11) return erro('Mês inválido.');
  const porDia = {};   // 1..5 -> { slug, hora }
  const todos = usuarios.listarUsuarios();
  for (const ev of eventosAgenda || []) {
    if (semAcento(ev.tipo) !== 'escala' || !/manifesto/i.test(txt(ev.descricao))) continue;
    const idx = DIAS_ALERTA.findIndex((d) => semAcento(ev.dia).startsWith(d));
    if (idx < 1 || idx > 5) continue;
    const nome = txt(ev.descricao).replace(/manifesto/i, '').replace(/^[\s\-–—:]+/, '').trim();
    const u = todos.find((x) => semAcento(x.nome).split(/\s+/)[0] === semAcento(nome).split(/\s+/)[0]);
    if (u) porDia[idx] = { slug: u.slug, hora: horaValida(ev.hora) ? txt(ev.hora) : horaPadrao(`${a}-${p2(m + 1)}-0${idx}`) };
  }
  if (!Object.keys(porDia).length) return erro('Não achei o rodízio semanal do Manifesto na Agenda da Semana.');
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  let criados = 0;
  for (let dia = 1; dia <= ultimo; dia++) {
    const data = `${a}-${p2(m + 1)}-${p2(dia)}`;
    const e = porDia[diaDaSemana(data)];
    if (!e) continue;
    const r = await db.query(
      'insert into manifesto_escala (data, slug, nome, hora, atualizado_por) values ($1::date, $2, $3, $4, $5) on conflict (data) do nothing',
      [data, e.slug, nomeDe(e.slug), e.hora, txt(porSlug)]);
    criados += r.rowCount;
  }
  return { ok: true, criados };
}

// ── Trocas ───────────────────────────────────────────────────────────────
const COLUNAS_TROCA = "id::int as id, solicitante, solicitante_nome as \"solicitanteNome\", to_char(data_sol, 'YYYY-MM-DD') as \"dataSol\", alvo, alvo_nome as \"alvoNome\", to_char(data_alvo, 'YYYY-MM-DD') as \"dataAlvo\", status, motivo, criada_em as \"criadaEm\"";

async function trocasDe(slug) {
  const r = await db.query(`select ${COLUNAS_TROCA} from manifesto_trocas where status = 'pendente' and (alvo = $1 or solicitante = $1) order by id`, [txt(slug)]);
  return { recebidas: r.rows.filter((t) => t.alvo === slug), enviadas: r.rows.filter((t) => t.solicitante === slug) };
}

/** Quem pede (slug da sessão) cede dataSol e quer dataAlvo, que é do colega `alvo`. */
async function solicitarTroca({ solicitante, dataSol, alvo, dataAlvo, motivo }, agora = Date.now()) {
  const sol = txt(solicitante), al = txt(alvo);
  if (!dataValida(dataSol) || !dataValida(dataAlvo)) return erro('Escolha os dois dias da troca.');
  if (!al || al === sol) return erro('Escolha um colega para a troca.');
  const hoje = hojeBrasilia(agora).data;
  if (dataSol <= hoje || dataAlvo <= hoje) return erro('Só dá para trocar dias que ainda não chegaram (a partir de amanhã).');
  return db.transaction(async (tx) => {
    const mine = (await tx.query('select slug from manifesto_escala where data = $1::date for update', [dataSol])).rows[0];
    const his = (await tx.query('select slug from manifesto_escala where data = $1::date for update', [dataAlvo])).rows[0];
    if (!mine || mine.slug !== sol) return erro('Você não está escalado(a) no dia que quer trocar.');
    if (!his || his.slug !== al) return erro('O colega não está mais escalado nesse dia. Atualize a tela.');
    const ja = await tx.query(
      `select 1 from manifesto_trocas where status = 'pendente' and (data_sol in ($1::date, $2::date) or data_alvo in ($1::date, $2::date)) limit 1`, [dataSol, dataAlvo]);
    if (ja.rowCount) return erro('Já existe um pedido de troca pendente envolvendo um desses dias.');
    const r = await tx.query(
      `insert into manifesto_trocas (solicitante, solicitante_nome, data_sol, alvo, alvo_nome, data_alvo, motivo) values ($1,$2,$3::date,$4,$5,$6::date,$7) returning id::int as id`,
      [sol, nomeDe(sol), dataSol, al, nomeDe(al), dataAlvo, txt(motivo).slice(0, 300)]);
    return { ok: true, id: r.rows[0].id, alvo: al, alvoNome: nomeDe(al), solicitanteNome: nomeDe(sol) };
  });
}

/** O colega responde. Aceitar troca as duas pessoas de lugar (cada data mantém o seu horário). */
async function responderTroca({ id, slug, aceitar }, agora = Date.now()) {
  return db.transaction(async (tx) => {
    const t = (await tx.query(`select ${COLUNAS_TROCA} from manifesto_trocas where id = $1 for update`, [Number(id)])).rows[0];
    if (!t) return erro('Pedido de troca não encontrado.');
    if (t.alvo !== txt(slug)) return erro('Só quem recebeu o pedido pode responder.');
    if (t.status !== 'pendente') return erro('Este pedido já foi respondido.');
    if (!aceitar) {
      await tx.query("update manifesto_trocas set status = 'recusada', respondida_em = now() where id = $1", [t.id]);
      return { ok: true, status: 'recusada', troca: t };
    }
    const hoje = hojeBrasilia(agora).data;
    const a = (await tx.query('select slug from manifesto_escala where data = $1::date for update', [t.dataSol])).rows[0];
    const b = (await tx.query('select slug from manifesto_escala where data = $1::date for update', [t.dataAlvo])).rows[0];
    if (t.dataSol <= hoje || t.dataAlvo <= hoje || !a || a.slug !== t.solicitante || !b || b.slug !== t.alvo) {
      await tx.query("update manifesto_trocas set status = 'cancelada', respondida_em = now() where id = $1", [t.id]);
      return { ok: false, erro: 'A escala mudou desde o pedido (ou um dos dias já chegou). O pedido foi cancelado.' };
    }
    const por = `troca ${t.solicitanteNome} e ${t.alvoNome}`;
    await tx.query('update manifesto_escala set slug = $2, nome = $3, atualizado_por = $4, atualizado_em = now() where data = $1::date', [t.dataSol, t.alvo, nomeDe(t.alvo), por]);
    await tx.query('update manifesto_escala set slug = $2, nome = $3, atualizado_por = $4, atualizado_em = now() where data = $1::date', [t.dataAlvo, t.solicitante, nomeDe(t.solicitante), por]);
    await tx.query("update manifesto_trocas set status = 'aceita', respondida_em = now() where id = $1", [t.id]);
    return { ok: true, status: 'aceita', troca: t };
  });
}

async function cancelarTroca({ id, slug }) {
  const r = await db.query("update manifesto_trocas set status = 'cancelada', respondida_em = now() where id = $1 and solicitante = $2 and status = 'pendente' returning id", [Number(id), txt(slug)]);
  return r.rowCount ? { ok: true } : erro('Pedido não encontrado (ou já respondido).');
}

// ── Alerta ───────────────────────────────────────────────────────────────
/**
 * Eventos de HOJE no formato que o alerta já entende ({ dia, hora, descricao: 'Manifesto - Nome', tipo: 'Escala' }).
 * Com MANIFESTO_ESCALA=on: a linha de hoje da escala (linha sem pessoa = sem Manifesto hoje); sem linha, o rodízio semanal da Agenda.
 * Desligado: sempre a Agenda, como era antes.  eventosAgenda: os eventos da Agenda da Semana (já lidos pela rota).
 */
async function eventosDoAlerta(eventosAgenda, agora = Date.now()) {
  const hoje = hojeBrasilia(agora);
  const dia = DIAS_ALERTA[hoje.dow];
  if (ligado()) {
    const l = (await db.query(`select ${COLUNAS} from manifesto_escala where data = $1::date`, [hoje.data])).rows[0];
    if (l) {
      if (!l.slug) return { fonte: 'escala', eventos: [] };
      return { fonte: 'escala', eventos: [{ dia, hora: l.hora, descricao: `Manifesto - ${l.nome || nomeDe(l.slug)}`, tipo: 'Escala', data: hoje.data }] };
    }
  }
  const daAgenda = (eventosAgenda || []).filter((ev) => semAcento(ev.tipo) === 'escala' && /manifesto/i.test(txt(ev.descricao)) && semAcento(ev.dia).startsWith(dia));
  return { fonte: 'agenda', eventos: daAgenda };
}

// ── Agenda da Semana ─────────────────────────────────────────────────────
const DIAS_AGENDA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

/**
 * Com MANIFESTO_ESCALA=on, o Manifesto da Agenda da Semana (Home) passa a vir da escala: para cada dia útil da semana (sábado e domingo mostram a semana
 * que vem) que tenha linha na escala, o evento fixo "Manifesto - Fulano" sai e entra o da escala (pessoa/horário já com as trocas; "sem Manifesto"
 * não mostra nada). Dia sem linha mantém o evento fixo. Os demais eventos não mudam. Eventos vindos da escala não têm "linha" (somenteLeitura).
 */
async function mesclarNaAgenda(eventos, agora = Date.now()) {
  const lista = Array.isArray(eventos) ? eventos : [];
  if (!ligado()) return lista;
  const hoje = hojeBrasilia(agora);
  const base = new Date(hoje.data + 'T12:00:00Z');
  const recuo = hoje.dow === 0 ? -1 : hoje.dow === 6 ? -2 : (hoje.dow - 1);   // domingo/sábado: segunda da semana que vem
  base.setUTCDate(base.getUTCDate() - recuo);
  const datas = DIAS_AGENDA.map((_, i) => { const d = new Date(base.getTime()); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const r = await db.query(`select ${COLUNAS} from manifesto_escala where data = any($1::date[])`, [datas]);
  const linhas = new Map(r.rows.map((l) => [l.data, l]));
  const ehManifesto = (ev) => semAcento(ev.tipo) === 'escala' && /manifesto/i.test(txt(ev.descricao));
  const diasComLinha = new Set(DIAS_AGENDA.filter((_, i) => linhas.has(datas[i])).map(semAcento));
  const resultado = lista.filter((ev) => !(ehManifesto(ev) && diasComLinha.has(semAcento(ev.dia))));
  DIAS_AGENDA.forEach((dia, i) => {
    const l = linhas.get(datas[i]);
    if (l && l.slug) resultado.push({ linha: null, dia, hora: l.hora, descricao: `Manifesto - ${l.nome || nomeDe(l.slug)}`, tipo: 'Escala', somenteLeitura: true });
  });
  return resultado;
}

module.exports = {
  mesclarNaAgenda,
  doMes, doDia, proximosDe, datasFuturasDe, definirDia, preencherRodizio, trocasDe, solicitarTroca, responderTroca, cancelarTroca, eventosDoAlerta,
  hojeBrasilia, dataValida, horaPadrao, horaValida, ligado, brData, nomeDe,
};
