// Emissão de etiqueta Correios (pré-postagem) — portado quase literalmente
// de correios-etiqueta-nextjs/src/lib/correios-etiqueta/*.ts (7 arquivos
// TypeScript puros, sem import nenhum do Next.js/React, testado em
// produção em 25/09/2026 — pré-postagem AD961441978BR, criada e
// cancelada). Consolidado num arquivo só, com uma seção por arquivo
// original, seguindo o padrão de serviço único já usado em
// azulCotacao.service.js / correiosCotacao.service.js.
//
// ATENÇÃO (diferente das cotações): emitir() CRIA UM OBJETO REAL no
// contrato dos Correios — um código de rastreio de verdade. Se não for
// postar, cancele (cancelar()) — senão a pré-postagem expira em 14 dias
// sozinha. Revisar (previa()) não cria nada.

/* ============================ erros.ts ============================ */

class CorreiosErro extends Error {
  constructor(tipo, mensagem, status = null) {
    super(mensagem);
    this.name = 'CorreiosErro';
    this.tipo = tipo; // 'CREDENCIAL'|'SEM_PERMISSAO'|'DADOS_INVALIDOS'|'LIMITE'|'PENDENTE'|'INDISPONIVEL'
    this.status = status;
  }
}

/* ============================ datas.ts ============================ */

/** Os Correios mandam datas sem fuso, em horário de Brasília. Devolve ISO com -03:00. */
function dataBrasilia(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s; // já tem fuso
  const base = s.replace(' ', 'T').replace(/\.\d+$/, '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(base) ? `${base.length === 16 ? base + ':00' : base}-03:00` : s;
}

/* ============================ servicos.ts ============================ */

// Códigos "Correios Log+" do cartão (39888/39870) são recusados pela API
// de pré-postagem ("Serviço não permitido") — usar os de contrato abaixo.
const SERVICOS = {
  SEDEX: '03220', // SEDEX CONTRATO AG
  PAC: '03298',   // PAC CONTRATO AG
};
const SERVICO_PADRAO = 'SEDEX';

/** "SEDEX" | "pac" | "03220" → código de 5 dígitos. Vazio → padrão. */
function resolverServico(servico, padrao = SERVICO_PADRAO) {
  const s = String(servico ?? '').trim().toUpperCase() || String(padrao).toUpperCase();
  if (s in SERVICOS) return SERVICOS[s];
  if (/^\d{5}$/.test(s)) return s;
  throw new CorreiosErro('DADOS_INVALIDOS', `Serviço desconhecido: "${servico}". Use SEDEX, PAC ou o código de 5 dígitos.`);
}

/** "03220" → "SEDEX"; códigos fora da lista voltam como estão. */
function nomeServico(codigo) {
  return Object.entries(SERVICOS).find(([, c]) => c === codigo)?.[0] ?? codigo;
}

/* ============================ api.ts ============================ */

const URLS = {
  prod: 'https://api.correios.com.br',
  hom: 'https://apihom.correios.com.br',
};

// O token vale 24h e a API devolve o MESMO token enquanto ele for válido.
// Por isso só renovamos quando ele está a 1 min de vencer (ou quando a API
// o recusar): renovar cedo demais gera pedidos repetidos de token e a API
// responde 429.
const MARGEM_TOKEN_MS = 60000;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Erros da Correios API vêm como { msgs: ["PRZ-008: ..."] } */
function mensagens(corpo) {
  if (!corpo) return '';
  if (typeof corpo === 'string') return corpo.slice(0, 300);
  if (Array.isArray(corpo.msgs)) return corpo.msgs.join(' | ');
  return corpo.message ?? corpo.mensagem ?? corpo.detail ?? '';
}

function cep(v) {
  const s = String(v ?? '').replace(/\D/g, '');
  if (s.length !== 8) throw new CorreiosErro('DADOS_INVALIDOS', `CEP deve ter 8 dígitos (recebido: "${v}")`);
  return s;
}

/** A API de gateway responde 401/403 "GTW-006: Token inválido" quando o token venceu ou foi trocado. */
function tokenRecusado(r) {
  return r.status === 401 || (r.status === 403 && /GTW-00[0-9]|token/i.test(mensagens(r.corpo)));
}

class CorreiosApi {
  constructor(opcoes) {
    if (!opcoes.usuario || !opcoes.codigoAcesso) throw new CorreiosErro('CREDENCIAL', 'Informe usuario (idCorreios) e codigoAcesso do CWS');
    if (!/^\d{10}$/.test(opcoes.cartao ?? '')) throw new CorreiosErro('DADOS_INVALIDOS', 'Cartão de postagem deve ter 10 dígitos');
    this.base = URLS[opcoes.ambiente || 'prod'];
    this.fetchImpl = opcoes.fetch || fetch;
    this.opcoes = {
      usuario: opcoes.usuario,
      codigoAcesso: opcoes.codigoAcesso,
      cartao: opcoes.cartao,
      contrato: opcoes.contrato,
      dr: opcoes.dr,
      timeoutMs: opcoes.timeoutMs ?? 30000,
      tentativas: opcoes.tentativas ?? 3,
    };
    this.token = null;
    this.tokenExpiraEm = 0;
    this.loginEmAndamento = null;
  }

  /** Chamada autenticada. Renova o token uma vez se a API o recusar. Devolve o corpo (JSON) ou lança CorreiosErro. */
  async chamar(metodo, caminho, corpo, opts = {}) {
    const resp = await this.chamarBruto(metodo, caminho, corpo, opts);
    return opts.binario ? resp : this.validar(resp);
  }

  /** Igual a `chamar`, mas devolve a resposta inteira (status, tipo de conteúdo, bytes) já validada quanto a erro. */
  async chamarBruto(metodo, caminho, corpo, opts = {}) {
    let resp = await this.requisitar(metodo, caminho, { Authorization: `Bearer ${await this.obterToken()}` }, corpo, opts.binario);
    if (tokenRecusado(resp)) {
      this.token = null;
      resp = await this.requisitar(metodo, caminho, { Authorization: `Bearer ${await this.obterToken()}` }, corpo, opts.binario);
    }
    if (opts.binario) this.validar(resp);
    return resp;
  }

  async obterToken() {
    if (this.token && Date.now() < this.tokenExpiraEm - MARGEM_TOKEN_MS) return this.token;
    // Evita vários logins simultâneos quando o CRM consulta em paralelo
    this.loginEmAndamento ??= this.login().finally(() => { this.loginEmAndamento = null; });
    return this.loginEmAndamento;
  }

  async login() {
    const basic = Buffer.from(`${this.opcoes.usuario}:${this.opcoes.codigoAcesso}`).toString('base64');
    const corpo = { numero: this.opcoes.cartao };
    if (this.opcoes.contrato) corpo.contrato = this.opcoes.contrato;
    if (this.opcoes.dr != null) corpo.dr = this.opcoes.dr;
    const resp = await this.requisitar('POST', '/token/v1/autentica/cartaopostagem', { Authorization: `Basic ${basic}` }, corpo);
    if (resp.status === 429) throw new CorreiosErro('LIMITE', 'Tokens pedidos demais (HTTP 429). Aguarde antes de tentar de novo.', 429);
    if (resp.status !== 200 && resp.status !== 201) {
      const tipo = resp.status >= 500 ? 'INDISPONIVEL' : 'CREDENCIAL';
      throw new CorreiosErro(tipo, `Token recusado pelos Correios: ${mensagens(resp.corpo) || `HTTP ${resp.status}`}`, resp.status);
    }
    const t = resp.corpo;
    if (!t?.token) throw new CorreiosErro('INDISPONIVEL', 'Resposta de token sem o campo token', resp.status);
    this.token = t.token;
    const expira = Date.parse(dataBrasilia(t.expiraEm) ?? '');
    this.tokenExpiraEm = Number.isFinite(expira) ? expira : Date.now() + 23 * 3600000;
    return this.token;
  }

  validar(resp) {
    const { status, corpo } = resp;
    if (status >= 200 && status < 300) return corpo;
    const msg = mensagens(corpo) || `HTTP ${status}`;
    if (status === 401) throw new CorreiosErro('CREDENCIAL', msg, status);
    if (status === 403) throw new CorreiosErro('SEM_PERMISSAO', `API não liberada para o cartão/contrato: ${msg}`, status);
    if (status === 429) throw new CorreiosErro('LIMITE', msg, status);
    if (status >= 400 && status < 500) throw new CorreiosErro('DADOS_INVALIDOS', msg, status);
    throw new CorreiosErro('INDISPONIVEL', msg, status);
  }

  /** Requisição com timeout e novas tentativas (espera 1s, 2s, 4s…) em falha de rede ou 5xx. */
  async requisitar(metodo, caminho, headers, corpo, binario = false) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= this.opcoes.tentativas; tentativa++) {
      try {
        const res = await this.fetchImpl(this.base + caminho, {
          method: metodo,
          headers: {
            Accept: binario ? 'application/pdf, application/json, */*' : 'application/json',
            // Obrigatório no SRO Rastro (sem ele: 400 SRO-018)
            'Accept-Language': 'pt-BR',
            ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
          signal: AbortSignal.timeout(this.opcoes.timeoutMs),
        });
        const tipoConteudo = res.headers.get('content-type') ?? '';
        let bytes;
        let json = null;
        if (binario && !/json/i.test(tipoConteudo)) {
          bytes = new Uint8Array(await res.arrayBuffer());
        } else {
          const texto = await res.text();
          try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
        }
        if (res.status >= 500 && tentativa < this.opcoes.tentativas) {
          ultimoErro = new CorreiosErro('INDISPONIVEL', mensagens(json) || `HTTP ${res.status}`, res.status);
        } else {
          return { status: res.status, corpo: json, tipoConteudo, bytes };
        }
      } catch (e) {
        ultimoErro = e;
      }
      if (tentativa < this.opcoes.tentativas) await esperar(1000 * 2 ** (tentativa - 1));
    }
    if (ultimoErro instanceof CorreiosErro) throw ultimoErro;
    throw new CorreiosErro('INDISPONIVEL', `Falha de comunicação com os Correios: ${ultimoErro?.message ?? ultimoErro}`);
  }
}

