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

// Webhook do CRM (Lulu 2.0) avisando de um ticket aberto (ex: pedido
// atrasado) — protegido por segredo compartilhado, não por sessão (o CRM
// não é um usuário logado no hub, por isso essa rota vem ANTES do
// requireAuth abaixo). Reaproveita o mesmo N8N_WEBHOOK_SECRET já usado em
// registro-demandas — não é um segredo novo por integração. O nome da rota
// ficou "n8n" da integração original, mas hoje é chamada direto pelo CRM.
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
      body: { action: 'criar', pedido, idVenda, identificador, setor, link, observacao, origem: 'Lulu 2.0', usuario: 'Lulu 2.0' },
    });
    if (json.ok) {
      notificarGestoresSemResponsavel(json.rowIndex, json.idTicket, pedido);
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao processar ticket do CRM: ' + err.message });
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
    const { pedido, idVenda, identificador, setor, responsavel, responsavelSlug, link, observacao, fotos } = req.body;
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: {
        action: 'criar', pedido, idVenda, identificador, setor, responsavel, responsavelSlug, link, observacao,
        fotos: fotos || [], origem: 'manual', usuario: req.session.user.nome, usuarioSlug: req.session.user.slug,
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

// Mudar status (Aberto / Em acompanhamento / Urgência / Resolvido) — sem
// trava extra de role no servidor (mesmo padrão do "finalizarRefab" em
// Erros): a UI só mostra o controle pro responsável ou pro gestor, mas
// qualquer um com acesso ao painel pode chamar essa rota. "Resolvido"
// fecha o ticket (grava data de fechamento) do lado do Apps Script.
router.post('/api/status', async (req, res) => {
  try {
    const { rowIndex, status } = req.body;
    if (!status) {
      return res.status(400).json({ ok: false, erro: 'Status ausente.' });
    }
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'mudarStatus', rowIndex, status, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao mudar status: ' + err.message });
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

// Anexar imagem(ns) a um ticket já existente — na criação ou depois, com o
// ticket já atribuído a alguém. Mesma trava aberta de comentar/fechar:
// qualquer um com acesso ao painel pode anexar.
router.post('/api/anexar', async (req, res) => {
  try {
    const { rowIndex, fotos } = req.body;
    if (!fotos || !fotos.length) {
      return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
    }
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'adicionarAnexos', rowIndex, fotos, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao anexar arquivo(s): ' + err.message });
  }
});

// Acompanhamento (evento do cliente, entrega, prazos) — anotação de quem
// está tratando o ticket, sem trava extra de role (mesma ideia de comentar).
router.post('/api/acompanhamento', async (req, res) => {
  try {
    const { rowIndex, temEvento, dataEvento, entrega, aeroporto, ppe, previsaoFinalizacao, pFolha } = req.body;
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'atualizarAcompanhamento', rowIndex, temEvento, dataEvento, entrega, aeroporto, ppe, previsaoFinalizacao, pFolha, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao salvar acompanhamento: ' + err.message });
  }
});

// Preencher o link do card quando o ticket foi criado sem ele — sem trava
// extra de role, mesma ideia de comentar/fechar.
router.post('/api/link', async (req, res) => {
  try {
    const { rowIndex, link } = req.body;
    if (!link || !String(link).trim()) {
      return res.status(400).json({ ok: false, erro: 'Link vazio.' });
    }
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, {
      method: 'POST',
      body: { action: 'definirLink', rowIndex, link, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao salvar link: ' + err.message });
  }
});

module.exports = router;
