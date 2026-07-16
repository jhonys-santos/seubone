const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth);

// Sem restrição de painel — "visível pra todo mundo" no hub, por decisão
// do usuário (diferente da Gestão de Estoque do Wallac, que é só de uma
// pessoa).
router.get('/', (req, res) => {
  res.render('registro-demandas/index');
});

router.get('/reembolso', (req, res) => {
  res.render('registro-demandas/reembolso');
});

router.get('/historico', (req, res) => {
  res.render('registro-demandas/historico');
});

router.get('/historico-reembolso', (req, res) => {
  res.render('registro-demandas/historico-reembolso');
});

router.get('/api/list', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, { params: { action: 'list' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar demandas: ' + err.message });
  }
});

router.get('/api/list-reembolso', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, { params: { action: 'listReembolso' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar reembolsos: ' + err.message });
  }
});

router.post('/api/create', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
      method: 'POST',
      body: { action: 'create', ...req.body },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao registrar demanda: ' + err.message });
  }
});

router.post('/api/create-reembolso', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
      method: 'POST',
      body: { action: 'createReembolso', ...req.body },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao registrar reembolso: ' + err.message });
  }
});

router.post('/api/marcar', async (req, res) => {
  try {
    const { id, status, marcadoPor } = req.body;
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
      method: 'POST',
      body: { action: 'marcar', id, status, marcadoPor },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

router.post('/api/marcar-reembolso', async (req, res) => {
  try {
    const { id, status, marcadoPor } = req.body;
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
      method: 'POST',
      body: { action: 'marcarReembolso', id, status, marcadoPor },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

module.exports = router;
