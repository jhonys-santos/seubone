const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { podeAcessarPainel } = require('../services/usuarios.service');
const catalogoPaineis = require('../config/paineis');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const paineisVisiveis = catalogoPaineis.filter((p) => podeAcessarPainel(req.session.user, p.chave));
  res.render('hub-home', { paineis: paineisVisiveis });
});

module.exports = router;
