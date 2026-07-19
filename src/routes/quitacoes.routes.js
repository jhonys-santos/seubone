const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('quitacoes'));

router.get('/cadastrar', (req, res) => res.render('quitacoes/cadastrar'));
router.get('/painel', (req, res) => res.render('quitacoes/painel'));
router.get('/historico', (req, res) => res.render('quitacoes/historico'));

// Cada consultor só vê o que ele mesmo cadastrou; gestor vê tudo (pra saber
// quem cobrar). A planilha sempre devolve tudo — o filtro que importa de
// verdade é este aqui, no servidor, nunca só escondido na tela.
function podeVer(usuario, item) {
  return usuario.role === 'gestor' || item.cadastrado_por_slug === usuario.slug;
}

router.post('/api/cadastrar', async (req, res) => {
  try {
    const u = req.session.user;
    const payload = { ...req.body, action: 'cadastrar', cadastradoPorSlug: u.slug, cadastradoPorNome: u.nome };
    const json = await chamarAppsScript(env.quitacoesAppsScriptUrl, { method: 'POST', body: payload });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao cadastrar: ' + err.message });
  }
});

router.get('/api/lista', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.quitacoesAppsScriptUrl, { params: { action: 'lista', status: 'pendente' } });
    if (!json.ok) return res.json(json);
    res.json({ ok: true, itens: (json.itens || []).filter((i) => podeVer(req.session.user, i)) });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar lista: ' + err.message });
  }
});

router.get('/api/historico', async (req, res) => {
  try {
    const { desde, ate } = req.query;
    const json = await chamarAppsScript(env.quitacoesAppsScriptUrl, { params: { action: 'lista', status: 'pago', desde, ate } });
    if (!json.ok) return res.json(json);
    res.json({ ok: true, itens: (json.itens || []).filter((i) => podeVer(req.session.user, i)) });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar histórico: ' + err.message });
  }
});

router.post('/api/marcar-pago', async (req, res) => {
  try {
    const u = req.session.user;
    const { id } = req.body;

    // Confirma que o item é do próprio consultor (a não ser que seja
    // gestor) antes de marcar como pago — nunca confia na lista que já
    // estava desenhada na tela do navegador.
    if (u.role !== 'gestor') {
      const atual = await chamarAppsScript(env.quitacoesAppsScriptUrl, { params: { action: 'lista', status: 'pendente' } });
      const item = (atual.itens || []).find((i) => String(i.id) === String(id));
      if (!item || item.cadastrado_por_slug !== u.slug) {
        return res.status(403).json({ ok: false, erro: 'Você só pode marcar como pago pedidos que você mesmo cadastrou.' });
      }
    }

    const json = await chamarAppsScript(env.quitacoesAppsScriptUrl, { method: 'POST', body: { action: 'marcarPago', id } });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao marcar como pago: ' + err.message });
  }
});

module.exports = router;
