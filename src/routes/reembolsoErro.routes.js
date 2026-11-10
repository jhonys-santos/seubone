// Apoio do bloco "Erro deste pedido" do formulário de Reembolso e do Histórico de Reembolsos: conferir o erro pelo ID da venda, registrar o erro,
// dispensar ("não será necessário") e listar pendências. Qualquer usuário logado; quem pode dispensar é conferido no serviço.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const erro = require('../services/reembolsoErro.service');

const router = express.Router();
router.use(requireAuth);

const falha = (res, e, o) => res.status(502).json({ ok: false, erro: `Falha ao ${o}: ${e.message}` });

router.get('/api/config', async (req, res) => {
  try { res.json({ ok: true, ligado: erro.ligado(), opcoes: erro.ligado() ? await erro.opcoesDoFormulario() : null }); } catch (e) { falha(res, e, 'carregar as opções'); }
});

router.get('/api/conferir', async (req, res) => {
  try { res.json({ ok: true, ids: await erro.conferir(erro.idsDaVenda(req.query.ids)) }); } catch (e) { falha(res, e, 'conferir o erro'); }
});

// Um erro por chamada (cada um sobe os próprios arquivos para o Drive); o autor é sempre o usuário da sessão.
router.post('/api/registrar', async (req, res) => {
  try {
    const r = await erro.registrarErro({ campos: (req.body && req.body.campos) || {}, arquivos: (req.body && req.body.arquivos) || [], usuario: req.session.user });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'registrar o erro'); }
});

router.post('/api/dispensar', async (req, res) => {
  try {
    const { codigo, idVenda, motivo } = req.body || {};
    const r = await erro.dispensar({ codigo, idVenda, motivo, usuario: req.session.user });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'dispensar o erro'); }
});

// Reembolsos sem erro: os do próprio usuário (gestor pode pedir todos com ?todos=1).
router.get('/api/pendentes', async (req, res) => {
  try {
    const u = req.session.user;
    const todos = u.role === 'gestor' && String(req.query.todos) === '1';
    res.json({ ok: true, ligado: erro.ligado(), pendentes: erro.ligado() ? await erro.pendentes(todos ? {} : { slug: u.slug }) : [] });
  } catch (e) { falha(res, e, 'listar as pendências'); }
});

module.exports = router;
