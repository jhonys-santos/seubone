// Auditoria de Qualidade em Postgres. Devolve o mesmo JSON que o Apps Script
// (apps-script/auditoria) devolvia: uma lista de objetos com os nomes de coluna da planilha.
const db = require('../db');

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const CRITERIOS = ['c11', 'c12', 'c13', 'c14', 'c21', 'c22', 'c23', 'c24', 'c31', 'c32', 'c33', 'c34'];

const num = (v) => { const n = Number(v); return Number.isNaN(n) ? 0 : n; };

function classificar(total, critica) {
  if (critica) return 'CRITICO';
  if (total >= 90) return 'EXCELENTE';
  if (total >= 75) return 'BOM';
  if (total >= 60) return 'REGULAR';
  return 'CRITICO';
}

function calcular(b) {
  const soma = (...k) => k.reduce((s, c) => s + num(b[c]), 0);
  const s1 = soma('c11', 'c12', 'c13', 'c14');
  const s2 = soma('c21', 'c22', 'c23', 'c24');
  const s3 = soma('c31', 'c32', 'c33', 'c34');
  const critica = !!(b.fg1 || b.fg2 || b.fg3 || b.fg4);
  const total = critica ? 0 : s1 + s2 + s3;
  return { section1: s1, section2: s2, section3: s3, total, criticalFailure: critica, classification: classificar(total, critica) };
}

/**
 * Rótulo da semana ("31/07 a 06/08"), de sexta a quinta. Mantém EXATAMENTE a regra da planilha, que
 * lia a data como meia-noite UTC e a convertia para o fuso do script (atrás de UTC): o dia usado é o
 * ANTERIOR ao informado. Ex: sexta 07/08 cai na semana "31/07 a 06/08". Mudar isso embaralharia as semanas já gravadas.
 */
function semanaRotulo(dataStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataStr || ''));
  if (!m) return '';
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  const dia = utc.getUTCDay(); // 0 = domingo, 5 = sexta
  const sexta = new Date(utc);
  sexta.setUTCDate(utc.getUTCDate() - ((dia - 5 + 7) % 7));
  const quinta = new Date(sexta);
  quinta.setUTCDate(sexta.getUTCDate() + 6);
  const f = (x) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${f(sexta)} a ${f(quinta)}`;
}

const SQL_LISTA = `select
  to_char(registrado_em at time zone 'UTC', ${ISO_UTC}) as "Timestamp",
  to_char(data, 'YYYY-MM-DD') || 'T07:00:00.000Z' as "Data",
  semana as "Semana", auditado_por as "AuditadoPor", agente as "Agente", tipo_ocorrencia as "TipoOcorrencia", canal as "Canal",
  conversation_id as "ConversationId",
  c11::float8, c12::float8, c13::float8, c14::float8, c21::float8, c22::float8, c23::float8, c24::float8, c31::float8, c32::float8, c33::float8, c34::float8,
  s1::float8 as "S1", s2::float8 as "S2", s3::float8 as "S3", total::float8 as "Total", classificacao as "Classificacao",
  case when fg1 then 'Sim' else 'Nao' end as "FG1", case when fg2 then 'Sim' else 'Nao' end as "FG2",
  case when fg3 then 'Sim' else 'Nao' end as "FG3", case when fg4 then 'Sim' else 'Nao' end as "FG4",
  case when falha_grave then 'Sim' else 'Nao' end as "FalhaGrave", observacoes as "Observacoes"
  from auditorias order by ordem`;

/** A planilha guardava o id da conversa como número quando só tem dígitos. */
const idConversa = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : v);

async function listar() {
  const r = await db.query(SQL_LISTA);
  return { ok: true, data: r.rows.map((x) => ({ ...x, ConversationId: idConversa(x.ConversationId) })) };
}

async function criar(b) {
  try {
    if (!b.data || !b.agente || !b.tipoOcorrencia || !b.canal || !b.conversationId) return { ok: false, error: 'Campos obrigatórios faltando.' };
    const dia = /^(\d{4}-\d{2}-\d{2})/.exec(String(b.data));
    if (!dia) return { ok: false, error: 'Data inválida.' };
    const r = calcular(b);
    const c = CRITERIOS.map((k) => num(b[k]));
    await db.query(
      `insert into auditorias (data, semana, auditado_por, agente, tipo_ocorrencia, canal, conversation_id,
         c11, c12, c13, c14, c21, c22, c23, c24, c31, c32, c33, c34, s1, s2, s3, total, classificacao,
         fg1, fg2, fg3, fg4, falha_grave, observacoes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
         $25, $26, $27, $28, $29, $30)`,
      [dia[1], semanaRotulo(dia[1]), String(b.auditadoPor || ''), String(b.agente), String(b.tipoOcorrencia), String(b.canal), String(b.conversationId).trim(),
        ...c, r.section1, r.section2, r.section3, r.total, r.classification,
        !!b.fg1, !!b.fg2, !!b.fg3, !!b.fg4, r.criticalFailure, String(b.observacoes || '')],
    );
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { listar, criar, calcular, semanaRotulo, CRITERIOS };
