// Cotação de frete Correios (Correios API / CWS: Preço + Prazo) — portado
// quase literalmente de correios-cotacao-nextjs/src/lib/correios-cotacao/
// index.ts (era um módulo TypeScript puro, sem import nenhum do
// Next.js/React, então a conversão pra CommonJS foi só de sintaxe).
//
// Regras medidas na API real em produção (set/2026, contrato da Seubone):
// - Serviços do contrato: SEDEX 03220 e PAC 03298 (os códigos "Log+"
//   39888/39870 não são usados).
// - O preço é POR OBJETO: cada volume é um objeto. Volumes iguais = preço
//   de um × quantidade.
// - Peso cúbico: A × L × C ÷ 6000, mas só vale quando é grande (caixa 50³
//   com 1 kg → cobrada 20,8 kg; caixa 20³ com 300 g → cobrada 300 g).
//   Usamos o peso cobrado que a própria API devolve (psCobrado).
// - Valor declarado: adicional 019 no SEDEX e 064 no PAC (trocados dá erro
//   ERP-054). Custo ≈ 1% do que passa do seguro automático (R$ 25,63).
// - Valores vêm como texto com vírgula ("60,59"). O campo pcBase é fixo e
//   não serve para nada.

const URLS = {
  prod: 'https://api.correios.com.br',
  hom: 'https://apihom.correios.com.br',
};

const SERVICOS = {
  SEDEX: { codigo: '03220', adicionalValorDeclarado: '019' },
  PAC: { codigo: '03298', adicionalValorDeclarado: '064' },
};

/** Limites dos Correios por objeto (encomenda nacional) */
const LIMITES = { pesoMaxKg: 30, ladoMaxCm: 100, somaMaxCm: 200 };

class ErroCotacao extends Error {
  constructor(tipo, mensagem, campo, detalheCorreios) {
    super(mensagem);
    this.name = 'ErroCotacao';
    this.tipo = tipo; // 'VALIDACAO' | 'CREDENCIAL' | 'ROTA_NAO_ATENDIDA' | 'INDISPONIVEL'
    this.campo = campo;
    this.detalheCorreios = detalheCorreios;
  }
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));
/** "60,59" → 60.59 ; "1.234,56" → 1234.56 */
const numeroBr = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));

