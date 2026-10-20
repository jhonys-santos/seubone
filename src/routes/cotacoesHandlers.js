// Handlers de cotação (Azul e Correios) compartilhados pelo painel interno (/cotacoes, com login) e pela página externa
// (/cotacao, sem login). As credenciais ficam só nas variáveis de ambiente do servidor e nunca chegam ao navegador.
const env = require('../config/env');
const {
  cotarFrete: cotarFreteAzul, avisosVolumes: avisosVolumesAzul,
  validarEntrada: validarEntradaAzul, ErroCotacao: ErroCotacaoAzul,
} = require('../services/azulCotacao.service');
const { cotarFrete: cotarFreteCorreios, ErroCotacao: ErroCotacaoCorreios } = require('../services/correiosCotacao.service');

const STATUS = {
  VALIDACAO: 400,
  ROTA_NAO_ATENDIDA: 422,
  CREDENCIAL: 502, // problema de configuração do servidor, não do usuário
  INDISPONIVEL: 503,
};

async function cotarAzul(req, res) {
  const corpo = req.body || {};
  try {
    const resultado = await cotarFreteAzul(corpo, {
      token: env.azulToken,
      email: env.azulEmail,
      senha: env.azulSenha,
    });
    res.json({ ...resultado, avisos: avisosVolumesAzul(validarEntradaAzul(corpo).volumes) });
  } catch (e) {
    if (e instanceof ErroCotacaoAzul) {
      if (e.tipo !== 'VALIDACAO') console.error('[cotacao-azul]', e.tipo, e.message, e.detalheAzul || '');
      const mensagem = e.tipo === 'CREDENCIAL'
        ? 'A integração com a Azul está sem acesso no momento. Avise o time de tecnologia.'
        : e.message;
      return res.status(STATUS[e.tipo]).json({ erro: mensagem, tipo: e.tipo, campo: e.campo });
    }
    console.error('[cotacao-azul] erro inesperado', e);
    res.status(500).json({ erro: 'Erro inesperado ao cotar. Tente novamente.', tipo: 'INDISPONIVEL' });
  }
}

async function cotarCorreios(req, res) {
  const corpo = req.body || {};
  try {
    const resultado = await cotarFreteCorreios(corpo, {
      usuario: env.correiosUsuario,
      codigoAcesso: env.correiosCodigoAcesso,
      cartao: env.correiosCartao,
      contrato: env.correiosContrato,
      dr: env.correiosDr ? Number(env.correiosDr) : undefined,
    });
    res.json(resultado);
  } catch (e) {
    if (e instanceof ErroCotacaoCorreios) {
      if (e.tipo !== 'VALIDACAO') console.error('[cotacao-correios]', e.tipo, e.message, e.detalheCorreios || '');
      const mensagem = e.tipo === 'CREDENCIAL'
        ? 'A integração com os Correios está sem acesso no momento. Avise o time de tecnologia.'
        : e.message;
      return res.status(STATUS[e.tipo]).json({ erro: mensagem, tipo: e.tipo, campo: e.campo });
    }
    console.error('[cotacao-correios] erro inesperado', e);
    res.status(500).json({ erro: 'Erro inesperado ao cotar. Tente novamente.', tipo: 'INDISPONIVEL' });
  }
}

module.exports = { cotarAzul, cotarCorreios };
