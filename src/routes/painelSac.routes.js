const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { resolveSlug } = require('../middleware/resolveSlug');
const { chamarAppsScript } = require('../services/appsScriptClient');
const { listarUsuarios } = require('../services/usuarios.service');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('painel-sac'));

router.get('/', (req, res) => {
  const u = req.session.user;
  const iniciais = u.nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

  // Lista de colaboradores que o gestor pode "ver como" — só monta se for gestor.
  // Gestor vê todo mundo, independente do time (sac ou ppf).
  const outrosColaboradores =
    u.role === 'gestor'
      ? listarUsuarios()
          .filter((c) => c.slug !== u.slug)
          .map((c) => ({ slug: c.slug, nome: c.nome, tipo: c.tipo, indicadoresPendentes: !!c.indicadoresPendentes }))
      : [];

  res.render('painel-sac/index', {
    usuarioAtual: { ...u, iniciais },
    outrosColaboradores,
  });
});

// ── Indicadores pessoais (respeita resolveSlug: colaborador só vê o próprio slug) ──
router.get('/api/dados', resolveSlug, async (req, res) => {
  try {
    const { periodo, mes, ano, sem_ini, sem_fim } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'dados', usuario: req.slugAlvo, periodo, mes, ano, sem_ini, sem_fim },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar indicadores: ' + err.message });
  }
});

router.get('/api/escala', resolveSlug, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'escala', usuario: req.slugAlvo, mes, ano },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar escala: ' + err.message });
  }
});

// ── Consultores/sábados: listagem entre colegas para pedido de troca.       ──
// Não usa resolveSlug — qualquer colaborador autenticado pode ver a lista de
// colegas e os sábados de qualquer um (é assim que a troca peer-to-peer já
// funcionava no painel original; não é uma visão "gestor vê tudo").
router.get('/api/consultores', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'consultores', usuario: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar consultores: ' + err.message });
  }
});

router.get('/api/sabados-consultor', async (req, res) => {
  try {
    const { alvo, mes, ano } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'sabadosConsultor', usuario: req.session.user.slug, alvo, mes, ano },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar sábados do colega: ' + err.message });
  }
});

router.post('/api/solicitar-troca', async (req, res) => {
  try {
    const u = req.session.user;
    const { dia_solicitante, mes_solicitante, ano_solicitante, consultor_alvo, dia_alvo, mes_alvo, ano_alvo } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: {
        action: 'solicitarTroca',
        usuario: u.slug, // sempre o usuário da sessão, nunca o que o cliente mandar
        dia_solicitante, mes_solicitante, ano_solicitante,
        consultor_alvo, dia_alvo, mes_alvo, ano_alvo,
      },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao solicitar troca: ' + err.message });
  }
});

router.post('/api/responder-troca', async (req, res) => {
  try {
    const u = req.session.user;
    const { id_troca, aceitar } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'responderTroca', usuario: u.slug, id_troca, aceitar },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao responder troca: ' + err.message });
  }
});

// ── Acessos (cofre de senhas pessoal) ────────────────────────────────────
// Sempre opera sobre o slug da PRÓPRIA sessão, nunca sobre slugAlvo/"ver como"
// — são as credenciais de ferramentas de quem está logado, não de quem o
// gestor está visualizando.
router.get('/api/acessos', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'acessos', usuario: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar acessos: ' + err.message });
  }
});

router.post('/api/acessos/salvar', async (req, res) => {
  try {
    const { ferramenta, login, senha, editIdx } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'salvarAcesso', usuario: req.session.user.slug, ferramenta, login, senha, editIdx },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao salvar acesso: ' + err.message });
  }
});

router.post('/api/acessos/excluir', async (req, res) => {
  try {
    const { editIdx } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'excluirAcesso', usuario: req.session.user.slug, editIdx },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao excluir acesso: ' + err.message });
  }
});

router.post('/api/sugestao', async (req, res) => {
  try {
    const u = req.session.user;
    const { titulo, sugestao } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'sugestao', consultor: u.nome, titulo, sugestao },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao enviar sugestão: ' + err.message });
  }
});

module.exports = router;