/** Valida e normaliza a entrada (aceita números como texto com vírgula). Lança ErroCotacao VALIDACAO. */
function validarEntrada(bruta) {
  const e = bruta || {};
  const cepOrigem = soDigitos(e.cepOrigem);
  const cepDestino = soDigitos(e.cepDestino);
  if (cepOrigem.length !== 8) throw new ErroCotacao('VALIDACAO', 'CEP de origem deve ter 8 dígitos', 'cepOrigem');
  if (cepDestino.length !== 8) throw new ErroCotacao('VALIDACAO', 'CEP de destino deve ter 8 dígitos', 'cepDestino');

  const declararValor = Boolean(e.declararValor);
  const valorMercadoria = e.valorMercadoria == null || e.valorMercadoria === '' ? 0 : numero(e.valorMercadoria);
  if (!Number.isFinite(valorMercadoria) || valorMercadoria < 0) throw new ErroCotacao('VALIDACAO', 'Valor da mercadoria inválido', 'valorMercadoria');
  if (declararValor && !(valorMercadoria > 0)) throw new ErroCotacao('VALIDACAO', 'Para declarar valor, informe o valor da mercadoria', 'valorMercadoria');

  const lista = Array.isArray(e.volumes) ? e.volumes : [];
  if (lista.length === 0) throw new ErroCotacao('VALIDACAO', 'Informe ao menos um volume', 'volumes');
  const volumes = lista.map((v, i) => {
    const vol = {
      quantidade: numero(v && v.quantidade),
      alturaCm: numero(v && v.alturaCm),
      larguraCm: numero(v && v.larguraCm),
      comprimentoCm: numero(v && v.comprimentoCm),
      pesoUnitarioKg: numero(v && v.pesoUnitarioKg),
    };
    const pre = lista.length > 1 ? `Volume ${i + 1}: ` : '';
    const msg = (texto) => (pre ? pre + texto : texto.charAt(0).toUpperCase() + texto.slice(1));
    if (!Number.isInteger(vol.quantidade) || vol.quantidade < 1) throw new ErroCotacao('VALIDACAO', msg('quantidade deve ser um número inteiro ≥ 1'), `volumes.${i}.quantidade`);
    for (const [k, rotulo] of [['alturaCm', 'altura'], ['larguraCm', 'largura'], ['comprimentoCm', 'comprimento']]) {
      if (!(vol[k] > 0)) throw new ErroCotacao('VALIDACAO', msg(`informe a ${rotulo} em cm`), `volumes.${i}.${k}`);
      if (vol[k] > LIMITES.ladoMaxCm) throw new ErroCotacao('VALIDACAO', msg(`${rotulo} acima de ${LIMITES.ladoMaxCm} cm (limite dos Correios)`), `volumes.${i}.${k}`);
    }
    if (vol.alturaCm + vol.larguraCm + vol.comprimentoCm > LIMITES.somaMaxCm) {
      throw new ErroCotacao('VALIDACAO', msg(`soma das medidas acima de ${LIMITES.somaMaxCm} cm (limite dos Correios)`), `volumes.${i}.comprimentoCm`);
    }
    if (!(vol.pesoUnitarioKg > 0)) throw new ErroCotacao('VALIDACAO', msg('informe o peso em kg'), `volumes.${i}.pesoUnitarioKg`);
    if (vol.pesoUnitarioKg > LIMITES.pesoMaxKg) throw new ErroCotacao('VALIDACAO', msg(`peso acima de ${LIMITES.pesoMaxKg} kg por volume (limite dos Correios)`), `volumes.${i}.pesoUnitarioKg`);
    return vol;
  });

  const pedidos = Array.isArray(e.servicos) ? e.servicos.map((s) => String(s).toUpperCase()) : Object.keys(SERVICOS);
  const servicos = pedidos.filter((s) => s in SERVICOS);
  if (servicos.length === 0) throw new ErroCotacao('VALIDACAO', 'Escolha SEDEX e/ou PAC', 'servicos');

  return { cepOrigem, cepDestino, volumes, valorMercadoria, declararValor, servicos };
}

/** Avisos que não bloqueiam a cotação. */
function avisosEntrada(e) {
  const avisos = [];
  e.volumes.forEach((v, i) => {
    const [a, b] = [v.comprimentoCm, v.larguraCm].sort((x, y) => y - x);
    if (a < 16 || b < 11 || v.alturaCm < 2) avisos.push(`Volume ${i + 1}: menor que 16 × 11 × 2 cm, o mínimo dos Correios para pacote. Na agência ele pode ser recusado ou medido de novo.`);
  });
  if (e.volumes.length > 0 && e.declararValor && e.valorMercadoria > 0) {
    const total = e.volumes.reduce((s, v) => s + v.quantidade, 0);
    if (total > 1) avisos.push(`Valor declarado dividido igualmente entre os ${total} volumes.`);
  }
  return avisos;
}

// ─── Token (cache no processo) ───────────────────────────────────────────────
// O token vale 24h e a API devolve o MESMO token enquanto ele vale; pedir token demais gera HTTP 429.

let cacheToken = null;
let loginEmAndamento = null;

/** Só para testes */
function limparCacheToken() { cacheToken = null; loginEmAndamento = null; }