/* ============================ prepostagem.ts ============================ */

const STATUS = { 1: 'PREATENDIDO', 2: 'PREPOSTADO', 3: 'POSTADO', 4: 'EXPIRADO', 5: 'CANCELADO', 6: 'ESTORNADO', 7: 'PENDENTE' };

class CorreiosPrePostagem extends CorreiosApi {
  constructor(opcoes) {
    super(opcoes);
    if (!opcoes.remetente) throw new CorreiosErro('DADOS_INVALIDOS', 'Informe o remetente padrão (dados da empresa)');
    this.remetente = opcoes.remetente;
    this.servicoPadrao = opcoes.servicoPadrao ?? SERVICO_PADRAO;
  }

  /** Monta o corpo da requisição a partir do envio (sem chamar a API). Lança DADOS_INVALIDOS com todos os problemas de uma vez. */
  montarRequisicao(envio) {
    const erros = [];
    const formato = envio.formato ?? 2;
    const rem = pessoa('remetente', envio.remetente ?? this.remetente, erros, true);
    const dest = pessoa('destinatário', envio.destinatario, erros, false);

    let servico = '';
    try { servico = resolverServico(envio.servico, this.servicoPadrao); } catch (e) { erros.push(e.message); }
    if (!(envio.pesoG > 0)) erros.push('peso deve ser maior que zero (gramas)');
    if (String(Math.round(envio.pesoG)).length > 6) erros.push('peso acima do limite (máx. 6 dígitos em gramas)');
    if (formato === 2 && !(envio.alturaCm > 0 && envio.larguraCm > 0 && envio.comprimentoCm > 0)) erros.push('caixa/pacote exige altura, largura e comprimento (cm)');
    if (formato === 3 && !(envio.diametroCm > 0 && envio.comprimentoCm > 0)) erros.push('rolo exige diâmetro e comprimento (cm)');

    const chave = envio.chaveNFe?.replace(/\D/g, '');
    if (chave && chave.length !== 44) erros.push(`chave NF-e deve ter 44 dígitos (recebido: ${chave.length})`);
    const nf = envio.numeroNotaFiscal?.replace(/\D/g, '');
    if (nf && nf.length > 12) erros.push('número da NF com mais de 12 dígitos');

    if (!envio.itens?.length) erros.push('declaração de conteúdo é obrigatória: informe ao menos um item');
    const itens = (envio.itens ?? []).map((it, i) => {
      const d = (it.descricao ?? '').trim();
      if (d.length < 2 || d.length > 60) erros.push(`item ${i + 1}: descrição deve ter 2 a 60 caracteres`);
      if (/^(.)\1*$/.test(d)) erros.push(`item ${i + 1}: descrição não pode ter só caracteres iguais`);
      if (!(it.quantidade > 0) || !Number.isInteger(it.quantidade)) erros.push(`item ${i + 1}: quantidade deve ser inteira e maior que zero`);
      if (!(it.valorUnitario > 0)) erros.push(`item ${i + 1}: valor unitário deve ser maior que zero`);
      return { conteudo: d, quantidade: String(it.quantidade), valor: it.valorUnitario.toFixed(2) };
    });

    if (envio.pedido && envio.pedido.length > 25) erros.push('número do pedido com mais de 25 caracteres');
    if (envio.observacao && envio.observacao.length > 50) erros.push('observação com mais de 50 caracteres');
    if (erros.length) throw new CorreiosErro('DADOS_INVALIDOS', `Pré-postagem inválida: ${erros.join('; ')}`);

    const corpo = {
      remetente: rem,
      destinatario: dest,
      codigoServico: servico,
      pesoInformado: String(Math.round(envio.pesoG)),
      codigoFormatoObjetoInformado: String(formato),
      cienteObjetoNaoProibido: '1',
      modalidadePagamento: '2', // a faturar (contrato)
      itensDeclaracaoConteudo: itens,
    };
    if (formato === 2) Object.assign(corpo, { alturaInformada: dim(envio.alturaCm), larguraInformada: dim(envio.larguraCm), comprimentoInformado: dim(envio.comprimentoCm) });
    if (formato === 3) Object.assign(corpo, { diametroInformado: dim(envio.diametroCm), comprimentoInformado: dim(envio.comprimentoCm) });
    if (chave) corpo.chaveNFe = chave;
    if (nf) corpo.numeroNotaFiscal = nf;
    if (envio.servicosAdicionais?.length) {
      corpo.listaServicoAdicional = envio.servicosAdicionais.map((s) => ({
        codigoServicoAdicional: s.codigo.padStart(3, '0'),
        ...(s.valorDeclarado ? { valorDeclarado: s.valorDeclarado.toFixed(2) } : {}),
      }));
    }
    if (envio.pedido) corpo.pedidoExternoOrigem = envio.pedido;
    if (envio.observacao) corpo.observacao = envio.observacao;
    if (envio.prazoPostagem) corpo.prazoPostagem = ddmmaaaa(envio.prazoPostagem);
    return corpo;
  }

