const { podeAcessarPainel } = require('../services/usuarios.service');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).render('erro', {
        titulo: 'Acesso negado',
        mensagem: 'Você não tem permissão para acessar esta página.',
        usuario: req.session.user || null,
      });
    }
    next();
  };
}

function requirePainel(painel) {
  return (req, res, next) => {
    if (!req.session.user || !podeAcessarPainel(req.session.user, painel)) {
      return res.status(403).render('erro', {
        titulo: 'Acesso negado',
        mensagem: 'Você não tem acesso a este painel.',
        usuario: req.session.user || null,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePainel };
