// Portado de latam-cargo-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio LATAM Cargo (eSales).
// Leitor e montador de XML mínimos, suficientes para os envelopes SOAP da LATAM (sem dependências).
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#')
            return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTIDADES[e] ?? m;
    });
}
const semPrefixo = (nome) => nome.slice(nome.indexOf(':') + 1);
function lerXml(xml) {
    const raiz = { nome: '#documento', atributos: {}, filhos: [], texto: '' };
    const pilha = [raiz];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    for (const m of xml.matchAll(re)) {
        const topo = pilha.at(-1);
        if (m[1] !== undefined) {
            topo.texto += m[1];
            continue;
        }
        if (m[3]) {
            const nome = semPrefixo(m[3]);
            if (m[2]) {
                // Fecha até a tag correspondente (tolera XML levemente malformado)
                const i = pilha.findLastIndex(n => n.nome === nome);
                if (i > 0)
                    pilha.length = i;
                continue;
            }
            const atributos = {};
            for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                atributos[semPrefixo(a[1])] = decodificar(a[2] ?? a[3] ?? '');
            }
            const no = { nome, atributos, filhos: [], texto: '' };
            topo.filhos.push(no);
            if (!m[5])
                pilha.push(no);
            continue;
        }
        if (m[6])
            topo.texto += decodificar(m[6]);
    }
    return raiz;
}
/** Desce pelo caminho pegando o primeiro filho com cada nome. */
function filho(no, ...caminho) {
    let atual = no;
    for (const nome of caminho)
        atual = atual?.filhos.find(f => f.nome === nome);
    return atual;
}
function filhos(no, nome) {
    return no?.filhos.filter(f => f.nome === nome) ?? [];
}
/** Primeiro nó com esse nome em qualquer profundidade. */
function buscar(no, nome) {
    if (!no)
        return undefined;
    for (const f of no.filhos) {
        if (f.nome === nome)
            return f;
        const achado = buscar(f, nome);
        if (achado)
            return achado;
    }
    return undefined;
}
/** Texto (sem espaços nas pontas) do nó no caminho; null se não existir ou estiver vazio. */
function texto(no, ...caminho) {
    const t = filho(no, ...caminho)?.texto.trim();
    return t ? t : null;
}
function numero(no, ...caminho) {
    return paraNumero(texto(no, ...caminho));
}
/** "1234.56", "1.234,56", "1234,56" → 1234.56 */
function paraNumero(v) {
    if (v == null || v.trim() === '')
        return null;
    let s = v.trim();
    if (s.includes(','))
        s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
// ─── Montagem ────────────────────────────────────────────────────────────────
const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * Monta um elemento. Valor null/undefined/'' → elemento omitido (a LATAM rejeita tags vazias em campos numéricos).
 * `conteudo` pode ser XML já montado (array de filhos) ou um valor simples (escapado).
 */
function el(nome, conteudo, atributos) {
    const attrs = Object.entries(atributos ?? {})
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => ` ${k}="${escapar(String(v))}"`)
        .join('');
    if (Array.isArray(conteudo)) {
        const interno = conteudo.filter(Boolean).join('');
        return interno ? `<${nome}${attrs}>${interno}</${nome}>` : '';
    }
    if (conteudo == null || conteudo === '')
        return '';
    return `<${nome}${attrs}>${escapar(String(conteudo))}</${nome}>`;
}
function envelope(namespaces, corpo) {
    const ns = Object.entries(namespaces).map(([p, u]) => ` xmlns:${p}="${u}"`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${ns}>` +
        `<soapenv:Header/><soapenv:Body>${corpo}</soapenv:Body></soapenv:Envelope>`;
}

module.exports = { lerXml, filho, filhos, buscar, texto, numero, paraNumero, escapar, el, envelope };
