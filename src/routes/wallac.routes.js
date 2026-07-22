const express = require('express');
const { requireAuth, requirePainel, requireSlug, requireSlugOuRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

// ── Painel de produção (kanban) — precisa estar logado e ter acesso ao painel wallac ──
router.get('/', requireAuth, requirePainel('wallac'), (req, res) => {
  res.render('wallac/index');
});

// Histórico de finalizados — mesma fonte de dados do kanban (/api/cards),
// só filtrando por status no cliente (essa planilha não tem uma ação
// separada de histórico no Apps Script).
router.get('/historico', requireAuth, requirePainel('wallac'), (req, res) => {
  res.render('wallac/historico');
});

router.get('/api/cards', requireAuth, requirePainel('wallac'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar cards: ' + err.message });
  }
});

router.post('/api/status', requireAuth, requirePainel('wallac'), async (req, res) => {
  try {
    const { chave, novo_status } = req.body;
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: { acao: 'mudar_status', chave, novo_status },
    });
    res.json(json && typeof json === 'object' ? json : { ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

// ── Gestão de estoque — só o login do Wallac, ninguém mais ────────────────
router.get('/estoque', requireAuth, requireSlug('wallac'), (req, res) => {
  res.render('wallac/estoque');
});

router.get('/api/estoque-admin', requireAuth, requireSlug('wallac'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, { params: { acao: 'estoque_admin' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar estoque: ' + err.message });
  }
});

router.post('/api/estoque/adicionar', requireAuth, requireSlug('wallac'), async (req, res) => {
  try {
    const { produto, quantidade } = req.body;
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: { acao: 'estoque_adicionar', produto, quantidade },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao adicionar produto: ' + err.message });
  }
});

router.post('/api/estoque/editar', requireAuth, requireSlug('wallac'), async (req, res) => {
  try {
    const { linha, produto, quantidade } = req.body;
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: { acao: 'estoque_editar', linha, produto, quantidade },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao editar produto: ' + err.message });
  }
});

router.post('/api/estoque/remover', requireAuth, requireSlug('wallac'), async (req, res) => {
  try {
    const { linha } = req.body;
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: { acao: 'estoque_remover', linha },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao remover produto: ' + err.message });
  }
});

// ── Premiação (SB Coin) — o Wallac e qualquer gestor acompanham ──────────
router.get('/premiacao', requireAuth, requireSlugOuRole('wallac', 'gestor'), (req, res) => {
  res.render('wallac/premiacao');
});

router.get('/api/premiacao-historico', requireAuth, requireSlugOuRole('wallac', 'gestor'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, { params: { acao: 'premiacao_historico' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar histórico de premiação: ' + err.message });
  }
});

// Progresso da semana em andamento — calculado na hora, não espera o
// fechamento oficial de sexta-feira (que só grava no histórico).
router.get('/api/premiacao-semana-atual', requireAuth, requireSlugOuRole('wallac', 'gestor'), async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, { params: { acao: 'premiacao_semana_atual' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar semana atual: ' + err.message });
  }
});

// ── Solicitar personalização — página pública, sem login. Pode ser
// compartilhada com gente de fora do hub (outro setor); por isso mesmo o
// navegador continua sem falar direto com o Apps Script — passa pelo
// servidor, que é quem guarda a URL/segredo.
router.get('/solicitar', (req, res) => {
  res.render('wallac/solicitar');
});

router.get('/api/estoque-publico', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, { params: { acao: 'estoque' } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar estoque: ' + err.message });
  }
});

router.post('/api/solicitar', async (req, res) => {
  try {
    const {
      produto, eh_outro, quantidade, id_venda_cliente,
      prazo_producao, prazo_entrega, observacoes, logo_base64, logo_nome,
    } = req.body;
    const json = await chamarAppsScript(env.wallacAppsScriptUrl, {
      method: 'POST',
      body: {
        acao: 'solicitar_personalizacao',
        produto, eh_outro, quantidade, id_venda_cliente,
        prazo_producao, prazo_entrega, observacoes, logo_base64, logo_nome,
      },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao enviar solicitação: ' + err.message });
  }
});

module.exports = router;
