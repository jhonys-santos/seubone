const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('ranking-sac'));

const CHAVES_VALIDAS = ['atd', 'rsl', 'kpi', 'agenda'];

router.get('/', (req, res) => {
  res.render('ranking-sac/index');
});

// Devolve o CSV cru (mesmo formato que o Google Sheets publica) — o parsing
// client-side original não muda uma linha, só a URL de onde ele busca.
router.get('/api/csv/:chave', async (req, res) => {
  const { chave } = req.params;
  if (!CHAVES_VALIDAS.includes(chave)) {
    return res.status(400).send('chave inválida');
  }
  try {
    const csv = await chamarAppsScript(env.rankingSacCsvUrls[chave]);
    res.type('text/csv').send(typeof csv === 'string' ? csv : '');
  } catch (err) {
    res.status(502).send('erro ao buscar planilha: ' + err.message);
  }
});

module.exports = router;
