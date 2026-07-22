const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

// Webhook do n8n avisando que uma solicitação (Registro ou Reembolso) foi
// concluída pelo financeiro — protegido por segredo compartilhado, não por
// sessão (o n8n não é um usuário logado no hub, por isso essa rota vem
// ANTES do requireAuth abaixo, pra não exigir login de quem está chamando).
router.post('/webhook/n8n', async (req, res) => {
  try {
    const { segredo, tipo, id, anexos, concluidoPor } = req.body;
    if (!env.n8nWebhookSecret || segredo !== env.n8nWebhookSecret) {
      return res.status(401).json({ ok: false, erro: 'Segredo inválido.' });
    }
    if (!id || (tipo !== 'registro' && tipo !== 'reembolso')) {
      return res.status(400).json({ ok: false, erro: 'Informe "id" e "tipo" ("registro" ou "reembolso").' });
    }

    const action = tipo === 'reembolso' ? 'marcarReembolso' : 'marcar';
    const json = await chamarAppsScript(env.registroDemandasAppsScriptUrl, {
      method: 'POST',
      body: { action, id, status: 'Feito', marcadoPor: concluidoPor || 'Financeiro (n8n)', anexos: anexos || [] },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao processar retorno do n8n: ' + err.message });
  }
});

router.use(requireAuth);

// Avisa o n8n quando uma solicitação é criada — não trava nem falha o
// cadastro do usuário se o n8n estiver fora do ar ou a URL ainda não
// tiver sido configurada (só loga o erro).
async function notificarN8n(tipo, payload) {
  if (!env.n8nRegistroDemandasWebhookUrl) return;
  try {
    await fetch(env.n8nRegistroDemandasWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, ...payload }),
    });
  } catch (err) {
    console.error('[registro-demandas] falha ao notificar n8n:', err.message);
  }
}

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
    if (json.ok) {
      const { anexos, ...campos } = req.body;
      notificarN8n('registro', { id: json.id, ...campos, anexos: json.anexos || [] });
    }
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
    if (json.ok) {
      const { anexos, ...campos } = req.body;
      notificarN8n('reembolso', { id: json.id, ...campos, anexos: json.anexos || [] });
    }
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
