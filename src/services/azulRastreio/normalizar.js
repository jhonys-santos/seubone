// Portado de azul-rastreio-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio Azul Logística (Integração Fácil).
const { CODIGOS_AZUL } = require('./codigos');
const ENTREGUE = new Set(['1', '24']);
const CANCELADO = new Set(['107', '601']);
const DEVOLVIDO = new Set(['25']);
/** "102", " 102 ", "102.0", "bkd" → "102" / "BKD" */
function normalizarCodigo(codigo) {
    return String(codigo ?? '').trim().toUpperCase().replace(/\.0+$/, '');
}
/** A Azul manda datas sem fuso, em horário de Brasília. Devolve ISO com -03:00. */
function dataBrasilia(valor) {
    if (!valor)
        return null;
    const s = valor.trim();
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s))
        return s; // já tem fuso
    const base = s.replace(' ', 'T').replace(/\.\d+$/, '');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(base) ? `${base.length === 16 ? base + ':00' : base}-03:00` : s;
}
const vazioParaNull = (v) => (v && v.trim() ? v.trim() : null);
function normalizarOcorrencia(o, tabela = CODIGOS_AZUL) {
    const codigo = normalizarCodigo(o.Codigo);
    const info = tabela[codigo];
    const dataHora = dataBrasilia(o.DataHora) ?? '';
    const descricaoAzul = (o.Descricao ?? '').trim();
    // Códigos numéricos: o texto atual da Azul é mais claro que o da planilha (ex.: 102 "CT-e emitido").
    // Siglas (BKD, ATM, UPDATE): a Azul manda em inglês ou genérico → usa a tradução da tabela.
    const usarAzul = /^\d+$/.test(codigo) && descricaoAzul && descricaoAzul.toUpperCase() !== codigo;
    return {
        chave: `${codigo}|${dataHora}`,
        codigo,
        descricao: usarAzul ? descricaoAzul : info?.descricao ?? descricaoAzul,
        descricaoAzul,
        descricaoTabela: info?.descricao ?? null,
        comentario: (o.Comentario ?? '').trim(),
        dataHora,
        unidade: vazioParaNull(o.Unidade),
        municipio: vazioParaNull(o.UnidadeMunicipio),
        uf: vazioParaNull(o.UnidadeUf),
        volumes: o.Volumes ?? null,
        categoria: info?.categoria ?? 'NAO CATALOGADO',
        alerta: info ? info.alerta : true, // código desconhecido sempre alerta
        catalogado: Boolean(info),
        fotos: {
            insucesso: vazioParaNull(o.UrlInsucesso),
            comprovante: vazioParaNull(o.UrlPOD),
            assinatura: vazioParaNull(o.UrlAssinatura),
        },
        latitude: vazioParaNull(o.Latitude),
        longitude: vazioParaNull(o.Longitude),
    };
}
function definirSituacao(ocs, entregueEm) {
    if (entregueEm || ocs.some(o => ENTREGUE.has(o.codigo)))
        return 'ENTREGUE';
    if (ocs.some(o => CANCELADO.has(o.codigo)))
        return 'CANCELADO';
    if (ocs.some(o => DEVOLVIDO.has(o.codigo)))
        return 'DEVOLVIDO';
    // Qualquer ocorrência de alerta marca problema. O CRM pode rebaixar para EM_TRANSITO
    // quando alguém marcar o alerta como resolvido (a API não sabe disso).
    if (ocs.some(o => o.alerta))
        return 'COM_PROBLEMA';
    const ultimaCatalogada = [...ocs].reverse().find(o => o.catalogado);
    if (ultimaCatalogada?.categoria === 'AGUARDANDO RETIRADA')
        return 'AGUARDANDO_RETIRADA';
    return 'EM_TRANSITO';
}
function normalizarRastreio(bruto, tabela = CODIGOS_AZUL, agora = new Date()) {
    // Deduplica por (código, data/hora) e ordena cronologicamente — a Azul repete e não garante ordem
    const unicas = new Map();
    for (const o of bruto.Ocorrencias ?? []) {
        const n = normalizarOcorrencia(o, tabela);
        if (!unicas.has(n.chave))
            unicas.set(n.chave, n);
    }
    const ocorrencias = [...unicas.values()].sort((a, b) => Date.parse(a.dataHora) - Date.parse(b.dataHora));
    const entregueEm = dataBrasilia(bruto.DataHoraEntrega);
    const previsaoEntrega = dataBrasilia(bruto.DataEntregaPrevisao);
    const situacao = definirSituacao(ocorrencias, entregueEm);
    const finalizado = situacao === 'ENTREGUE' || situacao === 'CANCELADO' || situacao === 'DEVOLVIDO';
    const awb = (bruto.Awb || bruto.NumeroOperacional || '').trim();
    return {
        awb,
        awbNumero: awb.replace(/^577-?/, ''),
        situacao,
        emitidoEm: dataBrasilia(bruto.DataHoraEmissao),
        previsaoEntrega,
        entregueEm,
        previsaoVencida: !finalizado && previsaoEntrega !== null && Date.parse(previsaoEntrega) < agora.getTime(),
        destino: { cidade: vazioParaNull(bruto.DestinoCidade), unidade: vazioParaNull(bruto.DestinoUnidade) },
        origem: { cidade: vazioParaNull(bruto.OrigemCidade), unidade: vazioParaNull(bruto.OrigemUnidade) },
        volumes: bruto.Volumes ?? null,
        pesoRealKg: bruto.PesoReal ?? null,
        recebedor: vazioParaNull(bruto.ResponsavelRecebimentoNome)
            ? {
                nome: vazioParaNull(bruto.ResponsavelRecebimentoNome),
                documento: vazioParaNull(bruto.ResponsavelRecebimentoDocumentoIdentidade),
                cargo: vazioParaNull(bruto.ResponsavelRecebimentoCargo),
            }
            : null,
        fotoEntrega: vazioParaNull(bruto.DoorDelivery),
        ocorrencias,
        ultimaOcorrencia: ocorrencias.at(-1) ?? null,
        alertas: ocorrencias.filter(o => o.alerta),
        bruto,
    };
}
/**
 * Ocorrências que o CRM ainda não gravou. Passe as chaves já salvas no banco
 * (coluna `codigo|ocorrida_em`, igual a `Ocorrencia.chave`).
 */
function novasOcorrencias(rastreio, chavesJaGravadas) {
    const vistas = new Set(chavesJaGravadas);
    return rastreio.ocorrencias.filter(o => !vistas.has(o.chave));
}

module.exports = { normalizarCodigo, dataBrasilia, normalizarOcorrencia, normalizarRastreio, novasOcorrencias };