function dataBrasilia(s) {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(' ', 'T')}-03:00`);
}

async function requisitar(url, init, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  } catch (e) {
    throw new ErroCotacao('INDISPONIVEL', 'Os Correios não responderam. Tente novamente em instantes.', undefined, e.message);
  }
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: res.status, json };
}

const mensagens = (j) => (Array.isArray(j && j.msgs) ? j.msgs.join(' | ') : typeof j === 'string' ? j.slice(0, 300) : (j && (j.message ?? j.mensagem)) ?? '');

async function obterToken(base, cred, timeoutMs) {
  const chave = `${base}|${cred.usuario}|${cred.cartao}`;
  if (cacheToken && cacheToken.chave === chave && Date.now() < cacheToken.expiraEm - 60000) return cacheToken.valor;
  loginEmAndamento ??= (async () => {
    const corpo = { numero: cred.cartao };
    if (cred.contrato) corpo.contrato = cred.contrato;
    if (cred.dr != null && Number.isFinite(cred.dr)) corpo.dr = cred.dr;
    const r = await requisitar(`${base}/token/v1/autentica/cartaopostagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${cred.usuario}:${cred.codigoAcesso}`).toString('base64'),
      },
      body: JSON.stringify(corpo),
    }, timeoutMs);
    if (r.status === 429) throw new ErroCotacao('INDISPONIVEL', 'Muitas consultas aos Correios agora. Aguarde um minuto e tente de novo.', undefined, 'token HTTP 429');
    if (r.status >= 500) throw new ErroCotacao('INDISPONIVEL', 'Os Correios estão fora do ar no momento.', undefined, `token HTTP ${r.status}`);
    if ((r.status !== 200 && r.status !== 201) || !(r.json && r.json.token)) {
      throw new ErroCotacao('CREDENCIAL', 'Acesso aos Correios recusado', undefined, `token HTTP ${r.status} ${mensagens(r.json)}`);
    }
    const expira = dataBrasilia(r.json.expiraEm);
    cacheToken = { valor: r.json.token, expiraEm: Number.isFinite(expira) ? expira : Date.now() + 23 * 3600e3, chave };
    return r.json.token;
  })().finally(() => { loginEmAndamento = null; });
  return loginEmAndamento;
}

// ─── Cotação ─────────────────────────────────────────────────────────────────

/**
 * Cota SEDEX e PAC nos Correios. Aceita a entrada crua do formulário (valida e normaliza).
 * Um serviço que não atende a rota volta com `erro` (o outro continua); se nenhum atender, lança ROTA_NAO_ATENDIDA.
 */
async function cotarFrete(entradaBruta, cred) {
  const entrada = validarEntrada(entradaBruta);
  if (!cred.usuario || !cred.codigoAcesso || !/^\d{10}$/.test(cred.cartao ?? '')) {
    throw new ErroCotacao('CREDENCIAL', 'Configure CORREIOS_USUARIO, CORREIOS_CODIGO_ACESSO e CORREIOS_CARTAO no servidor');
  }
  const base = URLS[cred.ambiente || 'prod'];
  const timeoutMs = cred.timeoutMs || 20000;

  const get = async (caminho) => {
    const chamar = async () => requisitar(base + caminho, {
      headers: { Accept: 'application/json', 'Accept-Language': 'pt-BR', Authorization: `Bearer ${await obterToken(base, cred, timeoutMs)}` },
    }, timeoutMs);
    let r = await chamar();
    if (r.status === 401 || (r.status === 403 && /GTW-00\d|token/i.test(mensagens(r.json)))) {
      cacheToken = null; // token vencido ou trocado: renova uma vez
      r = await chamar();
    }
    if (r.status === 401 || r.status === 403) throw new ErroCotacao('CREDENCIAL', 'Acesso aos Correios recusado', undefined, `HTTP ${r.status} ${mensagens(r.json)}`);
    if (r.status === 429) throw new ErroCotacao('INDISPONIVEL', 'Muitas consultas aos Correios agora. Aguarde um minuto e tente de novo.', undefined, 'HTTP 429');
    if (r.status >= 500) throw new ErroCotacao('INDISPONIVEL', 'Os Correios estão fora do ar no momento.', undefined, `HTTP ${r.status} ${mensagens(r.json)}`);
    return r;
  };

  const totalVolumes = entrada.volumes.reduce((s, v) => s + v.quantidade, 0);
  // Valor declarado é por objeto: divide o valor da mercadoria igualmente entre os volumes
  const vdPorVolume = entrada.declararValor ? Math.round((entrada.valorMercadoria / totalVolumes) * 100) / 100 : 0;

  const servicos = await Promise.all(entrada.servicos.map(async (nome) => {
    const { codigo, adicionalValorDeclarado } = SERVICOS[nome];
    const vazio = {
      servico: nome, codigo, total: null, prazoDias: null, entregaAte: null, entregaSabado: false,
      valorDeclarado: 0, volumes: [], erro: null, maisBarato: false, maisRapido: false,
    };
    const falha = (r) => {
      const detalhe = mensagens(r.json) || `HTTP ${r.status}`;
      return { ...vazio, erro: /PRZ-008|indispon[ií]vel para o trecho|n[aã]o atend/i.test(detalhe) ? `${nome} não atende essa rota.` : `Os Correios não cotaram ${nome}: ${detalhe}` };
    };

    const prazo = await get(`/prazo/v1/nacional/${codigo}?cepOrigem=${entrada.cepOrigem}&cepDestino=${entrada.cepDestino}`);
    if (prazo.status !== 200) return falha(prazo);

    const linhas = [];
    let valorDeclarado = 0;
    for (const v of entrada.volumes) {
      const q = new URLSearchParams({
        cepOrigem: entrada.cepOrigem, cepDestino: entrada.cepDestino,
        psObjeto: String(Math.max(1, Math.round(v.pesoUnitarioKg * 1000))), tpObjeto: '2',
        comprimento: String(Math.ceil(v.comprimentoCm)), largura: String(Math.ceil(v.larguraCm)), altura: String(Math.ceil(v.alturaCm)),
      });
      if (vdPorVolume > 0) { q.set('vlDeclarado', vdPorVolume.toFixed(2)); q.append('servicosAdicionais', adicionalValorDeclarado); }
      const preco = await get(`/preco/v1/nacional/${codigo}?${q}`);
      if (preco.status !== 200) return falha(preco);
      const p = preco.json;
      const vd = (p.servicoAdicional || []).filter((a) => a.coServAdicional === adicionalValorDeclarado).reduce((s, a) => s + numeroBr(a.pcServicoAdicional), 0);
      valorDeclarado += vd * v.quantidade;
      linhas.push({
        quantidade: v.quantidade,
        valorUnitario: numeroBr(p.pcFinal),
        pesoCobradoKg: Math.round(Number(p.psCobrado ?? v.pesoUnitarioKg * 1000)) / 1000,
        cubico: p.inPesoCubico === 'S',
      });
    }
    const total = Math.round(linhas.reduce((s, l) => s + l.valorUnitario * l.quantidade, 0) * 100) / 100;
    const dataMax = dataBrasilia(prazo.json.dataMaxima);
    return {
      ...vazio,
      total,
      prazoDias: Number(prazo.json.prazoEntrega),
      entregaAte: Number.isFinite(dataMax) ? new Date(dataMax).toISOString() : null,
      entregaSabado: prazo.json.entregaSabado === 'S',
      valorDeclarado: Math.round(valorDeclarado * 100) / 100,
      volumes: linhas,
    };
  }));

  const ok = servicos.filter((s) => s.total != null);
  if (ok.length === 0) {
    throw new ErroCotacao('ROTA_NAO_ATENDIDA', 'Os Correios não atendem essa rota com SEDEX nem PAC. Confira os CEPs.', undefined, servicos.map((s) => s.erro).join(' | '));
  }
  if (ok.length > 1) {
    const menorPreco = Math.min(...ok.map((s) => s.total));
    const menorPrazo = Math.min(...ok.map((s) => s.prazoDias));
    for (const s of ok) { s.maisBarato = s.total === menorPreco; s.maisRapido = s.prazoDias === menorPrazo; }
  }

  return {
    servicos,
    totalVolumes,
    pesoRealKg: Math.round(entrada.volumes.reduce((s, v) => s + v.pesoUnitarioKg * v.quantidade, 0) * 1000) / 1000,
    cotadoEm: new Date().toISOString(),
    avisos: avisosEntrada(entrada),
  };
}

module.exports = { ErroCotacao, validarEntrada, avisosEntrada, cotarFrete, limparCacheToken, numeroBr, SERVICOS, LIMITES };
