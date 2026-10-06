// Portado de latam-cargo-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio LATAM Cargo (eSales).
const { CODIGOS_LATAM } = require('./codigos');
const { cidadeDoAeroporto, localizar } = require('./localizacao');
const { buscar, filho, filhos, numero, paraNumero, texto: textoXml } = require('./xml');
// A LATAM manda o literal "nul" em aeroportos/armazéns vazios (visto no stg em 25/09/2026)
const texto = (no, ...caminho) => {
    const t = textoXml(no, ...caminho);
    return t && /^nul(l)?$/i.test(t) ? null : t;
};
/** "39696570/ALYSON FELIPE" → { documento: '39696570', nome: 'ALYSON FELIPE' } */
function separarRecebedor(receiverName, receiverDocument) {
    if (!receiverName && !receiverDocument)
        return null;
    const m = receiverName?.match(/^\s*([\d.\-]{5,})\s*\/\s*(.+)$/);
    if (m)
        return { nome: m[2].trim(), documento: receiverDocument ?? m[1] };
    return { nome: receiverName, documento: receiverDocument };
}
const PREFIXO_LATAM = '957';
const semAcento = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
/** "4", " 04 ", "4.0" → "4". Texto não numérico vira maiúsculo sem acento. */
function normalizarCodigo(codigo) {
    const s = semAcento(String(codigo ?? '').trim().toUpperCase());
    return /^\d+(\.0+)?$/.test(s) ? String(parseInt(s, 10)) : s;
}
/** Chave da tabela: o código, ou "12:MOTIVO" para o código 12. */
function codigoTabela(codigo, motivo) {
    return codigo === '12' ? `12:${semAcento((motivo ?? '').trim().toUpperCase()).replace(/\s+/g, ' ')}` : codigo;
}
/**
 * Datas da LATAM vêm como "11-06-2016 18:13", "19-06-2023 00:51:01" (dia-mês-ano) ou ISO, sem fuso.
 * Devolve ISO com -03:00 (horário de Brasília). Obs.: a LATAM não documenta o fuso; eventos em
 * aeroportos de outro fuso (MAO, CGB…) podem estar no horário local.
 */
