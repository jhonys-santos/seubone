// Histórico de e-Minutas LATAM: lista do registro do hub e consulta de rastreio por AWB (a LATAM guarda o resumo na própria linha).
const env = require('../config/env');
const emissoes = require('./latamEmissoes.service');

let clienteRastreio = null;
/** Só para testes: troca o cliente de rastreio. */
function definirClienteRastreio(c) { clienteRastreio = c; }
function obterClienteRastreio() {
  if (clienteRastreio) return clienteRastreio;
  const { LatamRastreio } = require('./latamRastreio/cliente');
  clienteRastreio = new LatamRastreio({ usuario: env.latamCargoUsuario, senha: env.latamCargoSenha, ambiente: env.latamCargoAmbiente || 'prod' });
  return clienteRastreio;
}
const configurado = () => !!(env.latamCargoUsuario && env.latamCargoSenha);

const AWB = /^(957-?)?\d{8}$/;

function linha(e) {
  return {
    minuta: e.minuta,
    emitidoEm: new Date(e.emitido_em).toISOString(),
    emitidoPor: e.emitido_por_nome || e.emitido_por_slug || null,
    chaveNFe: e.chave_nfe || null,
    numeroNf: e.numero_nf || null,
    valorNf: e.valor_nf,
    destinatario: e.destinatario || null,
    cidadeUf: e.cidade_uf || null,
    cep: e.cep || null,
    servico: e.servico || null,
    entregaDomicilio: !!e.entrega_domicilio,
    destinoIata: e.destino_iata || null,
    volumes: e.volumes,
    pesoKg: e.peso_kg,
    aviso: e.aviso || null,
    situacao: e.situacao || null,
    entregueEm: e.entregue_em ? new Date(e.entregue_em).toISOString() : null,
    consultadoEm: e.consultado_em ? new Date(e.consultado_em).toISOString() : null,
  };
}

/** filtro: { de, ate (AAAA-MM-DD) } -> { itens } */
async function montarHistorico(filtro) {
  const diaBr = (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
  const agora = new Date();
  const ate = (filtro && filtro.ate) || diaBr(agora);
  const de = (filtro && filtro.de) || diaBr(new Date(agora.getTime() - 30 * 86400000));
  for (const d of [de, ate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z'))) { const e = new Error(`Data inválida: "${d}" (use AAAA-MM-DD)`); e.tipo = 'VALIDACAO'; throw e; }
  }
  if (de > ate) { const e = new Error('A data inicial é depois da final'); e.tipo = 'VALIDACAO'; throw e; }
  return { itens: (await emissoes.listar({ de, ate })).map(linha), de, ate };
}

/**
 * Rastreio de um AWB. Se o AWB é de uma emissão do hub, guarda a situação (e a data de entrega) no registro.
 * Devolve { awb, encontrado, situacao, previsaoEntrega, entregueEm, recebedor, localizacao, ocorrencias[] }.
 */
async function consultar(awb) {
  const limpo = String(awb || '').trim();
  if (!AWB.test(limpo.replace(/\s/g, ''))) { const e = new Error('AWB inválido (esperado 957-XXXXXXXX)'); e.tipo = 'VALIDACAO'; throw e; }
  if (!configurado() && !clienteRastreio) { const e = new Error('Integração com a LATAM sem configuração'); e.tipo = 'CREDENCIAL'; throw e; }
  let r;
  try {
    r = await obterClienteRastreio().rastrearPorAwb(limpo);
  } catch (err) {
    const e = new Error(err && err.tipo === 'CREDENCIAL' ? 'A integração com a LATAM está sem acesso no momento' : 'A LATAM não respondeu agora. Tente novamente em instantes.');
    e.tipo = err && err.tipo === 'CREDENCIAL' ? 'CREDENCIAL' : 'INDISPONIVEL'; e.detalhe = err && err.message; throw e;
  }
  const minuta = limpo.replace(/\s/g, '').replace(/^957-?/, '957-');
  if (!r) {
    // A LATAM só mostra a e-Minuta no rastreio depois que a carga é recebida no balcão: ainda sem registro não quer dizer que não existe.
    await emissoes.atualizarRastreio(minuta, { situacao: 'SEM_REGISTRO', entregueEm: null }).catch(() => {});
    return { awb: minuta, encontrado: false, situacao: 'SEM_REGISTRO', previsaoEntrega: null, entregueEm: null, recebedor: null, localizacao: null, ocorrencias: [] };
  }
  const { cidadeDoAeroporto } = require('./latamRastreio/localizacao');
  const out = {
    awb: r.awb || minuta, encontrado: true, situacao: r.situacao, previsaoEntrega: r.previsaoEntrega || null, entregueEm: r.entregueEm || null,
    recebedor: r.recebedor || null, localizacao: (r.localizacao && r.localizacao.texto) || null,
    ocorrencias: (r.ocorrencias || []).map((o) => ({
      codigo: o.codigo, descricao: o.descricao, dataHora: o.dataHora, aeroporto: o.aeroporto || null, municipio: cidadeDoAeroporto(o.aeroporto) || null,
      voo: o.voo || null, alerta: !!o.alerta, catalogado: !!o.catalogado,
    })),
  };
  await emissoes.atualizarRastreio(minuta, { situacao: out.situacao, entregueEm: out.entregueEm }).catch((e) => console.error('[latam-historico] não consegui guardar o rastreio:', e.message));
  return out;
}

module.exports = { montarHistorico, consultar, definirClienteRastreio, AWB };
