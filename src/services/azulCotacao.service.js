// Cotação de frete Azul Logística (API "Integração Fácil") — portado quase
// literalmente de azul-cotacao-nextjs/src/lib/azul-cotacao/index.ts (era um
// módulo TypeScript puro, sem import nenhum do Next.js/React, então a
// conversão pra CommonJS foi só de sintaxe).
//
// Regras descobertas testando a API em produção (set/2026) — a documentação
// da Azul não diz:
// - O preço depende só de `Itens`. Os campos gerais PesoReal/PesoCubado/Volume
//   são ignorados.
// - Em cada item, `Peso` é o peso TOTAL da linha (não por volume).
// - Cubagem: A × L × C (cm) × quantidade ÷ 6000, arredondada para cima ao kg inteiro.
// - `PesoTaxado` devolvido pela Azul é inconsistente — calculamos o nosso.
// - `AdValorem` vem repetido dentro de `Taxas`: total = frete + soma(Taxas).
// - Retirada no aeroporto não exige unidade de destino; mesmo preço, prazo menor.

const URLS = {
  prod: 'https://ediapi.onlineapp.com.br/toolkit',
  hmg: 'https://hmg.onlineapp.com.br/EDIv2_API_INTEGRACAO_Toolkit',
};

const FATOR_CUBAGEM = 6000;

class ErroCotacao extends Error {
  constructor(tipo, mensagem, campo, detalheAzul) {
    super(mensagem);
    this.name = 'ErroCotacao';
    this.tipo = tipo; // 'VALIDACAO' | 'CREDENCIAL' | 'ROTA_NAO_ATENDIDA' | 'INDISPONIVEL'
    this.campo = campo;
    this.detalheAzul = detalheAzul;
  }
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));
/** "60,59" → 60.59 ; "1.234,56" → 1234.56 ; "1.500" → 1500 (só milhar, sem vírgula) */
const numeroBr = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));

/** Valida e normaliza a entrada (aceita números como texto com vírgula). Lança ErroCotacao VALIDACAO. */
function validarEntrada(bruta) {
  const e = bruta || {};
  const cepOrigem = soDigitos(e.cepOrigem);
  const cepDestino = soDigitos(e.cepDestino);
  if (cepOrigem.length !== 8) throw new ErroCotacao('VALIDACAO', 'CEP de origem deve ter 8 dígitos', 'cepOrigem');
  if (cepDestino.length !== 8) throw new ErroCotacao('VALIDACAO', 'CEP de destino deve ter 8 dígitos', 'cepDestino');

  // numeroBr (não numero): valorMercadoria é o único campo onde o usuário
  // digita valores grandes com separador de milhar ("1.500") — mesmo bug
  // encontrado e corrigido no correiosCotacao.service.js.
  const valorMercadoria = numeroBr(e.valorMercadoria);
  if (!(valorMercadoria > 0)) throw new ErroCotacao('VALIDACAO', 'Informe o valor da mercadoria', 'valorMercadoria');

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
    }
    if (!(vol.pesoUnitarioKg > 0)) throw new ErroCotacao('VALIDACAO', msg('informe o peso em kg'), `volumes.${i}.pesoUnitarioKg`);
    return vol;
  });

  const tipoEntrega = String(e.tipoEntrega ?? 'DOMICILIO').toUpperCase() === 'AEROPORTO' ? 'AEROPORTO' : 'DOMICILIO';
  return { cepOrigem, cepDestino, valorMercadoria, volumes, tipoEntrega, coleta: Boolean(e.coleta) };
}

function calcularPesos(volumes) {
  const arred = (n) => Math.round(n * 100) / 100;
  const pesoRealKg = arred(volumes.reduce((s, v) => s + v.pesoUnitarioKg * v.quantidade, 0));
  const pesoCubadoKg = arred(volumes.reduce((s, v) => s + (v.alturaCm * v.larguraCm * v.comprimentoCm * v.quantidade) / FATOR_CUBAGEM, 0));
  return {
    pesoRealKg,
    pesoCubadoKg,
    pesoTaxadoKg: Math.ceil(Math.max(pesoRealKg, pesoCubadoKg) - 1e-9),
    totalVolumes: volumes.reduce((s, v) => s + v.quantidade, 0),
  };
}

/** Aviso (não bloqueia): a Azul orienta soma A+L+C ≥ 45 cm, mas aceita menor. */
function avisosVolumes(volumes) {
  return volumes
    .map((v, i) => (v.alturaCm + v.larguraCm + v.comprimentoCm < 45 ? `Volume ${i + 1}: soma das medidas abaixo de 45 cm (a Azul pode ajustar na coleta)` : null))
    .filter((x) => x !== null);
}

// Token obtido por login fica em cache no processo (a Azul documenta 8h; renovamos a cada 7h30).
let tokenDoLogin = null;
const VALIDADE_LOGIN_MS = 7.5 * 3600 * 1000;

async function postJson(url, corpo, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    throw new ErroCotacao('INDISPONIVEL', `Azul não respondeu: ${e.message}`);
  }
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* não-JSON */ }
  return { status: res.status, json };
}

