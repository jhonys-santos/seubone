const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const notificacoesService = require('../services/notificacoes.service');
const env = require('../config/env');

const router = express.Router();

// Webhook do n8n avisando que um "Solicitar pagamento" foi concluído pelo
// financeiro — protegido por segredo compartilhado, não por sessão (o n8n
// não é um usuário logado no hub), por isso essa rota vem ANTES do
// requireAuth abaixo. Mesmo padrão do webhook de Registro de Demandas.
router.post('/webhook/n8n', async (req, res) => {
  try {
    const { segredo, id, anexos, concluidoPor } = req.body;
    if (!env.n8nWebhookSecret || segredo !== env.n8nWebhookSecret) {
      return res.status(401).json({ ok: false, erro: 'Segredo inválido.' });
    }
    if (!id) {
      return res.status(400).json({ ok: false, erro: 'Informe "id".' });
    }
    const json = await chamarAppsScript(env.corridasPagamentosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'marcar', id, concluidoPor: concluidoPor || 'Financeiro (n8n)', anexos: anexos || [] },
    });
    if (json.ok) {
      // Link pro histórico dentro de Solicitações Financeiro — é lá que
      // fica a lista de todos os pagamentos, venham de Corridas Avulsas
      // ou do formulário geral (mesma planilha).
      notificacoesService.adicionar(`Pagamento ${id} foi concluído pelo financeiro.`, '/registro-demandas/historico-pagamento', json.solicitanteSlug || null)
        .catch((err) => console.error('[corridas-avulsas] falha ao criar notificação:', err.message));
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao processar retorno do n8n: ' + err.message });
  }
});

// Liberado pra qualquer usuário logado — ver src/config/paineis.js.
router.use(requireAuth);

// Avisa o n8n quando um pagamento é solicitado — não trava nem falha o
// cadastro se o n8n estiver fora do ar ou a URL ainda não tiver sido
// configurada (só loga o erro). Mesma variável de ambiente reservada pra
// Pagamento (N8N_CORRIDAS_PAGAMENTOS_WEBHOOK_URL) — hoje ela aponta pro
// mesmo workflow n8n do Registro/Reembolso (um branch por "tipo" dentro
// dele), mas fica separada no .env pra virar um workflow próprio depois
// sem precisar mudar código. "tipo: 'pagamento'" é o que o n8n usa pra
// saber qual branch seguir.
async function notificarN8nPagamento(payload) {
  if (!env.n8nCorridasPagamentosWebhookUrl) return;
  try {
    await fetch(env.n8nCorridasPagamentosWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'pagamento', ...payload }),
    });
  } catch (err) {
    console.error('[corridas-avulsas] falha ao notificar n8n:', err.message);
  }
}

router.get('/', (req, res) => res.render('corridas-avulsas/index'));

router.post('/api/solicitar-pagamento', async (req, res) => {
  try {
    const { anexos, ...campos } = req.body;
    // "solicitanteSlug" vem sempre da sessão, nunca do corpo enviado pelo
    // cliente — é o que a notificação de retorno usa pra saber quem avisar.
    const json = await chamarAppsScript(env.corridasPagamentosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'create', ...req.body, solicitanteSlug: req.session.user.slug },
    });
    if (json.ok) {
      notificarN8nPagamento({ id: json.id, ...campos, anexos: json.anexos || [] });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao solicitar pagamento: ' + err.message });
  }
});

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
    const json = await chamarAppsScript(env.corridasAvulsasAppsScriptUrl, { params: { action: 'lista', desde, ate }, cache: true });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar corridas: ' + err.message });
  }
});

module.exports = router;
