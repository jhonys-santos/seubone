const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const notificacoesService = require('../services/notificacoes.service');
const usuariosService = require('../services/usuarios.service');
const env = require('../config/env');

const router = express.Router();

// Avisa todo gestor quando um ticket precisa de alguém pra assumir (recém
// aberto sem responsável) — não deixa uma falha aqui derrubar a resposta
// do create, só loga (o ticket já foi salvo, essa é só a notificação).
function notificarGestoresSemResponsavel(rowIndex, idTicket, pedido) {
  const link = '/tickets#/t/' + rowIndex;
  const mensagem = `Ticket ${idTicket ? '#' + idTicket : '#' + rowIndex} (${pedido || 'sem pedido'}) aberto sem responsável.`;
  usuariosService
    .listarUsuarios()
    .filter((u) => u.role === 'gestor')
    .forEach((u) => {
      notificacoesService.adicionar(mensagem, link, u.slug).catch((err) => console.error('[tickets] falha ao notificar gestor:', err.message));
    });
}

// Webhook do n8n avisando de um ticket aberto em outro sistema (Octadesk) —
// protegido por segredo compartilhado, não por sessão (o n8n não é um
// usuário logado no hub, por isso essa rota vem ANTES do requireAuth
// abaixo). Reaproveita o mesmo N8N_WEBHOOK_SECRET já usado em
// registro-demandas — não é um segredo novo por integração.
router.post('/webhook/n8n', async (req, res) => {
  try {
    const { segredo, pedido, idVenda, identificador, setor, link, observacao } = req.body;
    if (!env.n8nWebhookSecret || segredo !== env.n8nWebhookSecret) {
      return res.status(401).json({ ok: false, erro: 'Segredo inválido.' });
    }
    if (!identificador) {
      return res.status(400).json({ ok: false, erro: 'Informe "identificador".' });
    }

    // "idTicket" não vem mais de fora — é sempre gerado pelo Apps Script
    // (ver criarTicket_), pra ser o identificador único de dentro do hub,
    // e não um número de outro sistema.
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'criar', pedido, idVenda, identificador, setor, link, observacao, origem: 'n8n', usuario: 'n8n' },
    });
    if (json.ok) {
      notificarGestoresSemResponsavel(json.rowIndex, json.idTicket, pedido);
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao processar ticket do n8n: ' + err.message });
  }
});

router.use(requireAuth, requirePainel('tickets'));

// Nomes de contas de teste/diagnóstico que não devem aparecer como opção
// de responsável — as contas continuam existindo (login etc.), só não
// entram nesse dropdown.
const NOMES_EXCLUIDOS_RESPONSAVEL = ['Diagnostico', 'Diag Gestor', 'Diag Colaborador', 'Diag Wallac'];

router.get('/', (req, res) => {
  // Lista de usuários pro dropdown de "atribuir responsável" — só nome/slug,
  // nada sensível (mesma ideia de expor window.USUARIO_SESSAO pra sessão).
  const usuarios = usuariosService
    .listarUsuarios()
    .filter((u) => !NOMES_EXCLUIDOS_RESPONSAVEL.includes(u.nome))
    .map((u) => ({ nome: u.nome, slug: u.slug }));
  res.render('tickets/index', { usuariosHub: usuarios });
});

router.get('/api/tickets', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar tickets: ' + err.message });
  }
});

router.get('/api/historico', async (req, res) => {
  try {
    const { rowIndex } = req.query;
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, { params: { action: 'historico', rowIndex } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar histórico: ' + err.message });
  }
});

// Criação manual — qualquer colaborador com acesso ao painel pode abrir um
// ticket (igual "registrar" no Painel de Erros).
router.post('/api/criar', async (req, res) => {
  try {
    const { pedido, idVenda, identificador, setor, responsavel, responsavelSlug, link, observacao } = req.body;
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: {
        action: 'criar', pedido, idVenda, identificador, setor, responsavel, responsavelSlug, link, observacao,
        origem: 'manual', usuario: req.session.user.nome, usuarioSlug: req.session.user.slug,
      },
    });
    if (json.ok && !responsavel) {
      notificarGestoresSemResponsavel(json.rowIndex, json.idTicket, pedido);
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao criar ticket: ' + err.message });
  }
});

// Atribuir/trocar responsável — decisão de gestão, mesma trava usada nas
// ações de auditoria do Painel de Erros.
router.post('/api/atribuir', requireRole('gestor'), async (req, res) => {
  try {
    const { rowIndex, responsavel, responsavelSlug } = req.body;
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'atribuir', rowIndex, responsavel, responsavelSlug, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok && responsavelSlug) {
      notificacoesService
        .adicionar(`Você foi atribuído ao ticket ${json.idTicket ? '#' + json.idTicket : '#' + rowIndex}.`, '/tickets#/t/' + rowIndex, responsavelSlug)
        .catch((err) => console.error('[tickets] falha ao notificar responsável:', err.message));
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atribuir responsável: ' + err.message });
  }
});

// Fechar ticket — sem trava extra de role no servidor (mesmo padrão do
// "finalizarRefab" em Erros): a UI só mostra o botão pro responsável ou
// pro gestor, mas qualquer um com acesso ao painel pode chamar essa rota.
router.post('/api/fechar', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'fechar', rowIndex: req.body.rowIndex, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao fechar ticket: ' + err.message });
  }
});

// Comentário de acompanhamento — mesmo padrão do Painel de Erros: qualquer
// colaborador com acesso ao painel pode comentar, todo gestor é notificado.
router.post('/api/comentar', async (req, res) => {
  try {
    const { rowIndex, comentario } = req.body;
    if (!comentario || !String(comentario).trim()) {
      return res.status(400).json({ ok: false, erro: 'Comentário vazio.' });
    }
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'comentarTicket', rowIndex, comentario, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok) {
      const mensagem = `${req.session.user.nome} comentou no ticket ${json.idTicket ? '#' + json.idTicket : '#' + rowIndex}.`;
      usuariosService
        .listarUsuarios()
        .filter((u) => u.role === 'gestor' && u.slug !== req.session.user.slug)
        .forEach((u) => {
          notificacoesService.adicionar(mensagem, '/tickets#/t/' + rowIndex, u.slug).catch((err) => console.error('[tickets] falha ao notificar gestor sobre comentário:', err.message));
        });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao comentar: ' + err.message });
  }
});

module.exports = router;
