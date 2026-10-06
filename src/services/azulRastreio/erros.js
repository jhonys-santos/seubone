// Portado de azul-rastreio-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio Azul Logística (Integração Fácil).
class AzulErro extends Error {
    tipo;
    status;
    constructor(tipo, mensagem, status = null) {
        super(mensagem);
        this.name = 'AzulErro';
        this.tipo = tipo;
        this.status = status;
    }
}

module.exports = { AzulErro };
