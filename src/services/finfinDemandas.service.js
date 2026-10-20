// Integração com o módulo Demandas do finfin (Grupo SB): kanban "Envio de demandas - Gerais" da SeuBoné.
// Documentação: api-demandas-seubone-gerais.md (finfin). Autenticação: "Authorization: Bearer <token>" (nunca na URL).
//
// O formulário novo do hub tem só os campos que o finfin pede (solicitante, e-mail, telefone, demanda, especificação,
// descrição, link do Lulu e anexos). O Registro antigo (n8n + planilha) continua como está, em paralelo, até o novo estar 100%.
const crypto = require('crypto');
const env = require('../config/env');

const MAX_ANEXOS = 10;
const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024;   // por arquivo
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;      // somados, por pedido
const TIMEOUT_MS = 20000;
const VALIDADE_LISTA_MS = 10 * 60 * 1000;

// Lista que o formulário do Registro antigo oferecia: usada só como reserva se o finfin não responder a lista de demandas.
const DEMANDAS_RESERVA = ['NF Urgente', 'Nota de Remessa', 'Baixa de comprovante', 'Análise de termo de compromisso', 'Nota de Conta e Ordem', 'Link de pagamento',
  'Orçamento - Extrema/MG', 'Ajuste de nota fiscal', 'Ajuste de orçamento', 'Envio de boleto', 'Liberação p/envio', 'Nota de Devolução', 'Amostras', 'Nota de Brinde',
  'Manifesto', 'Cancelamento de Boleto', 'Pedidos retidos', 'Outros'];

const str = (v) => String(v == null ? '' : v);
const normalizar = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ── HTTP ─────────────────────────────────────────────────────────────────────
let http = (url, init) => fetch(url, init);
/** Só para testes. */
function definirHttp(fn) { http = fn; }

const configurado = () => !!env.finfinDemandasToken;