  /**
   * Cria a pré-postagem nos Correios. Devolve id + código de rastreio.
   * ATENÇÃO: cria um objeto real no contrato. Se não for postar, cancele (`cancelar`) — senão expira no prazo.
   */
  async criar(envio) {
    const r = await this.chamar('POST', '/prepostagem/v1/prepostagens', this.montarRequisicao(envio));
    return normalizarPrePostagem(r);
  }

  /** Consulta pelo id da pré-postagem ou pelo código de rastreio. Retorna null se não existir (até 120 dias). */
  async consultar(idOuCodigo) {
    const ehCodigo = /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(idOuCodigo);
    const q = ehCodigo ? `codigoObjeto=${idOuCodigo.toUpperCase()}` : `id=${encodeURIComponent(idOuCodigo)}`;
    try {
      const r = await this.chamar('GET', `/prepostagem/v2/prepostagens?${q}`);
      const item = r?.itens?.[0];
      return item ? normalizarPrePostagem(item) : null;
    } catch (e) {
      // "PPN-344: Não existem pré-postagens para os parâmetros informados." vem como 404
      if (e instanceof CorreiosErro && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Gera a etiqueta em PDF. O Correios processa de forma assíncrona: pede, recebe um recibo
   * e baixa quando estiver pronta (o método espera sozinho, até `esperaMaxMs`).
   * layout: PADRAO (A4, várias por folha) ou LINEAR_100_150 (impressora térmica 10x15)
   */
  async etiqueta(idsPrePostagem, opts = {}) {
    if (!idsPrePostagem.length) throw new CorreiosErro('DADOS_INVALIDOS', 'Informe ao menos um id de pré-postagem');
    // Sem NF-e, os Correios emitem a DC-e (declaração de conteúdo eletrônica) e a pré-postagem fica
    // PENDENTE por um tempo. Nesse status a etiqueta é recusada (PPN-288) — então esperamos liberar.
    const esperaMax = opts.esperaMaxMs ?? 60000;
    for (const id of idsPrePostagem) await this.aguardarLiberacao(id, esperaMax);
    const pedido = await this.chamar('POST', '/prepostagem/v1/prepostagens/rotulo/assincrono/pdf', {
      idsPrePostagem,
      numeroCartaoPostagem: this.opcoes.cartao,
      tipoRotulo: opts.reduzida ? 'R' : 'P',
      formatoRotulo: 'ET',
      imprimeRemetente: 'S',
      layoutImpressao: opts.layout ?? 'PADRAO',
    });
    const idRecibo = pedido?.idRecibo ?? pedido?.recibo ?? null;
    const imediato = extrairPdf(pedido);
    if (imediato) return { pdf: imediato, idRecibo };
    if (!idRecibo) throw new CorreiosErro('INDISPONIVEL', `Resposta sem recibo da etiqueta: ${JSON.stringify(pedido).slice(0, 200)}`);
    return { pdf: await this.baixarEtiqueta(idRecibo, esperaMax), idRecibo };
  }

  /**
   * Espera a pré-postagem sair de PENDENTE (emissão da DC-e). Lança `PENDENTE` se não liberar a tempo —
   * o CRM deve só tentar a etiqueta de novo mais tarde (a pré-postagem e o código já existem).
   */
  async aguardarLiberacao(id, esperaMaxMs = 60000) {
    const limite = Date.now() + esperaMaxMs;
    for (let espera = 2000; ; espera = Math.min(espera * 2, 10000)) {
      const pp = await this.consultar(id);
      if (!pp) throw new CorreiosErro('DADOS_INVALIDOS', `Pré-postagem ${id} não encontrada`);
      if (pp.status === 'CANCELADO' || pp.status === 'EXPIRADO' || pp.status === 'ESTORNADO') {
        throw new CorreiosErro('DADOS_INVALIDOS', `Pré-postagem ${id} está ${pp.status}: não é possível gerar etiqueta`);
      }
      if (pp.status !== 'PENDENTE') return pp;
      if (Date.now() + espera > limite) {
        const motivo = pp.bruto.erroAssincrono || pp.bruto.motivoCancelamento;
        throw new CorreiosErro('PENDENTE', `Pré-postagem ${id} ainda PENDENTE nos Correios (emissão da DC-e)${motivo ? `: ${motivo}` : ''}. Tente a etiqueta mais tarde.`);
      }
      await esperar(espera);
    }
  }

  /** Baixa uma etiqueta já solicitada, pelo recibo. Espera enquanto estiver em processamento. */
  async baixarEtiqueta(idRecibo, esperaMaxMs = 30000) {
    const limite = Date.now() + esperaMaxMs;
    let ultima = '';
    let aindaProcessando = false;
    for (let espera = 1000; ; espera = Math.min(espera * 2, 5000)) {
      try {
        const r = await this.chamarBruto('GET', `/prepostagem/v1/prepostagens/rotulo/download/assincrono/${encodeURIComponent(idRecibo)}`, undefined, { binario: true });
        const pdf = r.bytes?.length ? r.bytes : extrairPdf(r.corpo);
        if (pdf) return pdf;
        // Recusa definitiva vem com HTTP 200 + { mensagem: "PPN-288: Não é permitido imprimir…" }
        const msg = String(r.corpo?.mensagem ?? '');
        if (/^PPN-\d+/.test(msg) && !/process|aguard/i.test(msg)) {
          throw new CorreiosErro(/Pendente/i.test(msg) ? 'PENDENTE' : 'DADOS_INVALIDOS', msg, r.status);
        }
        ultima = JSON.stringify(r.corpo).slice(0, 200);
      } catch (e) {
        // Enquanto processa, a API pode responder 400 "em processamento" — tenta de novo até o limite
        if (!(e instanceof CorreiosErro) || e.tipo !== 'DADOS_INVALIDOS' || !/process|aguard|gera/i.test(e.message)) throw e;
        ultima = e.message;
        aindaProcessando = true;
      }
      if (Date.now() + espera > limite) break;
      await esperar(espera);
    }
    // Estourou o tempo de espera, mas a única razão foi "ainda processando" — a pré-postagem
    // já existe (não se perde), só a etiqueta que ainda não ficou pronta. Trata como PENDENTE
    // (mesmo fluxo de "baixar de novo depois") em vez de falhar como serviço indisponível.
    const tipo = aindaProcessando ? 'PENDENTE' : 'INDISPONIVEL';
    throw new CorreiosErro(tipo, `Etiqueta não ficou pronta a tempo (recibo ${idRecibo}): ${ultima}`);
  }

  /**
   * Declaração de conteúdo para imprimir. Em produção (25/09/2026) veio HTML com cabeçalho
   * Content-Type: application/pdf (errado) — por isso o tipo é detectado pelo conteúdo, não pelo cabeçalho.
   */
  async declaracaoConteudo(idsPrePostagem, folha = 'A4') {
    const r = await this.chamarBruto('GET', `/prepostagem/v1/prepostagens/declaracaoconteudo/${idsPrePostagem.map(encodeURIComponent).join(',')}?tamFolhaImpressao=${folha}`, undefined, { binario: true });
    const conteudo = r.bytes ?? new TextEncoder().encode(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo));
    const ehPdf = Buffer.from(conteudo.slice(0, 5)).toString() === '%PDF-';
    return { tipo: ehPdf ? 'pdf' : 'html', conteudo };
  }

  /** Cancela uma pré-postagem ainda não postada, pelo id ou pelo código de rastreio. */
  async cancelar(idOuCodigo) {
    const ehCodigo = /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(idOuCodigo);
    const caminho = ehCodigo
      ? `/prepostagem/v1/prepostagens/objeto/${idOuCodigo.toUpperCase()}`
      : `/prepostagem/v1/prepostagens/${encodeURIComponent(idOuCodigo)}`;
    const r = await this.chamar('DELETE', `${caminho}?idCorreiosSolicitanteCancelamento=${encodeURIComponent(this.opcoes.usuario)}`);
    return { resultado: String(r?.resultadoCancelamento ?? ''), mensagem: String(r?.mensagem ?? '') };
  }

  /** Dados da postagem na agência (peso/medidas aferidos e valor cobrado). Só existe depois de postado. */
  async dadosPostagem(codigoObjeto) {
    try {
      const r = await this.chamar('GET', `/prepostagem/v1/prepostagens/postada?codigoObjeto=${codigoObjeto.toUpperCase()}`);
      if (!r) return null;
      return {
        postadoEm: dataBrasilia(r.dataHoraAtendimento ?? r.dataPostagem) ?? null,
        valor: r.valorAtendimento ?? null,
        pesoTarifadoG: r.pesoTarifadoObjeto != null ? Number(r.pesoTarifadoObjeto) : null,
        bruto: r,
      };
    } catch (e) {
      if (e instanceof CorreiosErro && e.status === 404) return null;
      throw e;
    }
  }
}

function normalizarPrePostagem(r) {
  const statusNum = Number(r.statusAtual);
  return {
    id: String(r.id ?? ''),
    codigoObjeto: r.codigoObjeto || null,
    servico: String(r.codigoServico ?? ''),
    nomeServico: nomeServico(String(r.codigoServico ?? '')),
    status: STATUS[statusNum] ?? (r.descStatusAtual || 'DESCONHECIDO'),
    prazoPostagem: r.prazoPostagem ? (dataBrDdMm(r.prazoPostagem) ?? dataBrasilia(r.prazoPostagem)) : null,
    preco: typeof r.precoPrePostagem === 'number' ? r.precoPrePostagem : r.precoPrePostagem ? Number(r.precoPrePostagem) : null,
    pedido: r.pedidoExternoOrigem || null,
    bruto: r,
  };
}

/** Aceita a etiqueta como bytes, base64 solto ou dentro de um campo (dados/arquivo/pdf/conteudo). */
function extrairPdf(corpo) {
  if (!corpo) return null;
  const candidatos = typeof corpo === 'string' ? [corpo] : [corpo.dados, corpo.arquivo, corpo.pdf, corpo.conteudo, corpo.base64, corpo.rotulo];
  for (const c of candidatos) {
    if (typeof c === 'string' && c.startsWith('JVBER')) return Uint8Array.from(Buffer.from(c, 'base64'));
  }
  return null;
}

function pessoa(papel, p, erros, ehRemetente) {
  if (!p) { erros.push(`${papel} não informado`); return undefined; }
  const nome = (p.nome ?? '').trim().replace(/\s+/g, ' ');
  if (nome.length < 3 || nome.length > 50) erros.push(`${papel}: nome deve ter 3 a 50 caracteres`);
  const doc = p.cpfCnpj?.replace(/\D/g, '');
  if (ehRemetente && !doc) erros.push(`${papel}: CPF/CNPJ obrigatório`);
  if (doc && doc.length !== 11 && doc.length !== 14) erros.push(`${papel}: CPF/CNPJ deve ter 11 ou 14 dígitos`);
  const e = p.endereco;
  if (!e) { erros.push(`${papel}: endereço não informado`); return undefined; }
  let cepOk = '';
  try { cepOk = cep(e.cep); } catch { erros.push(`${papel}: CEP deve ter 8 dígitos`); }
  const lim = (campo, v, max, obrig = true) => {
    const s = (v ?? '').trim();
    if (obrig && !s) erros.push(`${papel}: ${campo} obrigatório`);
    if (s.length > max) erros.push(`${papel}: ${campo} com mais de ${max} caracteres ("${s}")`);
    return s;
  };
  const endereco = {
    cep: cepOk,
    logradouro: lim('logradouro', e.logradouro, 50),
    numero: lim('número (use "S/N" se não houver)', e.numero, 6),
    bairro: lim('bairro', e.bairro, 30),
    cidade: lim('cidade', e.cidade, 30),
    uf: lim('UF', e.uf?.toUpperCase(), 2),
  };
  const compl = lim('complemento', e.complemento, 30, false);
  if (compl) endereco.complemento = compl;

  const saida = { nome, endereco };
  if (doc) saida.cpfCnpj = doc;
  if (p.email) saida.email = p.email.trim();
  const tel = p.telefone?.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (tel) {
    if (tel.length === 11) Object.assign(saida, { dddCelular: tel.slice(0, 2), celular: tel.slice(2) });
    else if (tel.length === 10) Object.assign(saida, { dddTelefone: tel.slice(0, 2), telefone: tel.slice(2) });
    else erros.push(`${papel}: telefone deve ter DDD + número (10 ou 11 dígitos)`);
  }
  return saida;
}

const dim = (v) => String(Math.ceil(v ?? 0));

function ddmmaaaa(d) {
  const b = new Date(d.getTime() - 3 * 3600000); // Brasília
  return `${String(b.getUTCDate()).padStart(2, '0')}/${String(b.getUTCMonth() + 1).padStart(2, '0')}/${b.getUTCFullYear()}`;
}

/** "10/05/2025" → "2025-05-10T23:59:59-03:00" */
function dataBrDdMm(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}T23:59:59-03:00` : null;
}

/* ============================ nfe.ts ============================ */

/** Lê o XML da NF-e (nfeProc ou NFe). Lança DADOS_INVALIDOS se não for uma NF-e. */
function lerNFe(xml) {
  const doc = String(xml ?? '').replace(/<(\/?)[\w-]+:/g, '<$1'); // remove prefixos de namespace (nfe:, ns2:…)
  const inf = bloco(doc, 'infNFe');
  if (!inf) throw new CorreiosErro('DADOS_INVALIDOS', 'XML não parece uma NF-e (tag infNFe não encontrada)');

  const idAttr = /<infNFe\b[^>]*\bId\s*=\s*"NFe(\d{44})"/i.exec(doc)?.[1];
  const chave = idAttr ?? texto(bloco(doc, 'infProt') ?? '', 'chNFe') ?? '';
  if (!/^\d{44}$/.test(chave)) throw new CorreiosErro('DADOS_INVALIDOS', 'Chave da NF-e não encontrada no XML');

  const ide = bloco(inf, 'ide') ?? '';
  const emit = bloco(inf, 'emit') ?? '';
  const dest = bloco(inf, 'dest') ?? '';
  const end = bloco(dest, 'enderDest') ?? '';

  const itens = blocos(inf, 'det').map((det) => {
    const prod = bloco(det, 'prod') ?? '';
    const qtd = num(texto(prod, 'qCom'));
    const vUn = num(texto(prod, 'vUnCom'));
    const vProd = num(texto(prod, 'vProd'));
    const descricao = texto(prod, 'xProd') ?? '';
    // Quantidade fracionada (ex.: kg, metro): a declaração pede inteiro → 1 unidade com o valor total do item
    if (!Number.isInteger(qtd) || qtd <= 0) return { descricao, quantidade: 1, valorUnitario: vProd || vUn };
    return { descricao, quantidade: qtd, valorUnitario: vUn || vProd / qtd };
  });

  const pesos = blocos(bloco(inf, 'transp') ?? '', 'vol').map((v) => num(texto(v, 'pesoB')));
  const pesoKg = pesos.reduce((a, b) => a + (b || 0), 0);

  return {
    chave,
    numero: texto(ide, 'nNF'),
    serie: texto(ide, 'serie'),
    emitidaEm: texto(ide, 'dhEmi'),
    emitente: { cnpj: texto(emit, 'CNPJ'), nome: texto(emit, 'xNome') },
    destinatario: {
      nome: texto(dest, 'xNome') ?? '',
      cpfCnpj: texto(dest, 'CNPJ') ?? texto(dest, 'CPF') ?? undefined,
      email: texto(dest, 'email')?.split(/[;,\s]+/)[0] || undefined,
      telefone: texto(end, 'fone') ?? undefined,
      endereco: {
        cep: texto(end, 'CEP') ?? '',
        logradouro: texto(end, 'xLgr') ?? '',
        numero: texto(end, 'nro') ?? '',
        complemento: texto(end, 'xCpl') ?? undefined,
        bairro: texto(end, 'xBairro') ?? '',
        cidade: texto(end, 'xMun') ?? '',
        uf: texto(end, 'UF') ?? '',
      },
    },
    itens,
    pesoBrutoG: pesoKg > 0 ? Math.round(pesoKg * 1000) : null,
    valorTotal: num(texto(bloco(inf, 'ICMSTot') ?? '', 'vNF')) || null,
  };
}

/**
 * Junta XML da NF-e, chave e preenchimento do card num `NovoEnvio` pronto para `criar`/`prepararEnvio`.
 * Não valida tudo — a validação completa (com todos os erros juntos) acontece em `montarRequisicao`/`criar`.
 */
function montarEnvio(entrada) {
  const avisos = [];
  const nfe = entrada.xmlNFe ? lerNFe(entrada.xmlNFe) : null;
  const d = entrada.dados ?? {};

  const chaveInformada = entrada.chaveNFe?.replace(/\D/g, '') || d.chaveNFe?.replace(/\D/g, '') || '';
  if (nfe && chaveInformada && chaveInformada !== nfe.chave) {
    throw new CorreiosErro('DADOS_INVALIDOS', `A chave informada (${chaveInformada}) é diferente da chave do XML (${nfe.chave})`);
  }
  const chave = nfe?.chave ?? chaveInformada;
  if (!chave) avisos.push('Sem chave de NF-e: os Correios vão gerar a declaração de conteúdo como "não contribuinte". Use só em teste.');

  if (nfe && entrada.cnpjRemetente && nfe.emitente.cnpj && nfe.emitente.cnpj !== entrada.cnpjRemetente.replace(/\D/g, '')) {
    avisos.push(`NF emitida pelo CNPJ ${nfe.emitente.cnpj} (${nfe.emitente.nome ?? ''}), diferente do remetente ${entrada.cnpjRemetente}. Confira se a etiqueta deve sair em nome da outra empresa.`);
  }

  const xd = nfe?.destinatario;
  const md = d.destinatario ?? {};
  const endereco = {
    cep: md.endereco?.cep ?? xd?.endereco.cep ?? '',
    logradouro: md.endereco?.logradouro ?? xd?.endereco.logradouro ?? '',
    numero: md.endereco?.numero ?? xd?.endereco.numero ?? '',
    complemento: md.endereco?.complemento ?? xd?.endereco.complemento,
    bairro: md.endereco?.bairro ?? xd?.endereco.bairro ?? '',
    cidade: md.endereco?.cidade ?? xd?.endereco.cidade ?? '',
    uf: md.endereco?.uf ?? xd?.endereco.uf ?? '',
  };
  const destinatario = {
    nome: md.nome ?? xd?.nome ?? '',
    cpfCnpj: md.cpfCnpj ?? xd?.cpfCnpj,
    email: md.email ?? xd?.email,
    telefone: md.telefone ?? xd?.telefone,
    endereco,
  };

  // Telefone da NF muitas vezes vem sem DDD ou incompleto: descarta com aviso em vez de travar a emissão
  const tel = destinatario.telefone?.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (tel && tel.length !== 10 && tel.length !== 11) {
    avisos.push(`Telefone "${destinatario.telefone}" sem DDD ou incompleto: não foi enviado.`);
    destinatario.telefone = undefined;
  }
  if (!destinatario.endereco.numero?.trim()) {
    destinatario.endereco.numero = 'S/N';
    avisos.push('Endereço sem número: enviado como "S/N".');
  }

  let itens = d.itens ?? nfe?.itens ?? [];
  const pesoG = d.pesoG ?? nfe?.pesoBrutoG ?? undefined;
  if (d.pesoG == null && nfe?.pesoBrutoG) avisos.push(`Peso tirado da NF (peso bruto): ${nfe.pesoBrutoG} g. Confira se inclui a embalagem.`);

  if (entrada.ajustarTamanhos ?? true) {
    destinatario.nome = cortar(destinatario.nome, 50, 'nome do destinatário', avisos);
    endereco.logradouro = encurtar(endereco.logradouro, 50, 'rua', avisos);
    endereco.bairro = encurtar(endereco.bairro, 30, 'bairro', avisos);
    endereco.cidade = encurtar(endereco.cidade, 30, 'cidade', avisos);
    if (endereco.complemento) endereco.complemento = cortar(endereco.complemento, 30, 'complemento', avisos);
    if (endereco.numero.length > 6) {
      // "1234 BLOCO B" → número "1234", resto vai para o complemento
      const [n, ...resto] = endereco.numero.split(/\s+/);
      if (n.length <= 6 && resto.length) {
        endereco.numero = n;
        endereco.complemento = cortar([resto.join(' '), endereco.complemento].filter(Boolean).join(' '), 30, 'complemento', avisos);
        avisos.push(`Número "${n} ${resto.join(' ')}": "${resto.join(' ')}" foi para o complemento.`);
      }
    }
    itens = itens.map((it, i) => ({ ...it, descricao: cortar(it.descricao.trim(), 60, `descrição do item ${i + 1}`, avisos) }));
  }

  const envio = { ...d, destinatario, itens, pesoG, chaveNFe: chave || undefined };
  if (!chave) delete envio.chaveNFe;
  return { envio, avisos, nfe };
}

const ABREVIACOES = [
  [/\bRUA\b/gi, 'R'], [/\bAVENIDA\b/gi, 'Av'], [/\bTRAVESSA\b/gi, 'Tv'], [/\bALAMEDA\b/gi, 'Al'], [/\bRODOVIA\b/gi, 'Rod'],
  [/\bESTRADA\b/gi, 'Estr'], [/\bPRA[CÇ]A\b/gi, 'Pç'], [/\bJARDIM\b/gi, 'Jd'], [/\bCONJUNTO\b/gi, 'Cj'], [/\bRESIDENCIAL\b/gi, 'Res'],
  [/\bPARQUE\b/gi, 'Pq'], [/\bVILA\b/gi, 'Vl'], [/\bLOTEAMENTO\b/gi, 'Lot'], [/\bCONDOM[IÍ]NIO\b/gi, 'Cond'], [/\bSETOR\b/gi, 'St'],
  [/\bDOUTOR\b/gi, 'Dr'], [/\bPROFESSOR(A)?\b/gi, 'Prof$1'], [/\bPRESIDENTE\b/gi, 'Pres'], [/\bGOVERNADOR\b/gi, 'Gov'],
  [/\bSENADOR\b/gi, 'Sen'], [/\bDEPUTADO\b/gi, 'Dep'], [/\bVEREADOR\b/gi, 'Ver'], [/\bCOMENDADOR\b/gi, 'Com'], [/\bMARECHAL\b/gi, 'Mal'],
  [/\bGENERAL\b/gi, 'Gen'], [/\bCORONEL\b/gi, 'Cel'], [/\bSANTA\b/gi, 'Sta'], [/\bSANTO\b/gi, 'Sto'], [/\bNOSSA SENHORA\b/gi, 'N Sra'],
];

/** Tenta abreviar termos comuns; se ainda passar do limite, corta. Avisa em ambos os casos. */
function encurtar(v, max, campo, avisos) {
  const s = (v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  let r = s;
  const maiusculas = s === s.toUpperCase(); // endereço da NF-e costuma vir todo em maiúsculas
  for (const [re, abrev] of ABREVIACOES) {
    if (r.length <= max) break;
    r = r.replace(re, (...m) => {
      const a = abrev.replace(/\$1/, m[1] ?? '');
      return maiusculas ? a.toUpperCase() : a;
    });
  }
  if (r.length <= max) {
    avisos.push(`${campo} abreviado: "${s}" → "${r}"`);
    return r;
  }
  return cortar(r, max, campo, avisos, s);
}

function cortar(v, max, campo, avisos, original = v) {
  const s = (v ?? '').trim();
  if (s.length <= max) return s;
  const r = s.slice(0, max).trim();
  avisos.push(`${campo} cortado em ${max} caracteres: "${original}" → "${r}"`);
  return r;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m)
    .trim();
}

function bloco(xml, tag) {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1] ?? null;
}
function blocos(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
}
function texto(xml, tag) {
  const b = bloco(xml, tag);
  if (b == null) return null;
  const t = decodificar(b);
  return t || null;
}
function num(v) {
  const n = Number(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

/* ============================ index.ts ============================ */

/** Remetente que sai na etiqueta (dados da empresa, não são segredo). */
const REMETENTE = {
  nome: 'SEUBONE COM BONES PERSONALIZADOS LTDA',
  cpfCnpj: '36153457000183',
  endereco: { cep: '59064510', logradouro: 'Rua Lafayete Lamartine', numero: '1945', bairro: 'Candelária', cidade: 'Natal', uf: 'RN' },
};

const LAYOUTS = { LINEAR_100_150: 'Térmica 10x15', PADRAO: 'A4' };

class ErroEtiqueta extends Error {
  constructor(tipo, mensagem, detalhe) {
    super(mensagem);
    this.name = 'ErroEtiqueta';
    this.tipo = tipo; // 'VALIDACAO'|'CREDENCIAL'|'INDISPONIVEL'|'NAO_ENCONTRADA'
    this.detalhe = detalhe;
  }
}

// ─── Cliente (uma instância por processo: o token de 24h fica em cache) ────

let cliente = null;

/** Só para testes: troca o cliente (ex.: com fetch simulado) */
function definirCliente(c) { cliente = c; }

function obterCliente(env) {
  if (cliente) return cliente;
  if (!env.correiosUsuario || !env.correiosCodigoAcesso || !/^\d{10}$/.test(env.correiosCartao ?? '')) {
    throw new ErroEtiqueta('CREDENCIAL', 'Integração com os Correios sem configuração', 'Configure CORREIOS_USUARIO, CORREIOS_CODIGO_ACESSO e CORREIOS_CARTAO');
  }
  cliente = new CorreiosPrePostagem({
    usuario: env.correiosUsuario,
    codigoAcesso: env.correiosCodigoAcesso,
    cartao: env.correiosCartao,
    contrato: env.correiosContrato || undefined,
    dr: env.correiosDr ? Number(env.correiosDr) : undefined,
    remetente: REMETENTE,
    timeoutMs: 25000,
  });
  return cliente;
}

/** '17,5' / '17.5' / '1.234,5' → número (ponto só é separador de milhar quando também há vírgula) */
const numero = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const texto2 = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// Cada caixa vira uma pré-postagem própria (código de rastreio e etiqueta
// próprios). Trava de sanidade contra um clique/digitação fora do normal.
const MAX_CAIXAS = 10;

/**
 * Converte o formulário em um NovoEnvio POR CAIXA (XML/chave + preenchimento) e
 * valida tudo. Não chama os Correios. NF-e, destinatário, serviço, pedido e
 * declaração de conteúdo são os mesmos em todas as caixas; muda só a caixa
 * (medidas e peso) e a observação, que ganha "Vol i/N" quando há mais de uma.
 */
function montar(bruta, env) {
  const e = bruta ?? {};
  if (e.modo === 'xml' && !texto2(e.xmlNFe)) throw new ErroEtiqueta('VALIDACAO', 'Envie o XML da NF-e');
  if (e.modo !== 'xml' && !texto2(e.chaveNFe)) throw new ErroEtiqueta('VALIDACAO', 'Informe a chave da NF-e (44 dígitos)');

  const caixasBrutas = Array.isArray(e.caixas) ? e.caixas : [];
  if (!caixasBrutas.length) throw new ErroEtiqueta('VALIDACAO', 'Informe ao menos uma caixa');
  if (caixasBrutas.length > MAX_CAIXAS) throw new ErroEtiqueta('VALIDACAO', `No máximo ${MAX_CAIXAS} caixas por emissão`);
  const total = caixasBrutas.length;

  const d = e.destinatario ?? {};
  const end = d.endereco ?? {};
  const itens = e.modo === 'manual'
    ? (e.itens ?? []).filter((i) => texto2(i.descricao) || texto2(String(i.quantidade ?? '')) || texto2(String(i.valorUnitario ?? '')))
      .map((i) => ({ descricao: String(i.descricao ?? '').trim(), quantidade: numero(i.quantidade), valorUnitario: numero(i.valorUnitario) }))
    : undefined;

  const avisos = [];
  const pesos = caixasBrutas.map((c) => (texto2(String(c?.pesoG ?? '')) ? numero(c.pesoG) : undefined));

  let nfe = null;
  if (e.modo === 'xml') {
    try { nfe = lerNFe(e.xmlNFe); } catch (err) {
      if (err instanceof CorreiosErro) throw new ErroEtiqueta('VALIDACAO', err.message);
      throw err;
    }
  }

  // Várias caixas e nenhum peso informado, com XML: divide o peso bruto da NF por igual (e avisa).
  // Qualquer outro peso faltando com mais de uma caixa é erro: a NF não diz quanto pesa cada uma.
  if (total > 1) {
    const faltando = pesos.map((p, i) => (p === undefined ? i + 1 : null)).filter(Boolean);
    if (faltando.length === total && nfe?.pesoBrutoG) {
      const cada = Math.round(nfe.pesoBrutoG / total);
      pesos.fill(cada);
      avisos.push(`Peso bruto da NF (${nfe.pesoBrutoG} g) dividido igualmente entre as ${total} caixas: ${cada} g cada. Confira.`);
    } else if (faltando.length) {
      throw new ErroEtiqueta('VALIDACAO', `Informe o peso ${faltando.length > 1 ? 'das caixas' : 'da caixa'} ${faltando.join(', ')} (em gramas)`);
    }
  }

  const envios = [];
  caixasBrutas.forEach((c, i) => {
    const prefixo = total > 1 ? `Caixa ${i + 1}: ` : '';
    let obs = [total > 1 ? `Vol ${i + 1}/${total}` : null, texto2(e.observacao)].filter(Boolean).join(' - ');
    if (obs.length > 50) {
      obs = obs.slice(0, 50);
      const aviso = 'Observação cortada em 50 caracteres para caber na etiqueta.';
      if (!avisos.includes(aviso)) avisos.push(aviso);
    }
    try {
      const r = montarEnvio({
        xmlNFe: e.modo === 'xml' ? e.xmlNFe : undefined,
        chaveNFe: texto2(e.chaveNFe),
        cnpjRemetente: REMETENTE.cpfCnpj,
        dados: {
          servico: resolverServico(e.servico),
          alturaCm: numero(c?.alturaCm), larguraCm: numero(c?.larguraCm), comprimentoCm: numero(c?.comprimentoCm),
          ...(pesos[i] !== undefined ? { pesoG: pesos[i] } : {}),
          ...(itens ? { itens } : {}),
          ...(texto2(e.pedido) ? { pedido: texto2(e.pedido) } : {}),
          ...(obs ? { observacao: obs } : {}),
          // No modo XML, só o que foi preenchido substitui o XML; no manual, tudo vem daqui
          destinatario: {
            ...(texto2(d.nome) ? { nome: texto2(d.nome) } : {}),
            ...(texto2(d.cpfCnpj) ? { cpfCnpj: texto2(d.cpfCnpj) } : {}),
            ...(texto2(d.email) ? { email: texto2(d.email) } : {}),
            ...(texto2(d.telefone) ? { telefone: texto2(d.telefone) } : {}),
            endereco: Object.fromEntries(Object.entries(end).filter(([, v]) => texto2(v))),
          },
        },
      });
      if (!(r.envio.pesoG > 0)) throw new ErroEtiqueta('VALIDACAO', 'Informe o peso em gramas (a NF-e não traz peso bruto)');
      obterCliente(env).montarRequisicao(r.envio); // validação completa — lista todos os problemas de uma vez
      envios.push(r.envio);
      r.avisos.forEach((a) => { if (!avisos.includes(a)) avisos.push(a); });
    } catch (err) {
      if (err instanceof CorreiosErro) throw new ErroEtiqueta('VALIDACAO', prefixo + err.message.replace(/^Pré-postagem inválida: /, 'Corrija antes de emitir: '));
      if (err instanceof ErroEtiqueta) throw new ErroEtiqueta(err.tipo, prefixo + err.message, err.detalhe);
      throw err;
    }
  });
  return { envios, avisos };
}

/** Mostra o que vai ser emitido, com os avisos. NÃO cria nada nos Correios. */
function previa(bruta, env) {
  const { envios, avisos } = montar(bruta, env);
  const base = envios[0];
  const codigo = resolverServico(base.servico);
  return {
    servico: nomeServico(codigo),
    codigoServico: codigo,
    chaveNFe: base.chaveNFe ?? null,
    destinatario: base.destinatario,
    itens: base.itens,
    volumes: envios.map((v) => ({
      alturaCm: v.alturaCm, larguraCm: v.larguraCm, comprimentoCm: v.comprimentoCm, pesoG: Math.round(v.pesoG),
    })),
    pesoTotalG: envios.reduce((s, v) => s + Math.round(v.pesoG), 0),
    pedido: base.pedido ?? null,
    observacao: texto2(bruta?.observacao) ?? null,
    avisos,
  };
}

/**
 * Cria uma pré-postagem por caixa (objetos REAIS no contrato) e baixa as etiquetas
 * térmica e A4 de todas, juntas num PDF por layout.
 * `idsPrePostagem` (um por caixa, na mesma ordem; null onde ainda não existe) reaproveita o
 * que uma tentativa anterior já criou: se a 3ª de 4 falhar, tentar de novo só cria as que faltam.
 * Em caso de falha no meio, o erro leva `idsPrePostagem` com o que já existe, pra tela guardar.
 */
async function emitir(bruta, env) {
  const { envios, avisos } = montar(bruta, env);
  const pp = obterCliente(env);
  const anteriores = Array.isArray(bruta?.idsPrePostagem) ? bruta.idsPrePostagem.map((v) => texto2(v ?? undefined)) : [];
  const pres = new Array(envios.length).fill(null);
  try {
    for (let i = 0; i < envios.length; i++) {
      let pre = anteriores[i] ? await pp.consultar(anteriores[i]) : null;
      if (pre && ['CANCELADO', 'EXPIRADO', 'ESTORNADO'].includes(pre.status)) pre = null;
      if (!pre) pre = await pp.criar(envios[i]);
      pres[i] = pre;
    }
    const ids = pres.map((p) => p.id);
    const etiquetas = {};
    let pendente = false;
    for (const layout of Object.keys(LAYOUTS)) {
      try {
        etiquetas[layout] = Buffer.from((await pp.etiqueta(ids, { layout, esperaMaxMs: 45000 })).pdf).toString('base64');
      } catch (e) {
        if (e instanceof CorreiosErro && e.tipo === 'PENDENTE') { pendente = true; break; }
        throw e;
      }
    }
    return {
      servico: pres[0].nomeServico,
      prazoPostagem: pres[0].prazoPostagem,
      volumes: pres.map((p) => ({ id: p.id, codigoObjeto: p.codigoObjeto, prazoPostagem: p.prazoPostagem })),
      idsPrePostagem: ids,
      pendente,
      etiquetas: pendente ? {} : etiquetas,
      avisos,
    };
  } catch (e) {
    const erro = traduzir(e);
    if (erro instanceof ErroEtiqueta) erro.idsPrePostagem = pres.map((p, k) => (p ? p.id : (anteriores[k] ?? null)));
    throw erro;
  }
}

/** Baixa (ou reimprime) as etiquetas de pré-postagens já criadas, juntas num PDF só. */
async function baixarEtiquetas(ids, layout, env) {
  try {
    return (await obterCliente(env).etiqueta(ids, { layout, esperaMaxMs: 45000 })).pdf;
  } catch (e) {
    throw traduzir(e);
  }
}

/** Baixa (ou reimprime) a etiqueta de uma pré-postagem já criada. */
function baixarEtiqueta(id, layout, env) {
  return baixarEtiquetas([id], layout, env);
}

/** Consulta o status atual (PREPOSTADO, POSTADO, CANCELADO, EXPIRADO…). */
async function consultar(id, env) {
  try {
    const p = await obterCliente(env).consultar(id);
    if (!p) throw new ErroEtiqueta('NAO_ENCONTRADA', 'Pré-postagem não encontrada');
    return p;
  } catch (e) {
    throw traduzir(e);
  }
}

/** Cancela uma pré-postagem ainda não postada. */
async function cancelar(id, env) {
  const pp = obterCliente(env);
  try {
    const r = await pp.cancelar(id);
    const depois = await pp.consultar(id);
    return { status: depois?.status ?? 'DESCONHECIDO', mensagem: r.resultado || r.mensagem };
  } catch (e) {
    throw traduzir(e);
  }
}

function traduzir(e) {
  if (e instanceof ErroEtiqueta) return e;
  if (!(e instanceof CorreiosErro)) return e;
  switch (e.tipo) {
    case 'DADOS_INVALIDOS': return new ErroEtiqueta('VALIDACAO', `Os Correios recusaram: ${e.message}`, e.message);
    case 'CREDENCIAL':
    case 'SEM_PERMISSAO': return new ErroEtiqueta('CREDENCIAL', 'A integração com os Correios está sem acesso no momento', e.message);
    case 'PENDENTE': return new ErroEtiqueta('INDISPONIVEL', 'Os Correios ainda estão liberando a etiqueta. Tente baixar de novo em instantes.', e.message);
    default: return new ErroEtiqueta('INDISPONIVEL', 'Os Correios não responderam. Tente novamente em instantes.', e.message);
  }
}

module.exports = {
  CorreiosErro, CorreiosApi, CorreiosPrePostagem, normalizarPrePostagem,
  ErroEtiqueta, REMETENTE, LAYOUTS,
  MAX_CAIXAS, previa, emitir, baixarEtiqueta, baixarEtiquetas, consultar, cancelar, definirCliente, obterCliente,
  lerNFe, montarEnvio,
  resolverServico, nomeServico, SERVICOS,
};
