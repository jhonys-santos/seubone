// Tela "Aprovar Reembolsos": só gestor. Aprovar move o card para "Aprovado" no finfin; Negar move para "Negado" (com motivo obrigatório).
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const aprovacao = require('../services/reembolsoAprovacao.service');

const router = express.Router();
router.use(requireAuth, requireRole('gestor'));

router.get('/', (req, res) => {
  res.render('registro-demandas/reembolso-aprovar');
});

router.get('/api/lista', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await aprovacao.listar(req.query.aba === 'decididos' ? 'decididos' : 'pendentes'));
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar os reembolsos: ' + err.message });
  }
});

router.post('/api/decidir', async (req, res) => {
  try {
    const b = req.body || {};
    // Quem decidiu vem sempre da sessão, nunca do corpo.
    const r = await aprovacao.decidir({ codigo: b.codigo, decisao: b.decisao, motivo: b.motivo, usuario: req.session.user });
    console.info('[reembolso-aprovacao]', b.decisao, b.codigo, r.json.ok ? 'ok' : 'recusado: ' + r.json.erro, '- por', req.session.user.slug);
    res.status(r.http).json(r.json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao decidir: ' + err.message });
  }
});

module.exports = router;
