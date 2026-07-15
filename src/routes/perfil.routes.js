const express = require('express');
const { requireAuth } = require('../middleware/auth');
const usuariosService = require('../services/usuarios.service');

const router = express.Router();

router.use(requireAuth);

router.get('/perfil', (req, res) => {
  res.render('perfil', { erro: null, sucesso: null });
});

router.post('/perfil/senha', async (req, res) => {
  const { senhaAtual, senhaNova, senhaNovaConfirmar } = req.body;

  if (!senhaAtual || !senhaNova || !senhaNovaConfirmar) {
    return res.status(400).render('perfil', { erro: 'Preencha todos os campos.', sucesso: null });
  }
  if (senhaNova.length < 6) {
    return res.status(400).render('perfil', { erro: 'A nova senha precisa ter pelo menos 6 caracteres.', sucesso: null });
  }
  if (senhaNova !== senhaNovaConfirmar) {
    return res.status(400).render('perfil', { erro: 'A confirmação não bate com a nova senha.', sucesso: null });
  }

  const resultado = await usuariosService.alterarSenha(req.session.user.usuario, senhaAtual, senhaNova);
  if (!resultado.ok) {
    return res.status(403).render('perfil', { erro: resultado.erro, sucesso: null });
  }

  res.render('perfil', { erro: null, sucesso: 'Senha alterada com sucesso.' });
});

module.exports = router;
