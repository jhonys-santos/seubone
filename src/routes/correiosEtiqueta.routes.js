const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const env = require('../config/env');
const {
  previa, emitir, consultar, cancelar, baixarEtiqueta, ErroEtiqueta, LAYOUTS,
} = require('../services/correiosEtiqueta.service');

const router = express.Router();

router.use(requireAuth, requirePainel('emissao-correios'));

// Reaproveita as mesmas credenciais dos Correios já usadas em Cotações —
// mesmo contrato, mesmo cartão de postagem.
function credCorreios() {
  return {
    correiosUsuario: env.correiosUsuario,
    correiosCodigoAcesso: env.correiosCodigoAcesso,
    correiosCartao: env.correiosCartao,
    correiosContrato: env.correiosContrato,
    correiosDr: env.correiosDr,
  };
}

const STATUS = {
  VALIDACAO: 400,
  NAO_ENCONTRADA: 404,
  CREDENCIAL: 502, // problema de configuração do servidor, não do usuário
  INDISPONIVEL: 503,
};

function respostaDeErro(res, e) {
  if (e instanceof ErroEtiqueta) {
    if (e.tipo !== 'VALIDACAO') console.error('[etiqueta-correios]', e.tipo, e.message, e.detalhe || '');
    const erro = e.tipo === 'CREDENCIAL' ? `${e.message}. Avise o time de tecnologia.` : e.message;
    return res.status(STATUS[e.tipo]).json({ erro, tipo: e.tipo });
  }
  console.error('[etiqueta-correios] erro inesperado', e);
  res.status(500).json({ erro: 'Erro inesperado. Tente novamente.', tipo: 'INDISPONIVEL' });
}

router.get('/', (req, res) => {
  res.render('emissao-correios/index');
});

// POST /emissao-correios/api/previa — monta e valida o envio a partir do
// formulário. NÃO cria nada nos Correios.
router.post('/api/previa', (req, res) => {
  try {
    res.json(previa(req.body || {}, credCorreios()));
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// POST /emissao-correios/api/emitir — cria a pré-postagem (objeto REAL no
// contrato) e devolve código + etiquetas em PDF (base64). Envie
// `idPrePostagem` de uma emissão anterior pra reaproveitar em vez de criar outra.
router.post('/api/emitir', async (req, res) => {
  // TODO(time): registrar quem emitiu (auditoria) — ver observação no README do projeto original.
  try {
    const r = await emitir(req.body || {}, credCorreios());
    console.info('[etiqueta-correios] emitida', r.id, r.codigoObjeto, r.servico, r.pendente ? '(pendente)' : '', '- por', req.session.user.slug);
    res.json(r);
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// GET /emissao-correios/api/:id — status atual da pré-postagem
router.get('/api/:id', async (req, res) => {
  try {
    const p = await consultar(req.params.id, credCorreios());
    res.json({ id: p.id, codigoObjeto: p.codigoObjeto, servico: p.nomeServico, status: p.status, prazoPostagem: p.prazoPostagem });
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// DELETE /emissao-correios/api/:id — cancela (só antes de postar na agência)
router.delete('/api/:id', async (req, res) => {
  // TODO(time): registrar quem cancelou (auditoria).
  try {
    const r = await cancelar(req.params.id, credCorreios());
    console.info('[etiqueta-correios] cancelada', req.params.id, r.status, '- por', req.session.user.slug);
    res.json(r);
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// GET /emissao-correios/api/:id/pdf?layout=LINEAR_100_150|PADRAO — baixa/reimprime a etiqueta em PDF.
router.get('/api/:id/pdf', async (req, res) => {
  try {
    const layout = req.query.layout || 'LINEAR_100_150';
    if (!(layout in LAYOUTS)) throw new ErroEtiqueta('VALIDACAO', 'layout deve ser LINEAR_100_150 ou PADRAO');
    const pdf = await baixarEtiqueta(req.params.id, layout, credCorreios());
    const nome = `etiqueta-${layout === 'PADRAO' ? 'a4' : '10x15'}-${req.params.id}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}"`, 'Cache-Control': 'no-store' });
    res.send(Buffer.from(pdf));
  } catch (e) {
    respostaDeErro(res, e);
  }
});

module.exports = router;
