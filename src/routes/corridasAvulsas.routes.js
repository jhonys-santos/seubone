const express = require('express');
const { requireAuth, requireSlugOuRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

// Só o Wallac (quem de fato pede as corridas) e qualquer gestor (visão de
// acompanhamento) — ver src/config/paineis.js.
router.use(requireAuth, requireSlugOuRole('wallac', 'gestor'));

router.get('/', (req, res) => res.render('corridas-avulsas/index'));

router.post('/api/cadastrar', async (req, res) => {
  try {
    const u = req.session.user;
    // registradoPor sempre vem da sessão, nunca do corpo enviado pelo
    // cliente — mesma regra usada nos outros painéis do hub.
    const payload = { ...req.body, action: 'cadastrar', registradoPorSlug: u.slug, registradoPorNome: u.nome };
    const json = await chamarAppsScript(env.corridasAvulsasAppsScriptUrl, { method: 'POST', body: payload });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao cadastrar: ' + err.message });
  }
});

router.get('/api/lista', async (req, res) => {
  try {
    const { desde, ate } = req.query;
    const json = await chamarAppsScript(env.corridasAvulsasAppsScriptUrl, { params: { action: 'lista', desde, ate } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar corridas: ' + err.message });
  }
});

module.exports = router;
