const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const agenda = require('../services/agendaStore');
const manifestoEscala = require('../services/manifestoEscala.service');

const router = express.Router();

// Mesma audiência que já vê Foco/Agenda na Home hoje (visão de Ranking SAC).
router.use(requireAuth, requirePainel('ranking-sac'));

router.get('/api/dados', async (req, res) => {
  try {
    const json = await agenda.ler();
    // Com MANIFESTO_ESCALA=on o Manifesto da semana vem da Escala do Manifesto (ver mesclarNaAgenda). Falha aqui não derruba a agenda.
    if (json && json.ok && json.dados && Array.isArray(json.dados.eventos)) {
      try { json.dados.eventos = await manifestoEscala.mesclarNaAgenda(json.dados.eventos); } catch (e) { console.error('[agenda-semana] escala do Manifesto indisponível, mostrando a agenda como está:', e.message); }
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar foco/agenda: ' + err.message });
  }
});

// Editar — só gestor, reforçado aqui no servidor (o Apps Script só confia
// no segredo compartilhado, quem pode usar essas ações é decidido aqui).
router.post('/api/foco', requireRole('gestor'), async (req, res) => {
  try {
    const { texto } = req.body;
    const json = await agenda.salvarFoco(texto);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao salvar foco: ' + err.message });
  }
});

router.post('/api/evento', requireRole('gestor'), async (req, res) => {
  try {
    const { dia, hora, descricao, tipo } = req.body;
    const json = await agenda.adicionarEvento(dia, hora, descricao, tipo);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao adicionar evento: ' + err.message });
  }
});

router.post('/api/evento-editar', requireRole('gestor'), async (req, res) => {
  try {
    const { linha, dia, hora, descricao, tipo } = req.body;
    const json = await agenda.editarEvento(linha, dia, hora, descricao, tipo);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao editar evento: ' + err.message });
  }
});

router.post('/api/evento-excluir', requireRole('gestor'), async (req, res) => {
  try {
    const { linha } = req.body;
    const json = await agenda.excluirEvento(linha);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao excluir evento: ' + err.message });
  }
});

module.exports = router;
