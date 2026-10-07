// Pedidos Urgentes em Postgres. Devolve o mesmo JSON que o Apps Script (apps-script/pedidos-urgentes) devolvia:
// listar = ARRAY de objetos com as colunas da planilha; criar/despachar = { ok, ... }. Os arquivos (manifesto,
// nota fiscal, foto da OS) continuam no Google Drive: o upload é feito pelo Apps Script (ação salvarArquivos).
const crypto = require('crypto');
const db = require('../db');

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const str = (v) => String(v == null ? '' : v);
const iso = (col) => `coalesce(to_char(${col} at time zone 'UTC', ${ISO_UTC}), '')`;

const COLUNAS = `id as "ID", os as "OS", cliente as "Cliente", link_crm as "LinkCRM", transportadora as "Transportadora", modalidade as "Modalidade",
  tipo_envio_aereo as "TipoEnvioAereo", aeroporto_retirada as "AeroportoRetirada", os_imagem_id as "OSImagemId", manifesto_link as "ManifestoLink",
  nota_fiscal_link as "NotaFiscalLink", observacao as "Observacao", ${iso('prazo')} as "Prazo", status as "Status", inserido_por as "InseridoPor",
  ${iso('inserido_em')} as "InseridoEm", despachado_por as "DespachadoPor", ${iso('despachado_em')} as "DespachadoEm"`;

const diaValido = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v).trim()) ? str(v).trim() : null);

/** status: "Pendente" | "Despachado" | vazio (todos). desde/ate: "AAAA-MM-DD", dia inteiro em Brasília, sobre a data de inclusão. */
async function listar(status, desde, ate) {
  const params = [];
  const filtros = [];
  if (status) { params.push(str(status)); filtros.push(`status = $${params.length}`); }
  const d = diaValido(desde); if (d) { params.push(`${d}T00:00:00-03:00`); filtros.push(`inserido_em >= $${params.length}::timestamptz`); }
  const a = diaValido(ate); if (a) { params.push(`${a}T23:59:59-03:00`); filtros.push(`inserido_em <= $${params.length}::timestamptz`); }
  const r = await db.query(`select ${COLUNAS} from pedidos_urgentes ${filtros.length ? 'where ' + filtros.join(' and ') : ''} order by ordem`, params);
  return r.rows;
}

// ── Upload de arquivos (continua no Google Drive, via Apps Script) ──
let uploader = async (dados) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const env = require('../config/env');
  const r = await chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, { method: 'POST', body: { action: 'salvarArquivos', ...dados } });
  if (!r || typeof r !== 'object' || r.erro || r.ok === false) throw new Error((r && (r.erro || r.error)) || 'Falha ao salvar os arquivos no Drive');
  return r;
};
/** Só para testes. */
function definirUploader(fn) { uploader = fn; }

function instante(v) {
  const s = str(v).trim();
  if (!s) return null;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

async function criar(body) {
  const b = body || {};
  let links = { manifestoLink: '', notaFiscalLink: '', osImagemId: '' };
  const temArquivo = (b.manifestoBase64 && b.manifestoNome) || (b.notaFiscalBase64 && b.notaFiscalNome) || (b.osImagemBase64 && b.osImagemNome);
  try {
    // Arquivos primeiro: se o Drive falhar, nada é gravado (sem pedido "pela metade").
    if (temArquivo) {
      const r = await uploader({
        manifestoBase64: b.manifestoBase64, manifestoNome: b.manifestoNome,
        notaFiscalBase64: b.notaFiscalBase64, notaFiscalNome: b.notaFiscalNome,
        osImagemBase64: b.osImagemBase64, osImagemNome: b.osImagemNome, osImagemTipo: b.osImagemTipo,
      });
      links = { manifestoLink: str(r.manifestoLink), notaFiscalLink: str(r.notaFiscalLink), osImagemId: str(r.osImagemId) };
    }
    const id = crypto.randomUUID();
    await db.query(
      `insert into pedidos_urgentes (id, os, cliente, link_crm, transportadora, modalidade, tipo_envio_aereo, aeroporto_retirada, os_imagem_id,
         manifesto_link, nota_fiscal_link, observacao, prazo, status, inserido_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,'Pendente',$14)`,
      [id, str(b.os), str(b.cliente), str(b.linkCrm), str(b.transportadora), str(b.modalidade), str(b.tipoEnvioAereo), str(b.aeroporto), links.osImagemId,
        links.manifestoLink, links.notaFiscalLink, str(b.observacao), instante(b.prazo), str(b.inseridoPor)],
    );
    return { ok: true, id, manifestoLink: links.manifestoLink, notaFiscalLink: links.notaFiscalLink, osImagemId: links.osImagemId };
  } catch (e) {
    return { ok: false, erro: (e && e.message) || String(e) };
  }
}

async function despachar(body) {
  const b = body || {};
  try {
    const r = await db.query(
      `update pedidos_urgentes set status = 'Despachado', despachado_por = $2, despachado_em = now() where id = $1`,
      [str(b.id), str(b.despachadoPor)],
    );
    return r.rowCount ? { ok: true } : { ok: false, erro: 'pedido não encontrado' };
  } catch (e) {
    return { ok: false, erro: (e && e.message) || String(e) };
  }
}

module.exports = { listar, criar, despachar, definirUploader };
