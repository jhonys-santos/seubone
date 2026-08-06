const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('painel-erros'));

router.get('/', (req, res) => {
  res.render('erros/index');
});

// Lista todos os casos — mesma trava de sempre: leitura livre pra quem tem o
// painel, escrita de auditoria só pra gestor (ver abaixo).
router.get('/api/casos', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao buscar casos: ' + err.message });
  }
});

router.get('/api/historico', async (req, res) => {
  try {
    const { rowIndex } = req.query;
    const json = await chamarAppsScript(env.errosAppsScriptUrl, { params: { action: 'historico', rowIndex } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao buscar histórico: ' + err.message });
  }
});

// Registrar continua liberado pra qualquer colaborador (no app original,
// "registrar" é true até pra colaborador — só "auditar" é restrito).
router.post('/api/criar', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      // "usuario" vem sempre da sessão, nunca do que o navegador manda —
      // mesma regra de autoria de todo o resto do hub.
      body: { action: 'criar', fields: req.body.fields || {}, usuario: req.session.user.nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao registrar caso: ' + err.message });
  }
});

// Auditar/mudar status são as ações que o app original restringia a
// gestor/dev/auditor (colaborador só via, não editava) — aqui vira
// requireRole('gestor') reforçado no servidor, não só escondido na tela.
router.post('/api/audit', requireRole('gestor'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'audit', rowIndex: req.body.rowIndex, fields: req.body.fields || {}, usuario: req.session.user.nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao salvar auditoria: ' + err.message });
  }
});

router.post('/api/set-status', requireRole('gestor'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'setStatus', rowIndex: req.body.rowIndex, status: req.body.status, usuario: req.session.user.nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao alterar status: ' + err.message });
  }
});

// Backfill de setor (tela "Dados incompletos", Fase 2) — mesma trava de
// gestor das outras ações de auditoria.
router.post('/api/set-setor', requireRole('gestor'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'setSetor', rowIndex: req.body.rowIndex, setor: req.body.setor, usuario: req.session.user.nome },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao preencher setor: ' + err.message });
  }
});

module.exports = router;
