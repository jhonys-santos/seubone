const { buscarPorSlug } = require('../services/usuarios.service');

/**
 * Decide qual "slug" (colaborador) a requisição pode enxergar.
 *
 * Regra de segurança central do hub: um colaborador NUNCA pode escolher o
 * slug de outra pessoa via query string — mesmo que o front-end não mostre
 * nenhum seletor, um request forjado não deve conseguir contornar isso.
 * Só gestor pode pedir o slug de qualquer colaborador.
 *
 * Popula req.slugAlvo com o slug efetivamente autorizado para esta requisição.
 */
function resolveSlug(req, res, next) {
  const usuarioSessao = req.session.user;
  if (!usuarioSessao) {
    return res.status(401).json({ ok: false, erro: 'Não autenticado.' });
  }

  const slugPedido = req.query.slug || req.body?.slug;

  if (usuarioSessao.role !== 'gestor') {
    req.slugAlvo = usuarioSessao.slug;
    return next();
  }

  if (!slugPedido) {
    req.slugAlvo = usuarioSessao.slug;
    return next();
  }

  const alvo = buscarPorSlug(slugPedido);
  if (!alvo) {
    return res.status(400).json({ ok: false, erro: 'Colaborador (slug) inválido.' });
  }

  req.slugAlvo = alvo.slug;
  next();
}

module.exports = { resolveSlug };
