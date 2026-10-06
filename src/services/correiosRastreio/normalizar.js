// Portado de correios-rastreio-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio SRO Rastro dos Correios.
const { CODIGOS_CORREIOS } = require('./codigos');
const BAIXAS = new Set(['BDE', 'BDI', 'BDR']);
/** Baixa com tipo 00/01 = entregue ao destinatário (rastro concluído, segundo o guia dos Correios) */
const ehEntrega = (o) => BAIXAS.has(o.codigo) && (o.tipo === '00' || o.tipo === '01');
/** Baixa com tipo 23 = devolvido ao remetente (voltou para a Seu Boné) */
const ehDevolucaoConcluida = (o) => BAIXAS.has(o.codigo) && o.tipo === '23';
/** " bde " → "BDE"; 1 → "01" */
function normalizarCodigo(codigo) {
    return String(codigo ?? '').trim().toUpperCase();
}
function normalizarTipo(tipo) {
    const s = String(tipo ?? '').trim();
    return /^\d$/.test(s) ? `0${s}` : s;
}
/** Normaliza o código do objeto: " oy 602.814.415-br " → "OY602814415BR". */
function normalizarCodigoObjeto(codigo) {
    return String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** Formato do código de objeto dos Correios: 2 letras + 9 dígitos + 2 letras (ex.: OY602814415BR). */
const CODIGO_OBJETO_VALIDO = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
/** Os Correios mandam datas sem fuso, em horário de Brasília. Devolve ISO com -03:00. */
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
function local(u) {
    return { municipio: vazioParaNull(u?.endereco?.cidade), uf: vazioParaNull(u?.endereco?.uf) };
}
function normalizarOcorrencia(e, tabela = CODIGOS_CORREIOS) {
    const codigo = normalizarCodigo(e.codigo);
    const tipo = normalizarTipo(e.tipo);
    const info = tabela[`${codigo}|${tipo}`];
    const dataHora = dataBrasilia(e.dtHrCriado) ?? '';
    const onde = local(e.unidade);
    const destino = e.unidadeDestino ? local(e.unidadeDestino) : null;
    return {
        chave: `${codigo}|${tipo}|${dataHora}`,
        codigo,
        tipo,
        descricao: (e.descricao ?? '').trim() || info?.descricao || `${codigo} ${tipo}`,
        detalhe: (e.detalhe ?? '').trim(),
        descricaoTabela: info?.descricao ?? null,
        dataHora,
        unidade: vazioParaNull(e.unidade?.tipo),
        municipio: onde.municipio,
        uf: onde.uf,
        destino,
        categoria: info?.categoria ?? 'NAO_CATALOGADO',
        alerta: info ? info.alerta : true, // evento desconhecido sempre alerta
        catalogado: Boolean(info),
        acao: info?.acao ?? '',
    };
}
function definirSituacao(ocs) {
    if (ocs.some(ehEntrega))
        return 'ENTREGUE';
    if (ocs.some(ehDevolucaoConcluida))
        return 'DEVOLVIDO';
    // Qualquer ocorrência de alerta marca problema. O CRM pode rebaixar para EM_TRANSITO
    // quando alguém marcar o alerta como resolvido (a API não sabe disso).
    if (ocs.some(o => o.alerta))
        return 'COM_PROBLEMA';
    const ultimaCatalogada = [...ocs].reverse().find(o => o.catalogado);
    if (ultimaCatalogada?.categoria === 'AGUARDANDO_RETIRADA')
        return 'AGUARDANDO_RETIRADA';
    return 'EM_TRANSITO';
}
/**
 * Converte um objeto da resposta do SRO Rastro. Retorna `null` quando os Correios
 * não têm registro do código (mensagem SRO-020 — objeto ainda não postado ou código errado).
 */
function normalizarRastreio(bruto, tabela = CODIGOS_CORREIOS, agora = new Date()) {
    if (!bruto.eventos?.length)
        return null;
    // Deduplica por (codigo, tipo, data/hora) e ordena cronologicamente — a API manda do mais recente ao mais antigo
    const unicas = new Map();
    for (const e of bruto.eventos) {
        const n = normalizarOcorrencia(e, tabela);
        if (!unicas.has(n.chave))
            unicas.set(n.chave, n);
    }
    const ocorrencias = [...unicas.values()].sort((a, b) => Date.parse(a.dataHora) - Date.parse(b.dataHora));
    const situacao = definirSituacao(ocorrencias);
    const entrega = ocorrencias.find(ehEntrega);
    const postagem = ocorrencias.find(o => o.codigo === 'PO' || o.codigo === 'CO');
    const previsaoEntrega = dataBrasilia(bruto.dtPrevista);
    const finalizado = situacao === 'ENTREGUE' || situacao === 'DEVOLVIDO';
    return {
        codigo: bruto.codObjeto,
        servico: bruto.tipoPostal
            ? { sigla: bruto.tipoPostal.sigla, descricao: bruto.tipoPostal.descricao, categoria: bruto.tipoPostal.categoria }
            : null,
        situacao,
        postadoEm: postagem?.dataHora ?? ocorrencias[0]?.dataHora ?? null,
        previsaoEntrega,
        entregueEm: entrega?.dataHora ?? null,
        previsaoVencida: !finalizado && previsaoEntrega !== null && Date.parse(previsaoEntrega) < agora.getTime(),
        contrato: vazioParaNull(bruto.contrato),
        objeto: {
            pesoKg: bruto.peso ?? null,
            alturaCm: bruto.altura ?? null,
            larguraCm: bruto.largura ?? null,
            comprimentoCm: bruto.comprimento ?? null,
            formato: vazioParaNull(bruto.formato),
            valorDeclarado: bruto.valorDeclarado ?? null,
        },
        ocorrencias,
        ultimaOcorrencia: ocorrencias.at(-1) ?? null,
        alertas: ocorrencias.filter(o => o.alerta),
        bruto,
    };
}
/**
 * Ocorrências que o CRM ainda não gravou. Passe as chaves já salvas no banco
 * (coluna `codigo|tipo|ocorrida_em`, igual a `Ocorrencia.chave`).
 */
function novasOcorrencias(rastreio, chavesJaGravadas) {
    const vistas = new Set(chavesJaGravadas);
    return rastreio.ocorrencias.filter(o => !vistas.has(o.chave));
}
/**
 * Lê o CSV de classificação (Codigo;Tipo;Descricao;Categoria;Alerta;Acao) — o mesmo
 * ocorrencias-correios.csv que a equipe edita no Excel. Útil para mudar SIM/NAO sem deploy.
 */
function lerTabelaCsv(texto) {
    const tabela = {};
    const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    for (const linha of linhas.slice(1)) {
        const [codigo, tipo, descricao = '', categoria = '', alerta = '', acao = ''] = linha.split(';').map(c => c.trim());
        if (!codigo || !tipo)
            continue;
        tabela[`${normalizarCodigo(codigo)}|${normalizarTipo(tipo)}`] = {
            descricao,
            categoria,
            alerta: alerta.toUpperCase() === 'SIM',
            acao,
        };
    }
    return tabela;
}

module.exports = { normalizarCodigo, normalizarTipo, normalizarCodigoObjeto, CODIGO_OBJETO_VALIDO, dataBrasilia, normalizarOcorrencia, normalizarRastreio, novasOcorrencias, lerTabelaCsv };
