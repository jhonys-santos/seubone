// Webhook do finfin: "o financeiro concluiu o card" (+ anexos). Público (o finfin não é usuário do hub), protegido por segredo
// compartilhado (FINFIN_WEBHOOK_SECRET), como o webhook do n8n.
//
//   POST /webhooks/finfin/demandas
//   Authorization: Bearer <FINFIN_WEBHOOK_SECRET>      (ou: X-Webhook-Secret: <segredo>)
//   { "codigo": "DM-0042", "coluna": { "chave": "concluido" }, "anexos": [ { "nome": "nf.pdf", "tipo": "application/pdf", "conteudo_base64": "..." } ] }
const express = require('express');
const env = require('../config/env');
const retorno = require('../services/finfinRetorno.service');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    if (!env.finfinWebhookSecret) return res.status(503).json({ ok: false, erro: 'Webhook não configurado no servidor (falta FINFIN_WEBHOOK_SECRET).' });
    if (!retorno.segredoConfere(retorno.segredoDaRequisicao(req))) return res.status(401).json({ ok: false, erro: 'Segredo inválido.' });
    const r = await retorno.processarEvento(req.body);
    res.status(r.http).json(r.corpo);
  } catch (err) {
    console.error('[finfin-webhook] falha:', err.message);
    res.status(err.http || 500).json({ ok: false, erro: err.message });   // 5xx: o finfin deve tentar de novo mais tarde
  }
});

module.exports = router;
