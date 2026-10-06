// Portado de latam-cargo-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio LATAM Cargo (eSales).
/** Aeroportos atendidos pela LATAM Cargo no Brasil (tabela do manual da e-Minuta). */
const AEROPORTOS = {
    AJU: 'Aracaju', AUX: 'Araguaína', BEL: 'Belém', BNU: 'Blumenau', BPS: 'Porto Seguro', BRA: 'Barreiras',
    BSB: 'Brasília', BVB: 'Boa Vista', CAC: 'Cascavel', CGB: 'Cuiabá', CGH: 'São Paulo (Congonhas)',
    CGR: 'Campo Grande', CLV: 'Caldas Novas', CNF: 'Belo Horizonte (Confins)', CWB: 'Curitiba', CXJ: 'Caxias do Sul',
    FLN: 'Florianópolis', FOR: 'Fortaleza', GIG: 'Rio de Janeiro (Galeão)', GRU: 'São Paulo (Guarulhos)', GYN: 'Goiânia',
    IGU: 'Foz do Iguaçu', IMP: 'Imperatriz', IOS: 'Ilhéus', JJG: 'Jaguaruna', JOI: 'Joinville', JPA: 'João Pessoa',
    JTC: 'Bauru', LDB: 'Londrina', MAB: 'Marabá', MAO: 'Manaus', MCP: 'Macapá', MCZ: 'Maceió', MGF: 'Maringá',
    NAT: 'Natal', NVT: 'Navegantes', PLU: 'Belo Horizonte (Pampulha)', PMW: 'Palmas', POA: 'Porto Alegre',
    PVH: 'Porto Velho', QSB: 'São Bernardo do Campo', RAO: 'Ribeirão Preto', RBR: 'Rio Branco', REC: 'Recife',
    ROO: 'Rondonópolis', SDU: 'Rio de Janeiro (Santos Dumont)', SJK: 'São José dos Campos', SJP: 'São José do Rio Preto',
    SLZ: 'São Luís', SSA: 'Salvador', STM: 'Santarém', THE: 'Teresina', UDI: 'Uberlândia', VCP: 'Campinas (Viracopos)',
    VDC: 'Vitória da Conquista', VIX: 'Vitória', XAP: 'Chapecó',
};
const cidadeDoAeroporto = (iata) => (iata ? AEROPORTOS[iata.toUpperCase()] ?? null : null);
const rotulo = (iata) => (iata ? `${iata}${cidadeDoAeroporto(iata) ? ` (${cidadeDoAeroporto(iata)})` : ''}` : 'local não informado');
function dataCurta(iso) {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : iso;
}
/** Localização atual a partir do último evento (ocorrências já em ordem cronológica). */
function localizar(ocorrencias) {
    const o = ocorrencias.at(-1);
    if (!o)
        return null;
    const partida = o.aeroportoPartida ?? o.armazemOrigem;
    const chegada = o.aeroportoChegada ?? o.armazemDestino;
    const quando = dataCurta(o.dataHora);
    const voo = o.voo ? ` ${o.voo}` : '';
    let aeroporto;
    let etapa;
    let texto;
    switch (o.codigo) {
        case '11':
        case '2':
            aeroporto = partida ?? chegada;
            etapa = 'ORIGEM';
            texto = `Recebida pela LATAM em ${rotulo(aeroporto)}`;
            break;
        case '1':
            aeroporto = partida;
            etapa = 'ORIGEM';
            texto = `Alocada no voo${voo} de ${rotulo(partida)} para ${rotulo(chegada)}`;
            break;
        case '3':
            aeroporto = partida;
            etapa = 'EM_VOO';
            texto = `Embarcada no voo${voo} de ${rotulo(partida)} para ${rotulo(chegada)}`;
            break;
        case '7':
            aeroporto = chegada;
            etapa = 'DESTINO';
            texto = `Chegou em ${rotulo(chegada)}, aguardando desembarque`;
            break;
        case '6':
            aeroporto = chegada;
            etapa = 'DESTINO';
            texto = `Desembarcada em ${rotulo(chegada)}`;
            break;
        case '4':
            aeroporto = chegada ?? partida;
            etapa = 'DESTINO';
            texto = `Em rota de entrega / disponível para retirada em ${rotulo(aeroporto)}`;
            break;
        case '9':
            aeroporto = partida ?? chegada;
            etapa = 'ENTREGUE';
            texto = `Entregue em ${rotulo(aeroporto)}${o.recebedor?.nome ? ` para ${o.recebedor.nome}` : ''}`;
            break;
        default:
            aeroporto = chegada ?? partida;
            etapa = o.alerta ? 'PROBLEMA' : 'DESTINO';
            texto = `${o.descricao} — ${rotulo(aeroporto)}`;
    }
    return {
        etapa,
        aeroporto,
        cidade: cidadeDoAeroporto(aeroporto),
        voo: o.voo,
        trecho: partida || chegada ? { de: partida, para: chegada } : null,
        desde: o.dataHora,
        texto: `${texto} · ${quando}`,
    };
}
/**
 * Aeroporto LATAM usado quando a entrega é no domicílio do destinatário: o da capital/hub da UF
 * (regra da SeuBoné, em uso no hub desde 29/09/2026). Ex.: cliente em Piracicaba/SP → GRU.
 */
const AEROPORTO_POR_UF = {
    AC: 'RBR', AL: 'MCZ', AM: 'MAO', AP: 'MCP', BA: 'SSA', CE: 'FOR', DF: 'BSB', ES: 'VIX', GO: 'GYN',
    MA: 'SLZ', MG: 'CNF', MS: 'CGR', MT: 'CGB', PA: 'BEL', PB: 'JPA', PE: 'REC', PI: 'THE', PR: 'CWB',
    RJ: 'GIG', RN: 'NAT', RO: 'PVH', RR: 'BVB', RS: 'POA', SC: 'FLN', SE: 'AJU', SP: 'GRU', TO: 'PMW',
};
const aeroportoDaUf = (uf) => AEROPORTO_POR_UF[String(uf ?? '').toUpperCase()] ?? null;
/** Nome do terminal para "Retirada …": GRU → "Guarulhos", CGH → "Congonhas", NAT → "Natal". */
function nomeDoTerminal(iata) {
    const cidade = cidadeDoAeroporto(iata) ?? '';
    return cidade.match(/\(([^)]+)\)/)?.[1] ?? (cidade || String(iata ?? ''));
}

module.exports = { AEROPORTOS, cidadeDoAeroporto, localizar, AEROPORTO_POR_UF, aeroportoDaUf, nomeDoTerminal };
