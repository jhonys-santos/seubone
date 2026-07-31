const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Rascunho de dashboard executivo — só gestor, sem filtro por slug (visão
// agregada da operação toda). Página é 100% client-side: só chama endpoints
// que já existem em outros painéis, nenhum Apps Script novo aqui.
router.use(requireAuth, requireRole('gestor'));

router.get('/', (req, res) => {
  res.render('executivo/index');
});

module.exports = router;
