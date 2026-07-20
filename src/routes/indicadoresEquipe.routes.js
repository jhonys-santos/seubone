const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

// Visão de gestor sobre a equipe — nada aqui filtra por slug da sessão,
// então trava por papel (não por painel liberado por usuário) igual à
// Gestão de Estoque trava por slug.
router.use(requireAuth, requireRole('gestor'));

router.get('/atendimento', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'atendimento' });
});

router.get('/resolucao', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'resolucao' });
});

router.get('/api/dados', async (req, res) => {
  try {
    const { time, desde, ate } = req.query;
    const json = await chamarAppsScript(env.indicadoresEquipeAppsScriptUrl, {
      params: { action: 'dados', time, desde, ate },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar indicadores: ' + err.message });
  }
});

module.exports = router;
