const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const env = require('../config/env');
const {
  previa, emitir, verificarPorChaveNfe, ErroMinuta, SERVICOS_MANUAIS, NOMES_SERVICO, AEROPORTOS, AEROPORTO_POR_UF,
} = require('../services/latamMinuta.service');
const emissoes = require('../services/latamEmissoes.service');
const historico = require('../services/latamHistorico.service');
const lulu = require('../services/latamLulu.service');

const router = express.Router();

router.use(requireAuth, requirePainel('emissao-latam'));

const aeroportosOrdenados = () => Object.entries(AEROPORTOS)
  .map(([iata, cidade]) => ({ iata, cidade }))
  .sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'));

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
    // Registro de quem emitiu (alimenta o Histórico). A prévia é só o cálculo local dos dados do envio: não chama a LATAM.
    await emissoes.registrarEmissao({ resultado: r, previa: previa(req.body || {}, env), usuario: req.session.user });
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

// ── Histórico de e-Minutas e consulta de rastreio ──
const STATUS_HISTORICO = { VALIDACAO: 400, CREDENCIAL: 502, INDISPONIVEL: 503 };
function erroHistorico(res, e) {
  if (e && STATUS_HISTORICO[e.tipo]) {
    if (e.tipo !== 'VALIDACAO') console.error('[latam-historico]', e.tipo, e.message, e.detalhe || '');
    return res.status(STATUS_HISTORICO[e.tipo]).json({ erro: e.message, tipo: e.tipo });
  }
  console.error('[latam-historico] erro inesperado', e);
  res.status(500).json({ erro: 'Erro inesperado. Tente novamente.', tipo: 'INDISPONIVEL' });
}

router.get('/historico', (req, res) => {
  res.render('emissao-latam/historico', { aeroportos: aeroportosOrdenados() });
});

// GET /emissao-latam/api/historico?de=AAAA-MM-DD&ate=AAAA-MM-DD — e-Minutas emitidas pelo hub no período.
router.get('/api/historico', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await historico.montarHistorico({ de: req.query.de || undefined, ate: req.query.ate || undefined }));
  } catch (e) {
    erroHistorico(res, e);
  }
});

// GET /emissao-latam/api/consulta?awb=957-XXXXXXXX — rastreio do AWB (e guarda a situação no registro).
router.get('/api/consulta', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await historico.consultar(req.query.awb));
  } catch (e) {
    erroHistorico(res, e);
  }
});

// POST /emissao-latam/api/puxar-lulu — lê os cards do Lulu e guarda as e-Minutas LATAM no histórico.
router.post('/api/puxar-lulu', async (req, res) => {
  try {
    res.json({ ok: true, ...(await lulu.puxar()) });
  } catch (e) {
    erroHistorico(res, e);
  }
});

// GET /emissao-latam/api/etiqueta/:minuta — dados da emissão para reimprimir a etiqueta interna.
router.get('/api/etiqueta/:minuta', async (req, res) => {
  try {
    if (!/^[0-9]{3,4}-?[0-9]{6,8}$/.test(req.params.minuta)) return res.status(400).json({ erro: 'e-Minuta inválida' });
    const r = await emissoes.obterPrevia(req.params.minuta);
    if (!r) return res.status(404).json({ erro: 'e-Minuta não encontrada no registro do hub' });
    res.set('Cache-Control', 'no-store');
    res.json(r);
  } catch (e) {
    erroHistorico(res, e);
  }
});

module.exports = router;
