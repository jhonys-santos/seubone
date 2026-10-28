// Envio de anexos do Painel de Erros ao Google Drive (via Apps Script). O script salva os arquivos um por um (~6 s cada, mais em dias lentos do Google) e o hub
// desistia em 20 s: com 3 ou mais arquivos a chamada estourava, o hub dizia "falha" e os links nunca chegavam ao caso. Aqui cada arquivo vai numa chamada própria,
// várias ao mesmo tempo, com tempo limite maior: o tempo total passa a ser o de um arquivo só, e a falha de um não derruba os outros.
const { chamarAppsScript } = require('./appsScriptClient');
const env = require('../config/env');

const SIMULTANEAS = 4;
const TIMEOUT_POR_ARQUIVO_MS = 80000;   // abaixo do limite de ~100 s do Render

let enviarUm = async (acao, foto, idVenda) => chamarAppsScript(env.errosAppsScriptUrl, {
  method: 'POST', timeoutMs: TIMEOUT_POR_ARQUIVO_MS, body: { action: acao, fotos: [foto], ...(idVenda !== undefined ? { idVenda } : {}) },
});
/** Só para testes: troca a chamada ao Apps Script. */
function definirEnviarUm(fn) { enviarUm = fn; }

/**
 * Envia os arquivos (data URLs) e devolve { urls, falhas, erroExemplo } com as urls na MESMA ordem dos arquivos enviados.
 * acao: 'salvarFotos' (com idVenda) ou 'salvarFotoPreCaso'. Se NENHUM arquivo for salvo e o Apps Script respondeu erro (ok:false), lança esse erro.
 */
async function enviarFotos(acao, fotos, idVenda, { simultaneas = SIMULTANEAS } = {}) {
  const lista = Array.isArray(fotos) ? fotos : [];
  const resultados = new Array(lista.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < lista.length) {
      const i = proximo++;
      try {
        const r = await enviarUm(acao, lista[i], idVenda);
        resultados[i] = r && r.ok ? { urls: r.urls || [], falhas: Number(r.falhas) || 0, erro: r.erroExemplo || '' } : { urls: [], falhas: 1, erro: (r && r.error) || 'resposta inesperada do Drive' };
      } catch (e) {
        resultados[i] = { urls: [], falhas: 1, erro: String((e && e.message) || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneas, lista.length) }, trabalhador));

  const urls = resultados.flatMap((r) => r.urls);
  const falhas = resultados.reduce((s, r) => s + r.falhas, 0);
  const erroExemplo = (resultados.find((r) => r.erro) || {}).erro || '';
  if (!urls.length && falhas && lista.length && resultados.every((r) => r.falhas && !r.urls.length)) {
    // tudo falhou: devolve o motivo (a rota mostra "Não consegui salvar os arquivos (motivo)")
    return { urls: [], falhas, erroExemplo };
  }
  return { urls, falhas, erroExemplo };
}

module.exports = { enviarFotos, definirEnviarUm, SIMULTANEAS };