function dataLatam(valor) {
    if (!valor)
        return null;
    const s = valor.trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s))
        return s;
    let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        const [, d, mo, a, h = '00', mi = '00', se = '00'] = m;
        return m[4] ? `${a}-${mo}-${d}T${h}:${mi}:${se}-03:00` : `${a}-${mo}-${d}`;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        const [, a, mo, d, h = '00', mi = '00', se = '00'] = m;
        return m[4] ? `${a}-${mo}-${d}T${h}:${mi}:${se}-03:00` : `${a}-${mo}-${d}`;
    }
    return s;
}
/** "957-01234567", "95701234567", "01234567" → { prefixo: '957', numero: '01234567' } */
function separarAwb(awb, prefixoPadrao = PREFIXO_LATAM) {
    const s = String(awb).trim();
    const m = s.match(/^(\d{3,4})[-\s](\d{1,8})$/) ?? s.replace(/\D/g, '').match(/^(\d{3})(\d{8})$/);
    if (m)
        return { prefixo: m[1], numero: m[2] };
    return { prefixo: prefixoPadrao, numero: s.replace(/\D/g, '') };
}
function paraXml(no) {
    const attrs = Object.entries(no.atributos).map(([k, v]) => ` ${k}="${v}"`).join('');
    const interno = no.filhos.length ? no.filhos.map(paraXml).join('') : no.texto.trim();
    return `<${no.nome}${attrs}>${interno}</${no.nome}>`;
}
function peso(no) {
    const w = filho(no, 'weight');
    const n = paraNumero(w?.texto);
    if (n == null)
        return null;
    // Converte se vier em libras; o padrão é KG
    return /^LB/i.test(w?.atributos.unitWeightCode ?? '') ? Math.round(n * 0.453592 * 1000) / 1000 : n;
}
function normalizarOcorrencia(ev, tabela = CODIGOS_LATAM) {
    const codigo = normalizarCodigo(texto(ev, 'eventDescription'));
    const receiverName = texto(ev, 'receiverName');
    const motivo = codigo === '12' ? receiverName : null;
    const chaveTabela = codigoTabela(codigo, motivo);
    const info = tabela[chaveTabela];
    const dataHora = dataLatam(texto(ev, 'eventDate')) ?? '';
    const peca = filho(ev, 'CargoDocumentPiece');
    const voo = [texto(ev, 'carrierCode'), texto(ev, 'carrierNumber')].filter(Boolean).join('') || null;
    const docRecebedor = texto(ev, 'receiverDocument');
    return {
        chave: `${chaveTabela}|${dataHora}`,
        codigo,
        codigoTabela: chaveTabela,
        motivo,
        descricao: info?.descricao ?? motivo ?? (texto(ev, 'eventDescription') || codigo),
        dataHora,
        aeroporto: texto(ev, 'arrivalAirportIataCode') ?? texto(ev, 'departureAirportIataCode'),
        aeroportoPartida: texto(ev, 'departureAirportIataCode'),
        aeroportoChegada: texto(ev, 'arrivalAirportIataCode'),
        armazemOrigem: texto(ev, 'originWarehouse'),
        armazemDestino: texto(ev, 'destinationWarehouse'),
        voo,
        volumes: numero(peca, 'numPieces'),
        pesoKg: peso(peca) || null, // a LATAM manda 0.0 em eventos sem pesagem
        // Só na entrega o receiverName é quem recebeu (no 11 vem "AEROPORTO"; no 12 é o motivo)
        recebedor: info?.categoria === 'ENTREGUE' ? separarRecebedor(receiverName, docRecebedor) : null,
        categoria: info?.categoria ?? 'NAO CATALOGADO',
        alerta: info ? info.alerta : true, // código desconhecido sempre alerta
        catalogado: Boolean(info),
    };
}
function definirSituacao(ocs) {
    if (ocs.some(o => o.categoria === 'ENTREGUE'))
        return 'ENTREGUE';
    if (ocs.some(o => o.categoria === 'CANCELADO'))
        return 'CANCELADO';
    if (ocs.some(o => o.categoria === 'DEVOLVIDO'))
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
/** Converte um <CargoDocumentTrackingDetail> no formato do CRM. */
function normalizarRastreio(detalhe, tabela = CODIGOS_LATAM) {
    const id = filho(detalhe, 'CargoDocumentId');
    const prefixo = texto(id, 'prefix') ?? PREFIXO_LATAM;
    const num = texto(id, 'number') ?? '';
    // Deduplica por (código, data/hora) e ordena cronologicamente — o próprio manual mostra eventos repetidos
    const unicas = new Map();
    for (const ev of filhos(filho(detalhe, 'CargoDocumentTrackingEventList'), 'CargoDocumentTrackingEvent')) {
        const o = normalizarOcorrencia(ev, tabela);
        if (!unicas.has(o.chave))
            unicas.set(o.chave, o);
    }
    const ocorrencias = [...unicas.values()].sort((a, b) => Date.parse(a.dataHora) - Date.parse(b.dataHora));
    const entrega = ocorrencias.findLast(o => o.categoria === 'ENTREGUE') ?? null;
    const destino = texto(detalhe, 'destination') ?? ocorrencias.findLast(o => o.armazemDestino)?.armazemDestino ?? null;
    return {
        awb: num ? `${prefixo}-${num}` : '',
        awbPrefixo: prefixo,
        awbNumero: num,
        chaveCte: texto(detalhe, 'cteKey'),
        minuta: texto(detalhe, 'minutaNumber'),
        situacao: definirSituacao(ocorrencias),
        emitidoEm: dataLatam(texto(detalhe, 'createdDate')) ?? ocorrencias[0]?.dataHora ?? null,
        previsaoEntrega: null,
        entregueEm: entrega?.dataHora ?? null,
        previsaoVencida: false,
        recebedor: entrega?.recebedor ?? null,
        origem: texto(detalhe, 'origin') ?? ocorrencias.find(o => o.armazemOrigem)?.armazemOrigem ?? null,
        destino: { cidade: cidadeDoAeroporto(destino), unidade: destino },
        localizacao: localizar(ocorrencias),
        volumes: numero(detalhe, 'pieces') ?? ocorrencias.find(o => o.volumes)?.volumes ?? null,
        pesoKg: numero(detalhe, 'weight') ?? ocorrencias.find(o => o.pesoKg)?.pesoKg ?? null,
        ocorrencias,
        ultimaOcorrencia: ocorrencias.at(-1) ?? null,
        alertas: ocorrencias.filter(o => o.alerta),
        brutoXml: paraXml(detalhe),
    };
}
/**
 * Ocorrências que o CRM ainda não gravou. Passe as chaves já salvas no banco (igual a `Ocorrencia.chave`).
 */
function novasOcorrencias(rastreio, chavesJaGravadas) {
    const vistas = new Set(chavesJaGravadas);
    return rastreio.ocorrencias.filter(o => !vistas.has(o.chave));
}
// ─── Lista ───────────────────────────────────────────────────────────────────
function normalizarDocumentoLista(doc) {
    const id = filho(doc, 'CargoDocumentId');
    const prefixo = texto(id, 'prefix') ?? PREFIXO_LATAM;
    const num = texto(id, 'number') ?? '';
    const peca = filho(doc, 'CargoDocumentPiece');
    return {
        awb: `${prefixo}-${num}`,
        awbPrefixo: prefixo,
        awbNumero: num,
        origem: texto(doc, 'documentOrigin'),
        destino: texto(doc, 'documentDestination'),
        emitidoEm: dataLatam(texto(doc, 'issueDocumentDate')),
        volumes: numero(peca, 'numPieces'),
        pesoKg: peso(peca),
        companhia: { codigo: texto(doc, 'CargoDocumentCompany', 'code'), iata: texto(doc, 'CargoDocumentCompany', 'iataCode') },
        tipo: texto(doc, 'documentTypeNameBr'),
    };
}
// ─── Faturas ─────────────────────────────────────────────────────────────────
function normalizarFatura(f) {
    return {
        numero: texto(f, 'nrFatura') ?? '',
        situacao: texto(f, 'clSituacao'),
        tipo: texto(f, 'tipoFatura'),
        emitidaEm: dataLatam(texto(f, 'dtEmissao')),
        vencimento: dataLatam(texto(f, 'dtVencimento')),
        periodo: { inicio: dataLatam(texto(f, 'dtInicioPeriodo')), fim: dataLatam(texto(f, 'dtFimPeriodo')) },
        valor: numero(f, 'vlDocumento'),
        nossoNumero: texto(f, 'nossoNumero'),
        contaCorrente: texto(f, 'cdCtaCorrente'),
    };
}
function normalizarFaturaDetalhe(raiz) {
    const d = buscar(raiz, 'docCobrancaDetalhe');
    const c = filho(d, 'docCobCabecalho');
    return {
        cabecalho: {
            numero: texto(c, 'numeroFatura'),
            cnpjCliente: texto(c, 'cnpjCliente'),
            nomeCliente: texto(c, 'nomeCliente'),
            cnpjEmpresaAerea: texto(c, 'cnpjEmpresaAerea'),
            nomeEmpresaAerea: texto(c, 'nomeEmpresaAerea'),
            contaCorrente: texto(c, 'contaCorrente'),
            nossoNumero: texto(c, 'codigoNossoNumero'),
            tipoCobranca: texto(c, 'descTipoCobranca'),
            emitidaEm: dataLatam(texto(c, 'dataEmissao')),
            vencimento: dataLatam(texto(c, 'dataVencimento')),
            periodo: { inicio: dataLatam(texto(c, 'dataInicio')), fim: dataLatam(texto(c, 'dataFim')) },
            unidade: { id: texto(c, 'idUnidOperacional'), sigla: texto(c, 'siglaUnidOperacional') ?? texto(c, 'SiglaUnidOperacional') },
            valorTotal: numero(c, 'valorTotal'),
        },
        avisos: filhos(d, 'listAvisoDocCob').map(a => ({
            numeroAviso: texto(a, 'numeroAviso'),
            numeroFiscal: texto(a, 'numeroFiscal'),
            origemDestino: texto(a, 'baseOrigemDestino'),
            emitidoEm: dataLatam(texto(a, 'dataEmissao')),
            pesoKg: numero(a, 'peso'),
            tipoPagamento: texto(a, 'tipoPagamento'),
            valorFrete: numero(a, 'valorFrete'),
            valorOutrasTaxas: numero(a, 'valorOutrasTaxas'),
            valorSeguro: numero(a, 'valorSeguro'),
            valorTotal: numero(a, 'valorTotal'),
        })),
        documentos: filhos(d, 'listDetalheDocCob').map(x => ({
            numeroConhecimento: texto(x, 'numeroConhecimento'),
            serie: texto(x, 'serieConhecimento'),
            numeroFiscal: texto(x, 'numeroFiscal'),
            origemDestino: texto(x, 'baseOrigemDestino'),
            emitidoEm: dataLatam(texto(x, 'dataEmissao')),
            cancelado: /^(S|SIM|Y|TRUE|1)$/i.test(texto(x, 'cancelado') ?? ''),
            filialEmissora: texto(x, 'filialEmissaoDoc'),
            centroCusto: texto(x, 'descricaoCentroCusto'),
            pesoKg: numero(x, 'peso'),
            tipoPagamento: texto(x, 'tipoPagamento'),
            valorFrete: numero(x, 'valorFrete'),
            valorOutrasTaxas: numero(x, 'valorOutrasTaxas'),
            valorSeguro: numero(x, 'valorSeguro'),
            valorComissao: numero(x, 'valorComissao'),
            valorTotal: numero(x, 'valorTotal'),
        })),
    };
}

module.exports = { separarRecebedor, PREFIXO_LATAM, normalizarCodigo, codigoTabela, dataLatam, separarAwb, normalizarOcorrencia, normalizarRastreio, novasOcorrencias, normalizarDocumentoLista, normalizarFatura, normalizarFaturaDetalhe };
