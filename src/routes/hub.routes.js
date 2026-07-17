const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  // paineisVisiveis/atalhosVisiveis já vêm prontos de res.locals (middleware
  // global em server.js) — a home só precisa renderizar.
  res.render('hub-home');
});

module.exports = router;
