const env = require('../config/env');

/**
 * Wrapper único de chamadas ao Google Apps Script.
 * Nenhuma rota deve usar fetch() diretamente contra uma URL de Apps Script —
 * tudo passa por aqui, para que o segredo compartilhado seja sempre anexado
 * e para termos um único lugar para logar/tratar erros de conexão com o Google.
 *
 * Cache/deduplicação (opt-in via `cache: true`): cada chamada ao Apps Script
 * custa ~1-3s (às vezes picos de 20s+) de latência própria do Google, e boa
 * parte disso é chamada IDÊNTICA repetida — várias abas/pessoas com o mesmo
 * painel aberto, ou um clique de "atualizar" coincidindo com o polling
 * automático. Com `cache: true`, resultados de leitura ficam guardados por
 * CACHE_TTL_MS e chamadas concorrentes pra mesma URL reaproveitam a mesma
 * promise em andamento em vez de disparar N vezes a mesma leitura.
 *
 * Só pra leitura (GET, sem body) — nunca cacheia escrita. E qualquer escrita
 * bem-sucedida limpa o cache desse MESMO Apps Script (mesma URL base,
 * independente da action), pra nunca devolver dado velho num refresh feito
 * logo depois de salvar algo.
 *
 * `cache: true` é opt-in propositalmente: só marcamos como cacheável uma
 * leitura depois de confirmar que ela não é usada pra decidir uma permissão
 * bem na hora (ex: "esse item é seu?" antes de uma escrita) — nesses casos
 * deixamos sem cache, pra nunca autorizar algo com base em dado de alguns
 * segundos atrás.
 */

const CACHE_TTL_MS = 5000;
const cache = new Map(); // chave: URL completa -> { promise } | { resultado, quando }

function baseDoScript(urlBase) {
  try {
    const u = new URL(urlBase);
    return u.origin + u.pathname;
  } catch {
    return urlBase;
  }
}

function invalidarCacheDoScript(urlBase) {
  const base = baseDoScript(urlBase);
  for (const chave of cache.keys()) {
    if (chave.startsWith(base)) cache.delete(chave);
  }
}

async function chamarAppsScript(urlBase, { method = 'GET', params = {}, body = null, cache: cacheavel = false } = {}) {
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

  const ehEscrita = method !== 'GET' || !!body;
  if (ehEscrita) {
    invalidarCacheDoScript(urlBase);
  }

  const chaveCache = url.toString();
  if (!ehEscrita && cacheavel) {
    const existente = cache.get(chaveCache);
    if (existente) {
      if (existente.promise) return existente.promise;
      if (Date.now() - existente.quando < CACHE_TTL_MS) return existente.resultado;
    }
  }

  const init = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(
      env.appsScriptSharedSecret ? { ...body, segredo: env.appsScriptSharedSecret } : body
    );
  }

  const executar = async () => {
    const resp = await fetch(url, init);
    const texto = await resp.text();
    try {
      return JSON.parse(texto);
    } catch {
      // Alguns endpoints (ex: CSV publicado do Sheets) não devolvem JSON.
      return texto;
    }
  };

  if (!ehEscrita && cacheavel) {
    const promise = executar();
    cache.set(chaveCache, { promise });
    try {
      const resultado = await promise;
      cache.set(chaveCache, { resultado, quando: Date.now() });
      return resultado;
    } catch (err) {
      cache.delete(chaveCache); // nunca guarda falha em cache
      throw err;
    }
  }

  return executar();
}

module.exports = { chamarAppsScript };
