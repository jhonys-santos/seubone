const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { criarOuAtualizarUsuario } = require('../services/usuarios.service');

const router = express.Router();

// Existe pra criar/atualizar colaboradores sem precisar de acesso a Shell
// (o plano Free da Render não tem terminal). Fica sempre atrás de um
// SETUP_TOKEN — sem essa variável configurada, a rota nem funciona.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(limiter);

router.get('/setup', (req, res) => {
  if (!env.setupToken) {
    return res.status(404).send('Não encontrado.');
  }
  res.render('setup', { erro: null, sucesso: null, usuarioCriado: null });
});

router.post('/setup', async (req, res) => {
  if (!env.setupToken) {
    return res.status(404).send('Não encontrado.');
  }
  const { token, usuario, senha, nome, slug, role, tipo, paineis } = req.body;

  if (token !== env.setupToken) {
    return res.status(403).render('setup', { erro: 'Código de acesso incorreto.', sucesso: null, usuarioCriado: null });
  }
  if (!usuario || !senha || !nome || !slug) {
    return res.status(400).render('setup', { erro: 'Usuário, senha, nome e slug são obrigatórios.', sucesso: null, usuarioCriado: null });
  }
  if (!['colaborador', 'gestor'].includes(role)) {
    return res.status(400).render('setup', { erro: 'Papel inválido.', sucesso: null, usuarioCriado: null });
  }

  const paineisArr = String(paineis || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const registro = await criarOuAtualizarUsuario({
    usuario: usuario.trim(),
    senha,
    nome: nome.trim(),
    slug: slug.trim(),
    role,
    tipo: tipo ? tipo.trim() : null,
    paineis: paineisArr,
  });

  res.render('setup', {
    erro: null,
    sucesso: `Usuário "${registro.usuario}" salvo com sucesso.`,
    usuarioCriado: registro,
  });
});

module.exports = router;