async function login(base, cred, timeoutMs) {
  const r = await postJson(`${base}/api/Autenticacao/AutenticarUsuario`, { Email: cred.email, Senha: cred.senha }, timeoutMs);
  if (r.status !== 200 || (r.json && r.json.HasErrors) || !(r.json && r.json.Value)) {
    throw new ErroCotacao('CREDENCIAL', `Login recusado pela Azul: ${(r.json && r.json.ErrorText) ?? `HTTP ${r.status}`}`);
  }
  tokenDoLogin = { valor: r.json.Value, em: Date.now() };
  return r.json.Value;
}

/**
 * Cota o frete na Azul. Aceita a entrada crua do formulário (valida e normaliza).
 * Credenciais: token (AZUL_TOKEN) e/ou email+senha. Com os dois, usa o token e cai para login se ele for recusado.
 */
async function cotarFrete(entradaBruta, cred) {
  const entrada = validarEntrada(entradaBruta);
  const base = URLS[cred.ambiente || 'prod'];
  const timeoutMs = cred.timeoutMs || 20000;
  const podeLogar = Boolean(cred.email && cred.senha);
  if (!cred.token && !podeLogar) throw new ErroCotacao('CREDENCIAL', 'Configure AZUL_TOKEN (ou AZUL_EMAIL e AZUL_SENHA) no servidor');

  const pesos = calcularPesos(entrada.volumes);
  const corpo = (Token) => ({
    Token,
    BaseOrigem: '', CEPOrigem: entrada.cepOrigem,
    BaseDestino: '', CEPDestino: entrada.cepDestino,
    // Ignorados pela Azul no cálculo, mas enviados coerentes:
    PesoCubado: pesos.pesoCubadoKg, PesoReal: pesos.pesoRealKg, Volume: pesos.totalVolumes,
    ValorTotal: entrada.valorMercadoria,
    Pedido: '', SiglaServico: '',
    TaxaColeta: entrada.coleta, Coleta: entrada.coleta,
    TipoEntrega: entrada.tipoEntrega,
    // Peso da linha = TOTAL (peso unitário × quantidade)
    Itens: entrada.volumes.map((v) => ({
      Volume: v.quantidade,
      Peso: Math.round(v.pesoUnitarioKg * v.quantidade * 1000) / 1000,
      Altura: v.alturaCm, Largura: v.larguraCm, Comprimento: v.comprimentoCm,
    })),
  });

  let token = cred.token || (tokenDoLogin && Date.now() - tokenDoLogin.em < VALIDADE_LOGIN_MS ? tokenDoLogin.valor : null);
  if (!token) token = await login(base, cred, timeoutMs);

  let r = await postJson(`${base}/api/Cotacao/Enviar`, corpo(token), timeoutMs);
  if (r.status === 401) {
    if (!podeLogar) throw new ErroCotacao('CREDENCIAL', 'Token recusado pela Azul. Gere um novo e atualize AZUL_TOKEN.');
    r = await postJson(`${base}/api/Cotacao/Enviar`, corpo(await login(base, cred, timeoutMs)), timeoutMs);
  }

  if (r.status >= 500) throw new ErroCotacao('INDISPONIVEL', `Azul indisponível (HTTP ${r.status})`);
  if (r.status === 401) throw new ErroCotacao('CREDENCIAL', (r.json && r.json.ErrorText) || 'Acesso negado pela Azul');
  if ((r.json && r.json.HasErrors) || r.status !== 200) {
    // CEP inexistente/não atendido volta como 400 "Object reference not set to an instance of an object."
    throw new ErroCotacao('ROTA_NAO_ATENDIDA', 'A Azul não conseguiu cotar essa rota. Confira os CEPs; o destino pode não ser atendido.',
      undefined, (r.json && r.json.ErrorText) || `HTTP ${r.status}`);
  }

  const lista = Array.isArray(r.json && r.json.Value) ? r.json.Value : [];
  if (lista.length === 0) throw new ErroCotacao('ROTA_NAO_ATENDIDA', 'Nenhum serviço da Azul disponível para essa rota.');

  // Margem de segurança interna: soma 1 dia ao prazo que a Azul devolve
  // antes de mostrar pra quem cota — decisão de negócio (evitar prometer um
  // prazo que a Azul não bate), não reflete o prazo real que a Azul cotou.
  const MARGEM_PRAZO_DIAS = 1;

  const servicos = lista.map((c) => {
    const taxas = (c.Taxas || []).map((t) => ({ tipo: t.Tipo.trim(), valor: t.Valor }));
    return { servico: c.NomeServico, total: c.Total, prazoDias: c.Prazo + MARGEM_PRAZO_DIAS, frete: c.Frete, taxas, idCotacao: c.ID_Cotacao || null };
  }).sort((a, b) => a.total - b.total);

  return { servicos, ...pesos, cotadoEm: new Date().toISOString() };
}

module.exports = { ErroCotacao, validarEntrada, calcularPesos, avisosVolumes, cotarFrete, FATOR_CUBAGEM };
