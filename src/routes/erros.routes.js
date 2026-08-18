const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const notificacoesService = require('../services/notificacoes.service');
const usuariosService = require('../services/usuarios.service');
const env = require('../config/env');

const router = express.Router();

// Avisa todo gestor quando um caso entra na fila de aprovação de
// Refabricação — não deixa uma falha aqui derrubar a resposta do
// create/audit, só loga (o caso já foi salvo, essa é só a notificação).
function notificarGestoresRefab(idVenda, nomeCard, rowIndex) {
  const link = '/erros?refab=' + rowIndex;
  const mensagem = `Caso #${idVenda || rowIndex} (${nomeCard || 'sem nome'}) aguardando aprovação de Refabricação.`;
  usuariosService
    .listarUsuarios()
    .filter((u) => u.role === 'gestor')
    .forEach((u) => {
      notificacoesService.adicionar(mensagem, link, u.slug).catch((err) => console.error('[erros] falha ao notificar gestor:', err.message));
    });
}

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
      // "usuario"/"usuarioSlug" vêm sempre da sessão, nunca do que o
      // navegador manda — mesma regra de autoria de todo o resto do hub.
      // "usuarioSlug" é o que permite notificar essa pessoa de volta quando
      // o caso for aprovado/reprovado na fila de Refabricação.
      body: { action: 'criar', fields: req.body.fields || {}, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok && json.entrouAprovacaoRefab) {
      notificarGestoresRefab(req.body.fields && req.body.fields.idVenda, req.body.fields && req.body.fields.nomeCard, json.rowIndex);
    }
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
      body: { action: 'audit', rowIndex: req.body.rowIndex, fields: req.body.fields || {}, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok && json.entrouAprovacaoRefab) {
      // No /api/audit, o form não reenvia idVenda/nomeCard — vêm do próprio
      // Apps Script (auditarCaso_ os lê da planilha), não de req.body.fields.
      notificarGestoresRefab(json.idVenda, json.nomeCard, json.rowIndex);
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao salvar auditoria: ' + err.message });
  }
});

// Aprova/reprova um caso na fila de Refabricação — só gestor decide, sempre
// com comentário. Quem registrou o caso é notificado de volta (slug resolvido
// no Apps Script via Historico, não confiamos em nada vindo do cliente aqui).
router.post('/api/refab/decidir', requireRole('gestor'), async (req, res) => {
  try {
    const { rowIndex, decisao, comentario } = req.body;
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'decidirRefab', rowIndex, decisao, comentario, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok && json.registradoPorSlug) {
      const aprovado = json.decisao === 'Aprovado';
      const mensagem = `Refabricação do caso #${json.idVenda || rowIndex} (${json.nomeCard || 'sem nome'}) foi ${aprovado ? 'aprovada' : 'reprovada'}.${comentario ? ' Comentário: ' + comentario : ''}`;
      notificacoesService
        .adicionar(mensagem, '/erros?refab=' + rowIndex, json.registradoPorSlug)
        .catch((err) => console.error('[erros] falha ao notificar registrante:', err.message));
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao decidir Refabricação: ' + err.message });
  }
});

// Quem registrou o caso marca que já enviou pra produção (sistema externo ao
// hub) — sem trava extra de role, a própria tela de colaborador só mostra os
// casos que ele mesmo registrou.
router.post('/api/refab/finalizar', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'finalizarRefab', rowIndex: req.body.rowIndex, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao finalizar Refabricação: ' + err.message });
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

// Comentário de acompanhamento — sem trava de gestor de propósito: qualquer
// colaborador com acesso ao painel pode comentar mesmo não podendo editar a
// auditoria (ex: algo deu errado de novo depois do caso já resolvido).
// Todo gestor é notificado pra poder ajustar o que for preciso.
router.post('/api/comentar', async (req, res) => {
  try {
    const { rowIndex, comentario } = req.body;
    if (!comentario || !String(comentario).trim()) {
      return res.status(400).json({ ok: false, error: 'Comentário vazio.' });
    }
    const json = await chamarAppsScript(env.errosAppsScriptUrl, {
      method: 'POST',
      body: { action: 'comentarCaso', rowIndex, comentario, usuario: req.session.user.nome, usuarioSlug: req.session.user.slug },
    });
    if (json.ok) {
      const mensagem = `${req.session.user.nome} comentou no caso #${json.idVenda || rowIndex}${json.nomeCard ? ' (' + json.nomeCard + ')' : ''}.`;
      usuariosService
        .listarUsuarios()
        .filter((u) => u.role === 'gestor' && u.slug !== req.session.user.slug)
        .forEach((u) => {
          notificacoesService.adicionar(mensagem, '/erros#/casos/' + rowIndex, u.slug).catch((err) => console.error('[erros] falha ao notificar gestor sobre comentário:', err.message));
        });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao comentar: ' + err.message });
  }
});

module.exports = router;
