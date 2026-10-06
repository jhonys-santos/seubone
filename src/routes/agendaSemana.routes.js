const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const agenda = require('../services/agendaStore');

const router = express.Router();

// Mesma audiência que já vê Foco/Agenda na Home hoje (visão de Ranking SAC).
router.use(requireAuth, requirePainel('ranking-sac'));

router.get('/api/dados', async (req, res) => {
  try {
    const json = await agenda.ler();
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
