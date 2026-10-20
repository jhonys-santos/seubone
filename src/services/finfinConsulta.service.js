// Consulta automática ao finfin: de poucos em poucos minutos o hub pergunta pelo código (DM-…) como estão os cards abertos, atualiza a
// coluna no painel e, quando o financeiro conclui, avisa o solicitante. É a rede de segurança do webhook: funciona mesmo que o finfin não
// chame o hub. NÃO traz os anexos do financeiro (o GET do finfin só devolve nome/tamanho/tipo): esses chegam só pelo webhook.
const db = require('../db');
const env = require('../config/env');
const finfin = require('./finfinDemandas.service');
const retorno = require('./finfinRetorno.service');
const formularios = require('./finfinFormularios');

const INTERVALO_MS = 3 * 60 * 1000;
const LIMITE_POR_RODADA = 40;   // o finfin aceita 60 consultas por minuto

const ativa = () => env.finfinConsulta !== 'off' && finfin.configurado();

/** Consulta um card e aplica o que mudou. Devolve { ok, coluna, mudou } (ou { ok:false, erro, status }). */
async function sincronizarCard(codigo) {
  const r = await finfin.consultarCard(codigo);
  if (!r.ok) return { ok: false, erro: r.erro, status: r.status };
  const col = r.card && r.card.coluna;
  const chave = col && col.chave;
  if (!chave) return { ok: true, coluna: null, mudou: false };
  const antes = (await db.query('select coluna, notificado_coluna, formulario from finfin_demandas where codigo = $1', [codigo])).rows[0];
  if (!antes) return { ok: true, coluna: col, mudou: false };
  const campos = (r.card && r.card.campos) || {};
  if (campos.descricao || campos.telefone) {
    await db.query("update finfin_demandas set descricao = case when descricao = '' then $2 else descricao end, telefone = case when telefone = '' then $3 else telefone end where codigo = $1", [codigo, String(campos.descricao || ''), String(campos.telefone || '')]);
  }
  // "Concluído": passa pelo mesmo caminho do webhook (marca, guarda quem concluiu e avisa uma vez), só que sem anexos.
  const p = await retorno.processarEvento({ codigo, coluna: { chave, nome: col.nome } }, { origem: 'consulta' });
  const regra = formularios.regraDaColuna(antes.formulario, chave);
  const mudou = antes.coluna !== chave || (!!regra && antes.notificado_coluna !== (regra.canonica || chave));
  return { ok: p.http === 200, coluna: col, mudou };
}

/** Cards abertos (ou encerrados cujo desfecho ainda não foi avisado) criados nos últimos 60 dias. */
async function sincronizarAbertos({ limite = LIMITE_POR_RODADA } = {}) {
  const lista = await db.query(
    `select codigo from finfin_demandas
      where codigo <> '' and criado_em > now() - interval '60 days'
        and ((concluido_em is null and coluna <> 'cancelado') or (concluido_em is not null and notificado_coluna is distinct from coluna))
      order by ordem desc limit $1`, [limite]);
  let verificados = 0, mudaram = 0; const falhas = [];
  for (const { codigo } of lista.rows) {
    try {
      const r = await sincronizarCard(codigo);
      if (!r.ok) { falhas.push(codigo); if (r.status === 429) break; continue; }
      verificados++; if (r.mudou) mudaram++;
    } catch (e) { falhas.push(codigo); }
  }
  return { verificados, mudaram, falhas };
}

let relogio = null;
function iniciarConsultaFinfin() {
  if (!ativa()) { console.log('[finfin] consulta automática desligada (sem token ou FINFIN_DEMANDAS_CONSULTA=off)'); return; }
  const rodar = async () => {
    try {
      const r = await sincronizarAbertos();
      if (r.mudaram || r.falhas.length) console.log(`[finfin] consulta: ${r.verificados} verificados, ${r.mudaram} mudaram, ${r.falhas.length} falha(s)`);
    } catch (e) { console.error('[finfin] consulta automática:', e.message); }
  };
  setTimeout(rodar, 30000);
  relogio = setInterval(rodar, INTERVALO_MS);
  console.log('[finfin] consulta automática ligada: a cada 3 min');
}

module.exports = { sincronizarCard, sincronizarAbertos, iniciarConsultaFinfin, INTERVALO_MS };
