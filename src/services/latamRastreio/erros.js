// Portado de latam-cargo-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio LATAM Cargo (eSales).
class LatamErro extends Error {
    tipo;
    status;
    /** Código do ServiceStatus da LATAM, quando houver (ex.: -58, -59) */
    codigoLatam;
    /** Erros de negócio detalhados (e-Minuta) */
    detalhes;
    constructor(tipo, mensagem, extra = {}) {
        super(mensagem);
        this.name = 'LatamErro';
        this.tipo = tipo;
        this.status = extra.status ?? null;
        this.codigoLatam = extra.codigoLatam ?? null;
        this.detalhes = extra.detalhes ?? [];
    }
}

module.exports = { LatamErro };
