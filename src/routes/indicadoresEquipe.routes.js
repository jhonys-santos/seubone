const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Visão de gestor sobre a equipe — nada aqui filtra por slug da sessão,
// então trava por papel (não por painel liberado por usuário) igual à
// Gestão de Estoque trava por slug.
router.use(requireAuth, requireRole('gestor'));

// Ainda sem integração com a planilha — só o visual, com dados de
// exemplo no front (public/js/indicadores-equipe.js). Ligar aos dados
// reais é o próximo passo, depois que o layout for validado.
router.get('/atendimento', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'atendimento' });
});

router.get('/resolucao', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'resolucao' });
});

module.exports = router;
