// Rastreio dos Correios (SRO Rastro). Usa o mesmo cliente autenticado da emissão de etiquetas
// (correiosEtiqueta.service.js), então o token de 24 h é compartilhado.
const { CODIGO_OBJETO_VALIDO, normalizarCodigoObjeto, normalizarRastreio } = require('./normalizar');

/**
 * Rastreia um objeto pelo código (ex.: "OY602814415BR") usando um cliente de CorreiosApi (`chamar`).
 * Devolve null quando os Correios não têm registro (ainda não postado, código errado ou de outro contrato).
 */
async function rastrear(clienteApi, codigoObjeto, CorreiosErro) {
  const codigo = normalizarCodigoObjeto(codigoObjeto);
  if (!CODIGO_OBJETO_VALIDO.test(codigo)) {
    throw new CorreiosErro('DADOS_INVALIDOS', `Código de objeto inválido: "${codigoObjeto}" (esperado 2 letras + 9 dígitos + 2 letras, ex.: OY602814415BR)`);
  }
  const corpo = await clienteApi.chamar('GET', `/srorastro/v1/objetos?codigosObjetos=${codigo}&resultado=T`);
  const obj = (corpo?.objetos ?? []).find((o) => normalizarCodigoObjeto(o.codObjeto) === codigo);
  return obj ? normalizarRastreio(obj) : null; // sem eventos (SRO-020) também vira null
}

module.exports = { rastrear, CODIGO_OBJETO_VALIDO, normalizarCodigoObjeto };
