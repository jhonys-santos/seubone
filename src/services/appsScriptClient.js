const env = require('../config/env');

/**
 * Wrapper único de chamadas ao Google Apps Script.
 * Nenhuma rota deve usar fetch() diretamente contra uma URL de Apps Script —
 * tudo passa por aqui, para que o segredo compartilhado seja sempre anexado
 * e para termos um único lugar para logar/tratar erros de conexão com o Google.
 */

async function chamarAppsScript(urlBase, { method = 'GET', params = {}, body = null } = {}) {
  if (!urlBase) {
    throw new Error('URL do Apps Script não configurada no .env.');
  }

  const url = new URL(urlBase);
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, valor);
  });
  if (env.appsScriptSharedSecret) {
    url.searchParams.set('segredo', env.appsScriptSharedSecret);
  }

  const init = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(
      env.appsScriptSharedSecret ? { ...body, segredo: env.appsScriptSharedSecret } : body
    );
  }

  const resp = await fetch(url, init);
  const texto = await resp.text();

  try {
    return JSON.parse(texto);
  } catch {
    // Alguns endpoints (ex: CSV publicado do Sheets) não devolvem JSON.
    return texto;
  }
}

module.exports = { chamarAppsScript };
