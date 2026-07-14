const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('wallac'));

router.get('/', (req, res) => {
  res.render('wallac/index');
});

router.get('/api/cards', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar cards: ' + err.message });
  }
});

router.post('/api/status', async (req, res) => {
  try {
    const { linha_ltv, novo_status } = req.body;
    // A chamada servidor→Apps Script não precisa de no-cors (isso só existe
    // no navegador); aqui já conseguimos ler a resposta real do Google.
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: { linha_ltv, novo_status },
    });
    res.json(json && typeof json === 'object' ? json : { ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

module.exports = router;
