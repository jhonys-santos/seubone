// Foco da Semana + Agenda da Semana (Home) em Postgres. Devolve o mesmo JSON que o Apps Script
// (apps-script/agenda-semana) devolvia. "linha" é o id do evento (era o número da linha na planilha).
const db = require('../db');

const str = (v) => String(v == null ? '' : v);
const erro = (e) => ({ ok: false, erro: (e && e.message) || String(e) });

async function ler() {
  const foco = await db.query('select texto from agenda_foco where id = 1');
  const ev = await db.query(
    `select id::int as linha, btrim(dia) as dia, btrim(hora) as hora, btrim(descricao) as descricao, coalesce(nullif(btrim(tipo), ''), 'Outro') as tipo
       from agenda_eventos where btrim(dia) <> '' and btrim(descricao) <> '' order by id`,
  );
  return { ok: true, dados: { foco: foco.rows[0] ? btrimJs(foco.rows[0].texto) : '', eventos: ev.rows } };
}
const btrimJs = (s) => str(s).trim();

async function salvarFoco(texto) {
  try {
    await db.query(`insert into agenda_foco (id, texto) values (1, $1) on conflict (id) do update set texto = excluded.texto`, [str(texto)]);
    return { ok: true };
  } catch (e) { return erro(e); }
}

async function adicionarEvento(dia, hora, descricao, tipo) {
  if (!dia || !descricao) return { ok: false, erro: 'Informe pelo menos dia e descricao.' };
  try {
    await db.query('insert into agenda_eventos (dia, hora, descricao, tipo) values ($1, $2, $3, $4)', [str(dia), str(hora), str(descricao), str(tipo) || 'Outro']);
    return { ok: true };
  } catch (e) { return erro(e); }
}

async function editarEvento(linha, dia, hora, descricao, tipo) {
  const id = parseInt(linha, 10);
  if (!id || id < 1) return { ok: false, erro: 'Linha invalida.' };
  try {
    const r = await db.query('update agenda_eventos set dia = $2, hora = $3, descricao = $4, tipo = $5 where id = $1', [id, str(dia), str(hora), str(descricao), str(tipo) || 'Outro']);
    return r.rowCount ? { ok: true } : { ok: false, erro: 'Evento nao encontrado.' };
  } catch (e) { return erro(e); }
}

async function excluirEvento(linha) {
  const id = parseInt(linha, 10);
  if (!id || id < 1) return { ok: false, erro: 'Linha invalida.' };
  try {
    await db.query('delete from agenda_eventos where id = $1', [id]);
    return { ok: true };
  } catch (e) { return erro(e); }
}

module.exports = { ler, salvarFoco, adicionarEvento, editarEvento, excluirEvento };
