// Cotação de frete (Azul e Correios) para quem NÃO tem acesso ao hub — página pública, sem login, como /wallac/solicitar.
// Como qualquer pessoa com o link consegue chamar as APIs de cotação, há um limite de consultas por IP.
const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { cotarAzul, cotarCorreios } = require('./cotacoesHandlers');

const router = express.Router();

const limite = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas cotações em pouco tempo. Aguarde alguns minutos e tente de novo.', tipo: 'INDISPONIVEL' },
});

router.get('/', (req, res) => {
  res.render('cotacoes/externa', {
    azulCepOrigemPadrao: env.azulCepOrigemPadrao || '',
    correiosCepOrigemPadrao: env.correiosCepOrigemPadrao || '',
  });
});

router.post('/api/azul/cotar', limite, cotarAzul);
router.post('/api/correios/cotar', limite, cotarCorreios);

module.exports = router;
