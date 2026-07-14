const express = require('express');
const rateLimit = require('express-rate-limit');
const { autenticar } = require('../services/usuarios.service');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { erro: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { usuario, senha } = req.body;
  if (!usuario || !senha) {
    return res.status(400).render('login', { erro: 'Preencha usuário e senha.' });
  }

  const sessaoUsuario = await autenticar(usuario, senha);
  if (!sessaoUsuario) {
    return res.status(401).render('login', { erro: 'Usuário ou senha incorretos.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { erro: 'Erro interno. Tente novamente.' });
    req.session.user = sessaoUsuario;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
