const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

// Avaliação de desempenho de outros colaboradores — dado sensível, só gestor
// vê e registra (mesma trava do Indicadores Equipe).
router.use(requireAuth, requireRole('gestor'));

router.get('/', (req, res) => {
  res.render('auditoria/index');
});

router.get('/api/list', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.auditoriaAppsScriptUrl);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao buscar auditorias: ' + err.message });
  }
});

router.post('/api/create', async (req, res) => {
  try {
    // "auditadoPor" vem sempre do nome de quem está logado, nunca do que o
    // navegador manda — evita que apareça um nome forjado no registro.
    const json = await chamarAppsScript(env.auditoriaAppsScriptUrl, {
      method: 'POST',
      body: { ...req.body, auditadoPor: req.session.user.nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao salvar auditoria: ' + err.message });
  }
});

module.exports = router;
