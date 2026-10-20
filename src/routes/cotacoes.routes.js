const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const env = require('../config/env');
const { cotarAzul, cotarCorreios } = require('./cotacoesHandlers');

const router = express.Router();

router.use(requireAuth, requirePainel('cotacoes'));

router.get('/azul', (req, res) => {
  res.render('cotacoes/azul', { cepOrigemPadrao: env.azulCepOrigemPadrao || '' });
});

router.get('/correios', (req, res) => {
  res.render('cotacoes/correios', { cepOrigemPadrao: env.correiosCepOrigemPadrao || '' });
});

// POST /cotacoes/api/azul/cotar e /cotacoes/api/correios/cotar — o token/código de acesso nunca chega ao navegador.
router.post('/api/azul/cotar', cotarAzul);
router.post('/api/correios/cotar', cotarCorreios);

module.exports = router;
