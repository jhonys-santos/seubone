const express = require('express');
const { requireAuth } = require('../middleware/auth');
const notificacoesService = require('../services/notificacoes.service');

const router = express.Router();

// Sem painel específico — o sininho aparece pra qualquer usuário logado,
// não importa quais painéis ele tem liberado.
router.use(requireAuth);

router.get('/api/notificacoes', async (req, res) => {
  try {
    const notificacoes = await notificacoesService.listarNaoLidas(req.session.user.slug);
    res.json({ ok: true, notificacoes });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar notificações: ' + err.message });
  }
});

router.post('/api/notificacoes/:id/marcar-lida', async (req, res) => {
  try {
    const ok = await notificacoesService.marcarLida(req.params.id, req.session.user.slug);
    res.json({ ok });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao marcar como lida: ' + err.message });
  }
});

module.exports = router;
