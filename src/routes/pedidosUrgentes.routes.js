const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const pedidos = require('../services/pedidosUrgentesStore');

const router = express.Router();

// ── Painel do Estoque e Histórico: SEM login ────────────────────────────────
// A equipe do estoque abre o link direto, sem entrar no hub (mesma ideia de Wallac > Solicitar Personalização).
// Por decisão da operação, só o pessoal do estoque tem o endereço. Quem despacha escolhe o nome numa lista
// (ou digita em "Outros"), porque não há usuário logado. Cadastrar pedido continua exigindo login.
router.get('/painel', (req, res) => res.render('pedidos-urgentes/painel'));
router.get('/historico', (req, res) => res.render('pedidos-urgentes/historico'));

router.get('/api/list', async (req, res) => {
  try {
    const { status, desde, ate } = req.query;
    const json = await pedidos.listar(status, desde, ate);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar pedidos: ' + err.message });
  }
});

router.post('/api/despachar', async (req, res) => {
  try {
    const { id, nomeDespacho } = req.body || {};
    // Sem login, o nome vem da lista/campo "Outros" da tela. Quem estiver logado no hub e não informar nome usa o da sessão.
    const digitado = typeof nomeDespacho === 'string' ? nomeDespacho.trim().slice(0, 80) : '';
    const despachadoPor = digitado || (req.session && req.session.user ? req.session.user.nome : '');
    if (!despachadoPor) return res.status(400).json({ ok: false, erro: 'Informe quem está despachando o pedido.' });
    if (typeof id !== 'string' || !id.trim()) return res.status(400).json({ ok: false, erro: 'Pedido não informado.' });
    const json = await pedidos.despachar({ id, despachadoPor });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao despachar pedido: ' + err.message });
  }
});

// ── Cadastro de pedido: só logado, com acesso ao painel ─────────────────────
router.use(requireAuth, requirePainel('pedidos-urgentes'));

router.get('/cadastro', (req, res) => res.render('pedidos-urgentes/cadastro'));

router.post('/api/create', async (req, res) => {
  try {
    const nome = req.session.user.nome; // nunca confiar em nome vindo do cliente
    const payload = { ...req.body, inseridoPor: nome };
    const json = await pedidos.criar(payload);
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao cadastrar pedido: ' + err.message });
  }
});

module.exports = router;
