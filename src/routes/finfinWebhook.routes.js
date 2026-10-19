// Webhook do finfin: "o financeiro concluiu o card" (+ anexos). Público (o finfin não é usuário do hub), protegido por segredo
// compartilhado (FINFIN_WEBHOOK_SECRET), como o webhook do n8n.
//
//   POST /webhooks/finfin/demandas
//   Authorization: Bearer <FINFIN_WEBHOOK_SECRET>      (ou: X-Webhook-Secret: <segredo>)
//   { "codigo": "DM-0042", "coluna": { "chave": "concluido" }, "anexos": [ { "nome": "nf.pdf", "tipo": "application/pdf", "conteudo_base64": "..." } ] }
//
// Toda chamada (inclusive as recusadas) fica registrada em finfin_webhook_log: é assim que se sabe que o retorno chegou.
const express = require('express');
const env = require('../config/env');
const db = require('../db');
const retorno = require('../services/finfinRetorno.service');

const router = express.Router();

async function registrar(req, inicio, http, corpoResposta, { erro = '' } = {}) {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const ev = retorno.normalizarEvento(b);
    const r = corpoResposta || {};
    const resultado = erro || http >= 500 ? 'erro' : http >= 400 ? 'recusado' : r.ignorado ? 'ignorado' : r.concluido ? 'concluido' : 'atualizado';
    await db.query(
      `insert into finfin_webhook_log (http, codigo, coluna, resultado, anexos_recebidos, anexos_novos, notificado, erro, ip, duracao_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [http, ev.codigo.slice(0, 40), ev.chave.slice(0, 40), resultado, Array.isArray(ev.anexos) ? ev.anexos.length : 0, Number(r.anexosNovos) || 0, !!r.notificado,
        String(erro || r.erro || '').slice(0, 300), String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60), Date.now() - inicio],
    );
    if (Math.random() < 0.02) await db.query("delete from finfin_webhook_log where recebido_em < now() - interval '90 days'");   // guarda 90 dias
  } catch (e) { console.error('[finfin-webhook] não consegui registrar a chamada:', e.message); }
}

router.post('/', async (req, res) => {
  const inicio = Date.now();
  const responder = async (http, corpo, opcoes) => { await registrar(req, inicio, http, corpo, opcoes); return res.status(http).json(corpo); };
  try {
    if (!env.finfinWebhookSecret) return responder(503, { ok: false, erro: 'Webhook não configurado no servidor (falta FINFIN_WEBHOOK_SECRET).' });
    if (!retorno.segredoConfere(retorno.segredoDaRequisicao(req))) return responder(401, { ok: false, erro: 'Segredo inválido.' });
    const r = await retorno.processarEvento(req.body);
    return responder(r.http, r.corpo);
  } catch (err) {
    console.error('[finfin-webhook] falha:', err.message);
    return responder(err.http || 500, { ok: false, erro: err.message }, { erro: err.message });   // 5xx: o finfin deve tentar de novo mais tarde
  }
});

module.exports = router;
