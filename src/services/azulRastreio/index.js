// Portado de azul-rastreio-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio Azul Logística (Integração Fácil).
const { AzulRastreio } = require('./cliente');
const { AzulErro } = require('./erros');
const { normalizarRastreio, dataBrasilia } = require('./normalizar');
const { CODIGOS_AZUL } = require('./codigos');

module.exports = { AzulRastreio, AzulErro, normalizarRastreio, dataBrasilia, CODIGOS_AZUL };
