const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('manifesto'));

router.get('/', (req, res) => {
  res.render('manifesto/index');
});

// API externa do setor de cobranças (fora do padrão Apps Script do resto do
// hub) — autentica com Bearer token, não com o "segredo" de query string.
// Timeout próprio: é um serviço diferente, sem garantia de latência igual à
// do Google, mas ainda assim não pode ficar pendurado pra sempre.
const TIMEOUT_MS = 20000;

router.get('/api/notas', async (req, res) => {
  if (!env.manifestoNotasUrl || !env.manifestoNotasToken) {
    return res.status(500).json({ ok: false, error: 'Integração de notas fiscais não configurada (faltam MANIFESTO_NOTAS_URL/MANIFESTO_NOTAS_TOKEN no .env).' });
  }
  const { de, ate } = req.query;
  const url = new URL(env.manifestoNotasUrl);
  if (de) url.searchParams.set('de', de);
  if (ate) url.searchParams.set('ate', ate);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${env.manifestoNotasToken}` },
      signal: controller.signal,
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) {
      return res.status(502).json({ ok: false, error: (json && json.error) || `Falha ao buscar notas (HTTP ${resp.status}).` });
    }
    res.json(json);
  } catch (err) {
    const msg = err.name === 'AbortError' ? `A consulta de notas não respondeu em ${TIMEOUT_MS / 1000}s.` : err.message;
    res.status(502).json({ ok: false, error: 'Falha ao buscar notas: ' + msg });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