async function chamar(metodo, { query = null, corpo = null } = {}) {
  if (!env.finfinDemandasToken) throw new Error('FINFIN_DEMANDAS_TOKEN não configurado.');
  const url = new URL(env.finfinDemandasUrl);
  if (query) Object.entries(query).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  const init = { method: metodo, headers: { Authorization: `Bearer ${env.finfinDemandasToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (corpo) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corpo); }
  const resp = await http(url.toString(), init);
  const texto = await resp.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* resposta que não é JSON */ }
  return { status: resp.status, json, texto: json ? null : texto.slice(0, 300) };
}

/** Resultado padronizado: { ok, status, ...corpo } ; em erro traz "erro" (texto) e "erros" (campo -> mensagem) quando o finfin devolve. */
function resultado(r) {
  const j = r.json || {};
  if (r.status >= 200 && r.status < 300 && j.ok !== false) return { ok: true, status: r.status, ...j };
  const erro = r.status === 401 ? 'Token recusado pelo finfin (401).'
    : r.status === 429 ? 'Limite de requisições do finfin atingido (429): tente de novo em instantes.'
    : r.status === 422 ? 'O finfin recusou os dados (422).'
    : j.erro || j.error || (r.texto ? `Resposta inesperada do finfin (HTTP ${r.status}).` : `Falha no finfin (HTTP ${r.status}).`);
  return { ok: false, status: r.status, erro, erros: j.erros || null };
}

const criarCard = async (payload) => resultado(await chamar('POST', { corpo: payload }));
const consultarCard = async (codigo) => resultado(await chamar('GET', { query: { codigo } }));
const moverCard = async (codigo, coluna) => resultado(await chamar('PATCH', { corpo: { codigo, coluna } }));
/** Lista de nomes de demanda aceitos hoje (aba "Tipos de demanda" do finfin): GET ?listas=1. Devolve o JSON cru em "bruto". */
async function listarDemandas() {
  const r = resultado(await chamar('GET', { query: { listas: '1' } }));
  return { ...r, nomes: r.ok ? extrairNomesDemandas(r) : [], bruto: r };
}

/** O formato exato do GET ?listas=1 não está na documentação: procura, em qualquer ponto do JSON, a lista que contém "NF Urgente". */
function extrairNomesDemandas(json) {
  const texto = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str(x.nome || x.name || x.label || x.valor || x.value || x.titulo || '') : '');
  let achado = null;
  (function varrer(no, profundidade) {
    if (achado || profundidade > 6 || no == null) return;
    if (Array.isArray(no)) {
      const nomes = no.map(texto).filter(Boolean);
      if (nomes.length && nomes.some((n) => normalizar(n) === 'nf urgente')) { achado = nomes; return; }
      no.forEach((x) => varrer(x, profundidade + 1));
    } else if (typeof no === 'object') Object.values(no).forEach((x) => varrer(x, profundidade + 1));
  })(json, 0);
  return achado || [];
}

let cacheLista = null;
/**
 * Demandas que o formulário oferece: a lista real do finfin (guardada por 10 min). Se o finfin não responder, ou a lista não puder ser
 * lida, usa a lista antiga do hub como reserva ("origem: 'hub'"): aí o finfin é quem confere o nome no envio.
 */
async function demandasAceitas({ agora = Date.now() } = {}) {
  if (cacheLista && agora - cacheLista.em < VALIDADE_LISTA_MS) return cacheLista.valor;
  let valor = { nomes: DEMANDAS_RESERVA, origem: 'hub' };
  if (configurado()) {
    try {
      const r = await listarDemandas();
      if (r.nomes.length) valor = { nomes: r.nomes, origem: 'finfin' };
    } catch (e) { /* mantém a reserva */ }
  }
  if (valor.origem === 'finfin') cacheLista = { em: agora, valor };   // a reserva não fica guardada: tenta o finfin de novo na próxima
  return valor;
}
/** Só para testes. */
function limparCache() { cacheLista = null; }

// ── Tradução do formulário do hub para o card do finfin ──────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Acha, na lista do finfin, o nome da demanda que corresponde ao do hub (igual, ou igual sem acento/caixa). null se não houver. */
function resolverDemanda(nomeHub, listaFinfin, aliases = {}) {
  const alvo = normalizar(aliases[nomeHub] || nomeHub);
  if (!Array.isArray(listaFinfin) || !listaFinfin.length) return str(aliases[nomeHub] || nomeHub);   // sem lista: manda como está
  return listaFinfin.find((n) => normalizar(n) === alvo) || null;
}

const cortar = (s, n) => (str(s).length > n ? str(s).slice(0, n - 1).trimEnd() + '…' : str(s));

/**
 * Monta o corpo do POST a partir do que o formulário do hub coleta.
 * f:      { id?, solicitante, email, telefone?, demandaSolicitada, especificacao?, descricao, linkLulu, anexos?: [{ nome, tipo, base64 }] }
 * opcoes: { demandasFinfin: [nomes aceitos], aliases: { nomeNoHub: nomeNoFinfin }, prefixoTitulo: '[TESTE] ' }
 * Devolve { payload, erros } — "erros" não vazio = não dá para enviar. O título só é enviado quando há prefixo (teste); sem ele o finfin monta
 * "[Nome] - [Demanda]" sozinho.
 */
function montarCard(f, opcoes = {}) {
  const erros = [];
  const x = f || {};
  const nome = cortar(str(x.solicitante).trim(), 120);
  const email = str(x.email).trim();
  const descricao = str(x.descricao).trim();
  let link = str(x.linkLulu).trim();

  if (!nome) erros.push('Solicitante vazio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.push('Informe um e-mail válido.');
  if (!descricao) erros.push('Descreva a demanda.');
  const demanda = resolverDemanda(str(x.demandaSolicitada).trim(), opcoes.demandasFinfin, opcoes.aliases || {});
  if (!str(x.demandaSolicitada).trim()) erros.push('Escolha a demanda.');
  else if (!demanda) erros.push(`A demanda "${x.demandaSolicitada}" não existe na lista do finfin.`);
  if (/^http:\/\//i.test(link)) link = 'https://' + link.slice(7);
  if (!/^https:\/\/\S+$/i.test(link)) erros.push('O link do card do Lulu precisa ser um link completo (https://…).');

  const campos = { solicitante_nome: nome, solicitante_email: email, demanda_solicitada: demanda || str(x.demandaSolicitada).trim(), descricao, link_lulu: link };
  if (str(x.telefone).trim()) campos.telefone = str(x.telefone).trim();
  if (normalizar(campos.demanda_solicitada) === 'outros') {
    const esp = cortar(str(x.especificacao).trim(), 60);
    if (!esp) erros.push('Diga o que é a demanda no campo "Especificação" (obrigatório em "Outros").');
    else campos.especificacao = esp;
  }
  if (opcoes.prefixoTitulo) campos.titulo = cortar(`${opcoes.prefixoTitulo}${nome} - ${campos.demanda_solicitada}`, 200);

  const arquivos = Array.isArray(x.anexos) ? x.anexos.filter((a) => a && (a.base64 || a.conteudo_base64)) : [];
  const tamanhos = arquivos.map((a) => Math.floor(str(a.base64 || a.conteudo_base64).length * 0.75));
  if (arquivos.length > MAX_ANEXOS) erros.push(`Máximo de ${MAX_ANEXOS} anexos.`);
  if (tamanhos.some((n) => n > MAX_ARQUIVO_BYTES)) erros.push(`Cada anexo pode ter até ${MAX_ARQUIVO_BYTES / 1048576} MB.`);
  if (tamanhos.reduce((s, n) => s + n, 0) > MAX_TOTAL_BYTES) erros.push(`Os anexos somados passam de ${MAX_TOTAL_BYTES / 1048576} MB (limite do finfin). Envie arquivos menores.`);

  const payload = { id: UUID.test(str(x.id)) ? str(x.id).toLowerCase() : crypto.randomUUID(), empresa: 'seubone', formulario: 'gerais', campos };
  if (arquivos.length) payload.anexos = arquivos.map((a) => ({ nome: str(a.nome || 'arquivo'), tipo: str(a.tipo || 'application/octet-stream'), conteudo_base64: str(a.base64 || a.conteudo_base64) }));
  return { payload, erros };
}

// ── Pagamento (kanban "Pagamentos") ──────────────────────────────────────────
// Campos e regras iguais aos do formulário público do finfin (api-demandas-seubone-pagamento.md). Aqui só se conferem o básico e os
// dígitos de CPF/CNPJ; o resto (telefone com DDD, chave aleatória...) o finfin confere e o hub repassa a mensagem de cada campo (422).
const PIX_TIPOS = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];
const so9 = (s) => str(s).replace(/\D/g, '');

function cpfValido(v) {
  const d = so9(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function cnpjValido(v) {
  const d = so9(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = pesos.reduce((a, p, i) => a + Number(d[i]) * p, 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
const docValido = (v) => cpfValido(v) || cnpjValido(v);

/** "1.234,56" / "1234,56" / "1234.56" / 1234.56 → número (ou NaN). */
function numeroBr(v) {
  if (typeof v === 'number') return v;
  const t = str(v).trim().replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  // Com vírgula, ponto é milhar. Sem vírgula, "1.500" (grupos de 3 dígitos) é milhar e "1234.56" é decimal.
  const norm = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(norm);
}

const PIX_ROTULO = { cpf: 'CPF', cnpj: 'CNPJ', email: 'e-mail', telefone: 'telefone', aleatoria: 'aleatória' };

/**
 * Monta o corpo do POST do kanban "Pagamentos".
 * f:      { id?, solicitante, email, razaoSocial, vencimento (AAAA-MM-DD), cpfCnpj, motivo, banco, agencia, conta, pixTipo, pixChave, valor, notaFiscal, anexos }
 * opcoes: { prefixoTitulo: '[TESTE] ' }
 * Devolve { payload, erros }. O título só é enviado em teste; sem prefixo o finfin monta o dele.
 */
function montarCardPagamento(f, opcoes = {}) {
  const erros = [];
  const x = f || {};
  const t = (v) => str(v).trim();
  const razao = cortar(t(x.razaoSocial), 200);
  const nome = cortar(t(x.solicitante), 120);
  const email = t(x.email);
  const venc = t(x.vencimento);
  const doc = t(x.cpfCnpj);
  const motivo = t(x.motivo);
  const banco = t(x.banco), agencia = t(x.agencia), conta = t(x.conta), nf = t(x.notaFiscal);
  const pixTipo = normalizar(x.pixTipo).replace(/[^a-z]/g, '');   // "E-mail" -> email, "Aleatória" -> aleatoria
  const pixChave = t(x.pixChave);
  const valor = numeroBr(x.valor);

  if (!razao) erros.push('Informe a razão social (quem vai receber).');
  if (!nome) erros.push('Solicitante vazio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.push('Informe um e-mail válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || Number.isNaN(Date.parse(venc + 'T12:00:00Z'))) erros.push('Informe a data de vencimento.');
  if (!doc) erros.push('Informe o CPF/CNPJ de quem vai receber.');
  else if (!docValido(doc)) erros.push('CPF/CNPJ inválido (confira os dígitos).');
  if (!motivo) erros.push('Informe o motivo do pagamento.');
  if (!banco) erros.push('Informe o banco.');
  if (!agencia) erros.push('Informe a agência.');
  if (!conta) erros.push('Informe a conta.');
  if (!PIX_TIPOS.includes(pixTipo)) erros.push('Escolha o tipo da chave pix.');
  if (!pixChave) erros.push('Informe a chave pix.');
  else if (pixTipo === 'cpf' && !cpfValido(pixChave)) erros.push('A chave pix não é um CPF válido.');
  else if (pixTipo === 'cnpj' && !cnpjValido(pixChave)) erros.push('A chave pix não é um CNPJ válido.');
  else if (pixTipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pixChave)) erros.push('A chave pix não é um e-mail válido.');
  if (!(valor > 0)) erros.push('Informe o valor (maior que zero).');
  if (!nf) erros.push('Informe o número da nota fiscal.');

  const arquivos = Array.isArray(x.anexos) ? x.anexos.filter((a) => a && (a.base64 || a.conteudo_base64)) : [];
  if (!arquivos.length) erros.push('Anexe ao menos 1 arquivo (nota fiscal, boleto ou comprovante).');
  const tamanhos = arquivos.map((a) => Math.floor(str(a.base64 || a.conteudo_base64).length * 0.75));
  if (arquivos.length > MAX_ANEXOS) erros.push(`Máximo de ${MAX_ANEXOS} anexos.`);
  if (tamanhos.some((n) => n > MAX_ARQUIVO_BYTES)) erros.push(`Cada anexo pode ter até ${MAX_ARQUIVO_BYTES / 1048576} MB.`);
  if (tamanhos.reduce((s, n) => s + n, 0) > MAX_TOTAL_BYTES) erros.push(`Os anexos somados passam de ${MAX_TOTAL_BYTES / 1048576} MB (limite do finfin). Envie arquivos menores.`);

  const campos = {
    razao_social: razao, solicitante_nome: nome, vencimento: venc, cpf_cnpj: doc, solicitante_email: email, motivo,
    banco, agencia, conta, pix_tipo: pixTipo, pix_chave: pixChave, valor: Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0, nota_fiscal: nf,
  };
  if (opcoes.prefixoTitulo) campos.titulo = cortar(`${opcoes.prefixoTitulo}Pagamento - ${razao}`, 200);

  const payload = { id: UUID.test(str(x.id)) ? str(x.id).toLowerCase() : crypto.randomUUID(), empresa: 'seubone', formulario: 'pagamento', campos };
  if (arquivos.length) payload.anexos = arquivos.map((a) => ({ nome: str(a.nome || 'arquivo'), tipo: str(a.tipo || 'application/octet-stream'), conteudo_base64: str(a.base64 || a.conteudo_base64) }));
  return { payload, erros };
}

/** Coluna final de cada kanban: "Concluído" nas demandas gerais, "Pago" nos pagamentos. */
const COLUNA_FINAL = { gerais: 'concluido', pagamento: 'pago' };

module.exports = {
  montarCardPagamento, cpfValido, cnpjValido, numeroBr, PIX_TIPOS, PIX_ROTULO, COLUNA_FINAL,
  configurado, criarCard, consultarCard, moverCard, listarDemandas, extrairNomesDemandas, demandasAceitas, limparCache,
  montarCard, resolverDemanda, normalizar, definirHttp, DEMANDAS_RESERVA, MAX_ANEXOS, MAX_ARQUIVO_BYTES, MAX_TOTAL_BYTES,
};
