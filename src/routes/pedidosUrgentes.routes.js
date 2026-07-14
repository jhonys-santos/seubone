const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('pedidos-urgentes'));

router.get('/cadastro', (req, res) => res.render('pedidos-urgentes/cadastro'));
router.get('/painel', (req, res) => res.render('pedidos-urgentes/painel'));
router.get('/historico', (req, res) => res.render('pedidos-urgentes/historico'));

router.post('/api/create', async (req, res) => {
  try {
    const nome = req.session.user.nome; // nunca confiar em nome vindo do cliente
    const payload = { ...req.body, action: 'create', inseridoPor: nome };
    const json = await chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, { method: 'POST', body: payload });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao cadastrar pedido: ' + err.message });
  }
});

router.get('/api/list', async (req, res) => {
  try {
    const { status, desde, ate } = req.query;
    const json = await chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, {
      params: { action: 'list', status, desde, ate },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar pedidos: ' + err.message });
  }
});

router.post('/api/despachar', async (req, res) => {
  try {
    const nome = req.session.user.nome;
    const { id } = req.body;
    const json = await chamarAppsScript(env.pedidosUrgentesAppsScriptUrl, {
      method: 'POST',
      body: { action: 'despachar', id, despachadoPor: nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao despachar pedido: ' + err.message });
  }
});

module.exports = router;
