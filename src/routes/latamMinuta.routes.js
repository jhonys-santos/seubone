const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const env = require('../config/env');
const {
  previa, emitir, verificarPorChaveNfe, ErroMinuta, SERVICOS_MANUAIS, NOMES_SERVICO, AEROPORTOS, AEROPORTO_POR_UF,
} = require('../services/latamMinuta.service');

const router = express.Router();

router.use(requireAuth, requirePainel('emissao-latam'));

router.get('/', (req, res) => {
  res.render('emissao-latam/index', {
    servicos: SERVICOS_MANUAIS.map((s) => ({ chave: s, nome: NOMES_SERVICO[s] })),
    aeroportos: Object.entries(AEROPORTOS)
      .map(([iata, cidade]) => ({ iata, cidade }))
      .sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR')),
    aeroportoPorUf: AEROPORTO_POR_UF,
  });
});

const STATUS = {
  VALIDACAO: 400,
  SERVICO: 400,
  CREDENCIAL: 502, // problema de configuração do servidor, não do usuário
  INDISPONIVEL: 503,
};

function respostaDeErro(res, e) {
  if (e instanceof ErroMinuta) {
    if (e.tipo !== 'VALIDACAO') console.error('[emissao-latam]', e.tipo, e.message, e.detalhes || '');
    const erro = e.tipo === 'CREDENCIAL' ? `${e.message}. Avise o time de tecnologia.` : e.message;
    return res.status(STATUS[e.tipo] || 500).json({ erro, tipo: e.tipo, detalhes: e.detalhes || [] });
  }
  console.error('[emissao-latam] erro inesperado', e);
  res.status(500).json({ erro: 'Erro inesperado. Tente novamente.', tipo: 'INDISPONIVEL' });
}

// POST /emissao-latam/api/previa — monta e valida o envio a partir do
// formulário, resolve o serviço (auto/manual). NÃO cria nada na LATAM.
router.post('/api/previa', (req, res) => {
  try {
    res.json(previa(req.body || {}, env));
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// POST /emissao-latam/api/emitir — cria a e-Minuta (objeto REAL rastreável,
// sem cancelamento possível). NUNCA repete sozinha em caso de falha.
router.post('/api/emitir', async (req, res) => {
  try {
    const r = await emitir(req.body || {}, env);
    console.info('[emissao-latam] emitida', r.minuta, r.aviso ? `(aviso: ${r.aviso})` : '', '- por', req.session.user.slug);
    res.json(r);
  } catch (e) {
    respostaDeErro(res, e);
  }
});

// GET /emissao-latam/api/verificar?chave=... — checa se já existe rastreio
// pra essa NF-e antes de reenviar depois de um erro INDISPONIVEL (não há
// como cancelar uma e-Minuta já criada, então isso é a rede de segurança).
router.get('/api/verificar', async (req, res) => {
  try {
    const r = await verificarPorChaveNfe(req.query.chave || '', env);
    res.json(r);
  } catch (e) {
    respostaDeErro(res, e);
  }
});

module.exports = router;
