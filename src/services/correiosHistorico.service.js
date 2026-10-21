// Histórico de emissões de etiqueta Correios: junta o que os Correios listam (pré-postagens do contrato dos últimos 120 dias, inclusive as feitas fora do
// hub) com o registro local das emissões do hub (quem emitiu e as emissões mais antigas que 120 dias).
const etiqueta = require('./correiosEtiqueta.service');
const emissoes = require('./correiosEmissoes.service');

const DIA = 86400000;
const diaBr = (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);

function linhaLocal(e) {
  return {
    id: e.id_prepostagem,
    codigoObjeto: e.codigo_objeto || null,
    servico: e.servico || e.codigo_servico,
    codigoServico: e.codigo_servico,
    status: e.status,
    criadoEm: new Date(e.emitido_em).toISOString(),
    criadoPor: null,
    emitidoPor: e.emitido_por_nome || e.emitido_por_slug || null,
    volume: e.volume || null,
    prazoPostagem: null,
    pedido: e.pedido || null,
    destinatario: e.destinatario || null,
    cidadeUf: e.cidade_uf || null,
    cep: e.cep || null,
    chaveNFe: e.chave_nfe || null,
    pesoG: e.peso_g,
    pesoAferidoG: null,
    medidas: e.medidas || null,
    observacao: e.observacao || null,
    canceladoPor: e.cancelado_por || null,
    podeReimprimir: false,
    podeCancelar: false,
    origem: 'hub',
    somenteLocal: true,
  };
}

/**
 * filtro: { de, ate (AAAA-MM-DD), status: [] }  ->  { itens, de, ate, limitadoA120Dias, aviso }
 * Se os Correios não responderem, devolve só o registro do hub, com "aviso". Erro de validação (datas) sobe como erro.
 */
async function montarHistorico(filtro, env) {
  const f = filtro || {};
  let correios = null, aviso = null;
  try {
    correios = await etiqueta.listarHistorico(f, env);
  } catch (e) {
    if (e && e.tipo === 'VALIDACAO') throw e;
    aviso = `Não consegui consultar os Correios agora (${e && e.message ? e.message : 'erro'}). Mostrando só o que foi emitido pelo hub.`;
  }

  const agora = new Date();
  const ate = f.ate || diaBr(agora);
  const de = f.de || diaBr(new Date(agora.getTime() - 30 * DIA));
  const locais = await emissoes.listar({ de, ate });
  const porId = new Map(locais.map((l) => [l.id_prepostagem, l]));

  const itens = (correios ? correios.itens : []).map((i) => {
    const l = porId.get(i.id);
    return { ...i, emitidoPor: l ? (l.emitido_por_nome || l.emitido_por_slug || null) : null, volume: l ? (l.volume || null) : null, origem: l ? 'hub' : 'correios' };
  });

  // Emissões do hub que os Correios não listaram: as mais antigas que a janela de 120 dias (eles não guardam) ou, se eles não responderam, todas.
  const limite = new Date(agora.getTime() - 120 * DIA);
  const status = new Set((f.status || []));
  const vistos = new Set(itens.map((i) => i.id));
  for (const l of locais) {
    if (vistos.has(l.id_prepostagem)) continue;
    if (correios && new Date(l.emitido_em) >= limite) continue;
    if (status.size && !status.has(l.status)) continue;
    itens.push(linhaLocal(l));
  }
  itens.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));

  return {
    itens,
    de: correios ? correios.de : de,
    ate: correios ? correios.ate : ate,
    // Com o registro do hub, períodos antigos também têm resposta (só das emissões feitas aqui)
    limitadoA120Dias: correios ? correios.limitadoA120Dias : false,
    aviso,
  };
}

module.exports = { montarHistorico };
