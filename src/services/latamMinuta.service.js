// Emissão de e-Minuta LATAM Cargo — portado quase literalmente de
// latam-cargo-crm/src/{xml.ts, erros.ts, produtos.ts, minuta.ts, cliente.ts
// (só a parte de e-Minuta + o essencial de tracking pra verificação de
// segurança)}. Consolidado num arquivo só, com uma seção por arquivo
// original, seguindo o mesmo padrão já usado em correiosEtiqueta.service.js.
//
// ATENÇÃO: emitirMinuta() CRIA UM OBJETO REAL rastreável (AWB) no contrato
// da LATAM. Diferente dos Correios, AQUI NÃO EXISTE FUNÇÃO DE CANCELAMENTO
// em lugar nenhum da API/manual — por isso a chamada NUNCA repete sozinha em
// caso de falha (evita duplicar minuta): se der INDISPONIVEL/timeout, quem
// chama deve conferir com verificarPorChaveNfe() antes de tentar de novo.

/* ============================ erros.ts ============================ */

class LatamErro extends Error {
  constructor(tipo, mensagem, extra = {}) {
    super(mensagem);
    this.name = 'LatamErro';
    this.tipo = tipo; // 'CREDENCIAL'|'SEM_PERMISSAO'|'DADOS_INVALIDOS'|'INDISPONIVEL'
    this.status = extra.status ?? null;
    this.codigoLatam = extra.codigoLatam ?? null;
    this.detalhes = extra.detalhes ?? [];
  }
}

/* ============================ xml.ts ============================ */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? m;
  });
}

const semPrefixo = (nome) => nome.slice(nome.indexOf(':') + 1);

function lerXml(xml) {
  const raiz = { nome: '#documento', atributos: {}, filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const topo = pilha.at(-1);
    if (m[1] !== undefined) { topo.texto += m[1]; continue; }
    if (m[3]) {
      const nome = semPrefixo(m[3]);
      if (m[2]) {
        const i = pilha.findLastIndex((n) => n.nome === nome);
        if (i > 0) pilha.length = i;
        continue;
      }
      const atributos = {};
      for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        atributos[semPrefixo(a[1])] = decodificar(a[2] ?? a[3] ?? '');
      }
      const no = { nome, atributos, filhos: [], texto: '' };
      topo.filhos.push(no);
      if (!m[5]) pilha.push(no);
      continue;
    }
    if (m[6]) topo.texto += decodificar(m[6]);
  }
  return raiz;
}

function filho(no, ...caminho) {
  let atual = no;
  for (const nome of caminho) atual = atual?.filhos.find((f) => f.nome === nome);
  return atual;
}
function filhos(no, nome) {
  return no?.filhos.filter((f) => f.nome === nome) ?? [];
}
/** Primeiro nó com esse nome em qualquer profundidade. */
function buscar(no, nome) {
  if (!no) return undefined;
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const achado = buscar(f, nome);
    if (achado) return achado;
  }
  return undefined;
}
function texto(no, ...caminho) {
  const t = filho(no, ...caminho)?.texto.trim();
  return t ? t : null;
}

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Valor null/undefined/'' → elemento omitido (a LATAM rejeita tags vazias em campos numéricos). */
function el(nome, conteudo, atributos) {
  const attrs = Object.entries(atributos ?? {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${escapar(String(v))}"`)
    .join('');
  if (Array.isArray(conteudo)) {
    const interno = conteudo.filter(Boolean).join('');
    return interno ? `<${nome}${attrs}>${interno}</${nome}>` : '';
  }
  if (conteudo == null || conteudo === '') return '';
  return `<${nome}${attrs}>${escapar(String(conteudo))}</${nome}>`;
}

function envelope(namespaces, corpo) {
  const ns = Object.entries(namespaces).map(([p, u]) => ` xmlns:${p}="${u}"`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"${ns}>` +
    `<soapenv:Header/><soapenv:Body>${corpo}</soapenv:Body></soapenv:Envelope>`;
}

/* ============================ produtos.ts ============================ */
// Códigos confirmados no stg em 29/09/2026 (todos aceitos): 25 EFACIL, 26
// PROXIMO VOO, 33 JUNTOS, 44 RESERVADO. STANDARD e VELOZ não constam no
// manual — os códigos precisam vir da LATAM e ser passados em
// codigosServico. Enquanto não forem configurados, escolher esses serviços
// gera LatamErro('DADOS_INVALIDOS') com a explicação.

const NOMES_SERVICO = {
  EFACIL: 'e-fácil',
  STANDARD: 'Standard',
  VELOZ: 'Veloz',
  PROXIMO_VOO: 'Próximo Voo',
  JUNTOS: 'Juntos',
  RESERVADO: 'Reservado',
};

const CODIGOS_SERVICO_PADRAO = {
  EFACIL: '25',
  PROXIMO_VOO: '26',
  JUNTOS: '33',
  RESERVADO: '44',
};

const REGRA_SERVICO_PADRAO = { limite: 3000, ateOLimite: 'EFACIL', acimaDoLimite: 'STANDARD' };

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function sugerirServico(valorTotalNotas, codigos = CODIGOS_SERVICO_PADRAO, regra = REGRA_SERVICO_PADRAO) {
  const acima = valorTotalNotas > regra.limite;
  const servico = acima ? regra.acimaDoLimite : regra.ateOLimite;
  return {
    servico,
    nome: NOMES_SERVICO[servico],
    codigo: codigos[servico] ?? null,
    automatico: true,
    motivo: `Notas somam ${brl(valorTotalNotas)} — ${acima ? 'acima de' : 'até'} ${brl(regra.limite)} → ${NOMES_SERVICO[servico]}`,
  };
}

function servicosDisponiveis(codigos = CODIGOS_SERVICO_PADRAO) {
  return Object.keys(NOMES_SERVICO).map((s) => ({ servico: s, nome: NOMES_SERVICO[s], codigo: codigos[s] ?? null, configurado: Boolean(codigos[s]) }));
}

function resolverServico(valorTotalNotas, manual, codigos = CODIGOS_SERVICO_PADRAO, regra = REGRA_SERVICO_PADRAO) {
  const escolha = manual
    ? { servico: manual, nome: NOMES_SERVICO[manual], codigo: codigos[manual] ?? null, automatico: false, motivo: `Escolhido manualmente: ${NOMES_SERVICO[manual]}` }
    : sugerirServico(valorTotalNotas, codigos, regra);
  if (!NOMES_SERVICO[escolha.servico]) throw new LatamErro('DADOS_INVALIDOS', `Serviço desconhecido: ${escolha.servico}`);
  if (!escolha.codigo) {
    throw new LatamErro('DADOS_INVALIDOS',
      `${escolha.motivo}, mas o código do serviço ${escolha.nome} ainda não foi configurado. ` +
      `Peça o código à LATAM e informe em codigosServico.${escolha.servico}.`,
      { detalhes: [{ codigo: 'SERVICO_SEM_CODIGO', descricao: escolha.servico }] });
  }
  return escolha;
}

/* ============================ minuta.ts ============================ */
// ATENÇÃO: várias tags estão escritas com erro de digitação NO PRÓPRIO
// SCHEMA da LATAM e precisam ir assim: <ContacInformation>,
// <Fiscalnformation>, <AditionaIInfo> (com "I" maiúsculo), <quatity>,
// unitDimentionCode. Não "corrija".

/** Mercadoria padrão da Seubone */
const MERCADORIA_PADRAO = { codigo: '605', nome: 'CONFECÇÕES/TEXTEIS' };
const NS_EMINUTA = 'http://ws.latam.com/v3_0';

const digitosMinuta = (s) => (s ?? '').replace(/\D/g, '');
const simNao = (b) => (b ? 'S' : 'N');
const dec = (n, casas) => (Math.round(n * 10 ** casas) / 10 ** casas).toFixed(casas);

/** "2026-09-24 10:27:35" no horário de Brasília */
function dataHoraBrasilia(d) {
  const local = new Date(d.getTime() - 3 * 3_600_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function validarMinuta(e) {
  const erros = [];
  const iata = /^[A-Z]{3}$/;
  if (!iata.test(e.origem ?? '')) erros.push('origem deve ser o código IATA do aeroporto (3 letras)');
  if (!iata.test(e.destino ?? '')) erros.push('destino deve ser o código IATA do aeroporto (3 letras)');
  if (e.mercadoria && (!e.mercadoria.codigo || !e.mercadoria.nome)) erros.push('mercadoria.codigo e mercadoria.nome são obrigatórios quando informados');
  if (!e.notas?.length) erros.push('informe ao menos uma nota');
  if (!e.volumes?.length) erros.push('informe ao menos um volume');
  if (![1, 2, 3].includes(e.seguro?.tipo)) erros.push('seguro.tipo deve ser 1, 2 ou 3');
  if (e.formaPagamento?.tipo === 7 && !e.formaPagamento.conta) erros.push('formaPagamento.conta é obrigatória para conta corrente (7)');
  const pagador = e.pagador ?? 'remetente';
  if (!e[pagador]) erros.push(`pagador "${pagador}" não foi informado`);

  const clientes = [
    ['remetente', e.remetente], ['destinatario', e.destinatario], ['tomador', e.tomador],
    ['expedidor', e.expedidor], ['recebedor', e.recebedor],
  ];
  for (const [papel, c] of clientes) {
    if (!c) { if (papel === 'remetente' || papel === 'destinatario') erros.push(`${papel} é obrigatório`); continue; }
    if (!c.nome) erros.push(`${papel}.nome é obrigatório`);
    const cnpj = digitosMinuta(c.cnpj), cpf = digitosMinuta(c.cpf);
    if (!cnpj && !cpf) erros.push(`${papel}: informe cnpj ou cpf`);
    if (cnpj && cnpj.length !== 14) erros.push(`${papel}.cnpj deve ter 14 dígitos`);
    if (cpf && cpf.length !== 11) erros.push(`${papel}.cpf deve ter 11 dígitos`);
    if (cnpj && !c.ie) erros.push(`${papel}.ie é obrigatória para PJ (use "ISENTO" se for o caso)`);
    if (!c.endereco?.logradouro || !c.endereco?.cidade || !/^[A-Z]{2}$/.test(c.endereco?.uf ?? '')) {
      erros.push(`${papel}.endereco precisa de logradouro, cidade e uf (2 letras)`);
    }
  }
  e.notas?.forEach((n, i) => {
    if (!n.numero || !n.serie) erros.push(`notas[${i}]: numero e serie são obrigatórios`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.emitidaEm ?? '')) erros.push(`notas[${i}].emitidaEm deve ser AAAA-MM-DD`);
    if ((n.tipo ?? 'NFE') !== 'ODF' && !n.chave) erros.push(`notas[${i}].chave é obrigatória para NF-e/CT-e (a LATAM recusa sem: "nfElectronic accessKey - is mandatory")`);
    if (n.chave && digitosMinuta(n.chave).length !== 44) erros.push(`notas[${i}].chave deve ter 44 dígitos`);
    if (!(n.valor > 0)) erros.push(`notas[${i}].valor deve ser maior que zero`);
  });
  e.volumes?.forEach((v, i) => {
    for (const campo of ['quantidade', 'pesoKg', 'alturaCm', 'larguraCm', 'comprimentoCm']) {
      if (!(v[campo] > 0)) erros.push(`volumes[${i}].${campo} deve ser maior que zero`);
    }
  });
  if (erros.length) {
    throw new LatamErro('DADOS_INVALIDOS', `e-Minuta inválida: ${erros.join('; ')}`, {
      detalhes: erros.map((d) => ({ codigo: 'VALIDACAO', descricao: d })),
    });
  }
}

/** O schema quer o nome em partes e só lastName é obrigatório. */
function dividirNome(nome) {
  const partes = nome.trim().split(/\s+/);
  const ultimo = partes.pop();
  return [el('firstName', partes.join(' ').slice(0, 60)), el('lastName', ultimo.slice(0, 60))];
}

function xmlCliente(tipo, c, pagador) {
  const cnpj = digitosMinuta(c.cnpj), cpf = digitosMinuta(c.cpf);
  const end = c.endereco;
  return el('Client', [
    el('Type', tipo),
    el('ContacInformation', [
      el('Name', dividirNome(c.nome)),
      el('email', c.email),
      c.telefone ? el('Phone', [el('countryCallingCode', '55'), el('areaCode', digitosMinuta(c.telefone.ddd)), el('phoneNumber', digitosMinuta(c.telefone.numero))]) : '',
      el('Address', [
        el('address', end.logradouro),
        el('addressNumber', end.numero ?? 'S/N'),
        el('additionalAddressData', end.complemento),
        el('district', end.bairro),
        el('city', [el('countryCode', 'BR'), el('name', end.cidade), el('stateCode', end.uf)]),
        el('zipCode', digitosMinuta(end.cep)),
        el('municipalCode', end.codigoMunicipio),
      ]),
    ]),
    el('isPayer', pagador ? 'true' : 'false'),
    // Pessoa física também vai em LegalPerson, com id=CPF. O <NaturalPerson> do manual é ignorado pela LATAM
    // (stg, 29/09/2026: "Destinatario - Id Type/Id Number/Customer Name is mandatory").
    el('LegalPerson', [
      cpf && !cnpj
        ? el('identification', [el('id', 'CPF'), el('code', cpf), el('description', 'CADASTRO PESSOA FISICA')])
        : el('identification', [el('id', 'CNPJ'), el('code', cnpj), el('description', 'CADASTRO NACIONAL PESSOA JURIDICA')]),
      el('fantasyName', (c.nomeFantasia ?? c.nome).slice(0, 60)),
      el('AditionalInfoBr', [el('ieCode', c.ie ?? (cnpj ? undefined : 'ISENTO')), el('cnaeCode', digitosMinuta(c.cnae))]),
    ]),
    c.codigoLatam ? el('CargoClient', [el('code', c.codigoLatam)]) : '',
  ]);
}

/** Monta o envelope SOAP completo do CreateEminutaRQ. Lança LatamErro('DADOS_INVALIDOS') se faltar algo. */
function montarXmlMinuta(e, opcoes = {}) {
  validarMinuta(e);
  const produto = e.produto ?? resolverServico(e.notas.reduce((s, n) => s + n.valor, 0), e.servico, opcoes.codigosServico, opcoes.regraServico).codigo;
  const mercadoria = e.mercadoria ?? MERCADORIA_PADRAO;
  const pagador = e.pagador ?? 'remetente';
  const papeis = [
    ['sender', 'remetente'], ['recipient', 'destinatario'], ['taker', 'tomador'], ['shipper', 'expedidor'], ['receiver', 'recebedor'],
  ];
  const tomador = e.tomador ?? e[pagador];
  const clientes = papeis
    .map(([tipo, campo]) => [tipo, campo === 'tomador' ? tomador : e[campo]])
    .filter(([, c]) => c)
    .map(([tipo, c]) => xmlCliente(tipo, c, tipo === 'taker'));

  const notas = e.notas.map((n) => {
    const tipo = n.tipo ?? 'NFE';
    return el('CargoBilling', [
      el('type', tipo),
      el('DocumentInformation', [
        el('number', digitosMinuta(n.numero)),
        el('emissionDate', n.emitidaEm),
        el('accessKey', digitosMinuta(n.chave)),
        el('code', tipo === 'ODF' ? n.codigoOdf ?? '00' : undefined),
      ]),
      el('DocumentSeries', [el('code', n.serie)]),
      n.cfop ? el('Fiscalnformation', [el('numberCFOP', n.cfop)]) : '',
      el('Amount', [
        el('totalValue', dec(n.valor, 2), { currencyCode: 'BRL' }),
        n.valorProdutos != null ? el('totalProducts', dec(n.valorProdutos, 2), { currencyCode: 'BRL' }) : '',
      ]),
    ]);
  });

  const volumes = e.volumes.map((v) => {
    const dims = [
      el('height', dec(v.alturaCm, 2), { unitDimentionCode: 'CM' }),
      el('length', dec(v.comprimentoCm, 2), { unitDimentionCode: 'CM' }),
      el('width', dec(v.larguraCm, 2), { unitDimentionCode: 'CM' }),
    ];
    return el('Packing', [
      el('Package', [
        el('Identificator', [el('code', v.embalagem ?? '28'), el('description', v.descricaoEmbalagem ?? (v.embalagem ? undefined : 'CAIXA DE PAPELAO'))]),
        el('Dimensions', dims),
      ]),
      el('Pieces', [
        el('quatity', v.quantidade),
        el('weight', dec(v.pesoKg, 3), { unitWeightCode: 'KG' }),
        el('Dimensions', dims),
      ]),
    ]);
  });

  const c = e.coleta;
  const coleta = el('Collect', [
    el('deliveryCode', simNao(e.entregaDomicilio)),
    el('code', simNao(Boolean(c))),
    c ? el('Attendant', [el('person', (c.atendente ?? c.solicitante).nome.slice(0, 30)), el('department', (c.atendente ?? c.solicitante).departamento.slice(0, 30))]) : '',
    c ? el('Requester', [el('department', c.solicitante.departamento.slice(0, 35)), el('person', c.solicitante.nome.slice(0, 35)), el('observation', c.observacao?.slice(0, 60))]) : '',
    c ? el('TimeRange', [el('initial', c.horaInicial ?? '08:00'), el('final', c.horaFinal ?? '18:00')]) : '',
    c ? el('AditionalInfo', [
      el('isLobbyAccepts', String(c.aceitaPortaria ?? false)),
      el('isCloseLunchTime', String(c.fechaAlmoco ?? true)),
      el('isHourLobby', String(c.aberto24h ?? false)),
    ]) : '',
  ]);

  const agora = dataHoraBrasilia(e.agora ?? new Date());
  const corpo = el('v3:CreateEminutaRQ', [
    el('Additional', [
      el('spotNumber', e.numeroSpot),
      el('promoCode', e.codigoPromocional),
      el('quotationNumber', e.numeroCotacao),
      el('batchId', e.lote?.slice(0, 12)),
    ]),
    el('ClientList', clientes),
    el('Document', [
      el('CargoBillingLists', notas),
      el('Insurance', [el('type', e.seguro.tipo), el('name', e.seguro.seguradora), el('number', e.seguro.apolice)]),
      el('Location', [el('isoCountryCode', 'BR'), el('StationIata', [el('origin', e.origem), el('destination', e.destino)])]),
      el('AditionaIInfo', [
        el('isMultiModal', 'false'),
        el('comercialProduct', produto),
        el('aditionalComment', e.observacao?.slice(0, 300)),
      ]),
    ]),
    el('Cargo', [
      el('PackingList', volumes),
      coleta,
      el('Treatment', [el('Commodity', [
        el('code', mercadoria.codigo),
        el('name', mercadoria.nome),
        el('groupCode', mercadoria.grupoCodigo),
        el('groupName', mercadoria.grupoNome),
      ])]),
    ]),
    el('Payment', [
      el('form', e.pagamento === 'DESTINO' ? '1' : '0', { currencyCode: 'BRL' }),
      e.formaPagamento ? el('Information', [el('typeCode', e.formaPagamento.tipo), el('accountNumber', e.formaPagamento.conta)]) : '',
    ]),
    el('Audit', [el('Datetime', [el('ta', agora)]), el('user', e.usuario ?? 'CLIENTE_WEB'), el('action', 'CREATE')]),
  ]);

  return envelope({ v3: NS_EMINUTA }, corpo);
}

/* ============================ cliente.ts (recorte) ============================ */

const BASES = {
  prod: 'https://prd.services.esales.com.br/broker/latam/api/v1',
  hmg: 'https://stg.services.esales.com.br/broker/latam/api/v1',
  uat: 'https://uat.services.esales.com.br/broker/latam/api/v1',
};
const NS_LAN = 'http://webservices.lan.com/XML';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const digitosCliente = (s) => (s ?? '').replace(/\D/g, '');
const pareceTimeout = (s) => /time ?out|timed out|tempo esgotado|indispon|unavailable/i.test(s);
const pareceNaoEncontrado = (s) => /n[aã]o (foi )?encontrad|nenhum|not found|no se encontr|no existe|n[aã]o é uma ordem/i.test(s);

class LatamCargo {
  constructor(opcoes) {
    if (!opcoes.usuario || !opcoes.senha) throw new LatamErro('CREDENCIAL', 'Informe usuário e senha fornecidos pela eSales/LATAM');
    this.base = BASES[opcoes.ambiente || 'prod'];
    this.auth = 'Basic ' + Buffer.from(`${opcoes.usuario}:${opcoes.senha}`).toString('base64');
    this.opcoes = {
      codigosServico: { ...CODIGOS_SERVICO_PADRAO, ...opcoes.codigosServico },
      regraServico: opcoes.regraServico || REGRA_SERVICO_PADRAO,
      timeoutMs: opcoes.timeoutMs ?? 40_000,
      tentativas: opcoes.tentativas ?? 3,
    };
  }

  /** Verificação de segurança pré/pós emissão: existe rastreio pra essa chave de NF-e? (sem normalizar tudo — só o essencial pra decidir se reenvia ou não). */
  async verificarPorChaveNfe(chaveNfe) {
    const chave = digitosCliente(chaveNfe);
    if (chave.length !== 44) throw new LatamErro('DADOS_INVALIDOS', `Chave NF-e deve ter 44 dígitos (recebido: ${chave.length})`);
    const xml = envelope({ ns: NS_LAN }, el('ns:DisplayCargoDocumentTrackingDetailsBrRQ', [el('fiscalDocumentAccesKey', chave)]));
    const raiz = await this.chamar('tracking', xml, { 'Content-Type': 'application/xml;charset=UTF-8' });
    const rs = buscar(raiz, 'DisplayCargoDocumentTrackingDetailsBrRS') || raiz;
    const detalhes = filhos(rs, 'CargoDocumentTrackingDetail');
    if (!detalhes.length) {
      const st = this.status(rs);
      const msg = `${st.message || ''} ${st.nativeMessage || ''}`;
      if (!st.code || st.code === '0' || st.code === '-58' || /SHP_TRACK_FLD_SHP/.test(msg) || pareceNaoEncontrado(msg)) {
        return { encontrado: false, awb: null, ultimoEvento: null };
      }
      throw this.erroDeStatus(st);
    }
    const principal = detalhes[0];
    const id = filho(principal, 'CargoDocumentId');
    const prefixo = texto(id, 'prefix'), numero = texto(id, 'number');
    const eventos = filhos(filho(principal, 'CargoDocumentTrackingEventList'), 'CargoDocumentTrackingEvent');
    const ultimo = eventos.at(-1);
    return {
      encontrado: true,
      awb: numero ? `${prefixo || ''}-${numero}` : null,
      ultimoEvento: ultimo ? { descricao: texto(ultimo, 'eventDescription'), data: texto(ultimo, 'eventDate') } : null,
    };
  }

  /**
   * Cria a e-Minuta. NÃO repete em caso de falha (evita minuta duplicada):
   * se der INDISPONIVEL/timeout, confira com verificarPorChaveNfe antes de reenviar.
   */
  async emitirMinuta(dados) {
    const xml = montarXmlMinuta(dados, { codigosServico: this.opcoes.codigosServico, regraServico: this.opcoes.regraServico });
    let raiz;
    try {
      raiz = await this.chamar('eminuta', xml, { 'Content-Type': 'text/xml;charset=UTF-8' }, 1);
    } catch (e) {
      if (e instanceof LatamErro && e.tipo === 'INDISPONIVEL') {
        throw new LatamErro('INDISPONIVEL', `${e.message} — a minuta PODE ter sido criada; confira pelo rastreio da NF antes de reenviar`, { status: e.status });
      }
      throw e;
    }
    const rs = buscar(raiz, 'CreateEminutaRS') || raiz;
    const st = this.status(rs);
    const id = buscar(rs, 'CargoDocumentId');
    const prefixo = texto(id, 'prefix'), numero = texto(id, 'number');
    const code = Number(st.code ?? (numero ? 0 : -1));

    if (code < 0 || !numero) {
      // Formato real (stg, 29/09/2026): vários <Error><errorCode>-100</errorCode><errorDescription>…</errorDescription></Error>
      // com ServiceStatus code 0. O manual fala em <Errors><codeError>/<descriptionError>; aceitamos os dois.
      const blocos = [...filhos(rs, 'Error'), ...filhos(rs, 'Errors'), ...filhos(buscar(rs, 'Response'), 'Errors')];
      const detalhes = blocos.map((e) => ({
        codigo: texto(e, 'errorCode') || texto(e, 'codeError') || '',
        descricao: [texto(e, 'errorDescription'), texto(e, 'descriptionError'), texto(e, 'description')].filter(Boolean).join(' — '),
      }));
      const msg = [st.message, ...detalhes.map((d) => `${d.codigo} ${d.descricao}`)].filter(Boolean).join('; ') || 'e-Minuta recusada sem descrição';
      throw new LatamErro(pareceTimeout(`${msg} ${st.nativeMessage || ''}`) ? 'INDISPONIVEL' : 'DADOS_INVALIDOS', msg, { codigoLatam: st.code, detalhes });
    }
    return {
      minuta: prefixo ? `${prefixo}-${numero}` : numero,
      prefixo: prefixo || '',
      numero,
      aviso: code > 0 ? st.message || `Aviso ${code}` : null,
      xmlEnviado: xml,
    };
  }

  status(no) {
    const s = buscar(no, 'ServiceStatus');
    return { code: texto(s, 'code'), message: texto(s, 'message'), nativeMessage: texto(s, 'nativeMessage') };
  }

  erroDeStatus(st) {
    const msg = st.message ?? `ServiceStatus ${st.code}`;
    const tipo = !pareceTimeout(`${msg} ${st.nativeMessage || ''}`) && Number(st.code) < 0 ? 'DADOS_INVALIDOS' : 'INDISPONIVEL';
    return new LatamErro(tipo, `LATAM ${st.code}: ${msg.slice(0, 300)}`, { codigoLatam: st.code });
  }

  /** POST SOAP com timeout e novas tentativas (1 s, 2 s, 4 s…) em falha de rede ou 5xx sem SOAP Fault. */
  async chamar(servico, xml, headers, tentativas = this.opcoes.tentativas) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      let status, corpo;
      try {
        const res = await fetch(`${this.base}/${servico}`, {
          method: 'POST',
          headers: { Authorization: this.auth, 'LAN-ApplicationName': '1', SOAPAction: '""', ...headers },
          body: xml,
          signal: AbortSignal.timeout(this.opcoes.timeoutMs),
        });
        status = res.status;
        corpo = await res.text();
      } catch (e) {
        ultimoErro = new LatamErro('INDISPONIVEL', `Falha de comunicação com a LATAM (${servico}): ${e?.message ?? e}`);
        if (tentativa < tentativas) await esperar(1000 * 2 ** (tentativa - 1));
        continue;
      }

      // O broker da eSales responde JSON aqui: 401 "Usuário e senha inválidos" e 404 "Usuário com userName: x não encontrado"
      if (status === 401 || (status === 404 && /usu[aá]rio/i.test(corpo))) {
        throw new LatamErro('CREDENCIAL', `Usuário/senha recusados pela eSales/LATAM (${servico}): ${corpo.slice(0, 200)}`, { status });
      }
      if (status === 403) throw new LatamErro('SEM_PERMISSAO', `Usuário sem acesso ao serviço ${servico}`, { status });

      const raiz = lerXml(corpo);
      const fault = buscar(raiz, 'Fault');
      if (fault) {
        const msg = texto(fault, 'faultstring') || texto(fault, 'Reason', 'Text') || 'SOAP Fault sem descrição';
        throw new LatamErro(pareceTimeout(msg) ? 'INDISPONIVEL' : 'DADOS_INVALIDOS', `LATAM (${servico}): ${msg}`, { status });
      }
      if (status >= 500 || !buscar(raiz, 'Body')) {
        ultimoErro = new LatamErro('INDISPONIVEL', `LATAM (${servico}) respondeu HTTP ${status}: ${corpo.slice(0, 200)}`, { status });
        if (status >= 500 && tentativa < tentativas) { await esperar(1000 * 2 ** (tentativa - 1)); continue; }
        if (status >= 400 && status < 500) throw new LatamErro('DADOS_INVALIDOS', `LATAM (${servico}) respondeu HTTP ${status}: ${corpo.slice(0, 200)}`, { status });
        throw ultimoErro;
      }
      return raiz;
    }
    throw ultimoErro;
  }
}

/* ============================ index.ts (camada do hub) ============================ */

// Remetente/tomador fixos — dados da empresa, não são segredo. Tomador é
// SEMPRE o remetente (decisão do usuário: SeuBoné paga o frete em 100% dos
// casos) — por isso nunca informamos `tomador`/`pagador` na EmissaoMinuta:
// o próprio módulo já reaproveita o remetente como tomador quando nenhum
// dos dois é passado (comportamento padrão da lib, não um caso especial).
// IE vem de env (LATAM_CARGO_IE_SEUBONE) só porque ainda não foi confirmada
// — assim que confirmada, dá pra fixar aqui igual o resto do endereço.
function remetente(env) {
  return {
    nome: 'SEUBONE COM BONES PERSONALIZADOS LTDA',
    cnpj: '36153457000183',
    ie: alfanumerico(env && env.latamCargoIeSeubone) || 'ISENTO',
    endereco: { cep: '59064510', logradouro: 'Rua Lafayete Lamartine', numero: '1945', bairro: 'Candelária', cidade: 'Natal', uf: 'RN' },
  };
}

/* ============================ localizacao.ts (recorte) ============================ */

// Aeroportos atendidos pela LATAM Cargo no Brasil — tabela do próprio manual
// da e-Minuta (portada de latam-cargo-crm/src/localizacao.ts). Usada pro
// seletor de "retirada no aeroporto" no formulário do hub.
const AEROPORTOS = {
  AJU: 'Aracaju', AUX: 'Araguaína', BEL: 'Belém', BNU: 'Blumenau', BPS: 'Porto Seguro', BRA: 'Barreiras',
  BSB: 'Brasília', BVB: 'Boa Vista', CAC: 'Cascavel', CGB: 'Cuiabá', CGH: 'São Paulo (Congonhas)',
  CGR: 'Campo Grande', CLV: 'Caldas Novas', CNF: 'Belo Horizonte (Confins)', CWB: 'Curitiba', CXJ: 'Caxias do Sul',
  FLN: 'Florianópolis', FOR: 'Fortaleza', GIG: 'Rio de Janeiro (Galeão)', GRU: 'São Paulo (Guarulhos)', GYN: 'Goiânia',
  IGU: 'Foz do Iguaçu', IMP: 'Imperatriz', IOS: 'Ilhéus', JJG: 'Jaguaruna', JOI: 'Joinville', JPA: 'João Pessoa',
  JTC: 'Bauru', LDB: 'Londrina', MAB: 'Marabá', MAO: 'Manaus', MCP: 'Macapá', MCZ: 'Maceió', MGF: 'Maringá',
  NAT: 'Natal', NVT: 'Navegantes', PLU: 'Belo Horizonte (Pampulha)', PMW: 'Palmas', POA: 'Porto Alegre',
  PVH: 'Porto Velho', QSB: 'São Bernardo do Campo', RAO: 'Ribeirão Preto', RBR: 'Rio Branco', REC: 'Recife',
  ROO: 'Rondonópolis', SDU: 'Rio de Janeiro (Santos Dumont)', SJK: 'São José dos Campos', SJP: 'São José do Rio Preto',
  SLZ: 'São Luís', SSA: 'Salvador', STM: 'Santarém', THE: 'Teresina', UDI: 'Uberlândia', VCP: 'Campinas (Viracopos)',
  VDC: 'Vitória da Conquista', VIX: 'Vitória', XAP: 'Chapecó',
};

// Aeroporto LATAM Cargo mais próximo por UF — usado quando a entrega é no
// domicílio do destinatário (o operador não escolhe manualmente; o sistema
// preenche sozinho a partir da UF do endereço, decisão do usuário). Sempre
// o hub/capital do estado dentre os aeroportos da tabela acima.
const AEROPORTO_POR_UF = {
  AC: 'RBR', AL: 'MCZ', AM: 'MAO', AP: 'MCP', BA: 'SSA', CE: 'FOR', DF: 'BSB', ES: 'VIX', GO: 'GYN',
  MA: 'SLZ', MG: 'CNF', MS: 'CGR', MT: 'CGB', PA: 'BEL', PB: 'JPA', PE: 'REC', PI: 'THE', PR: 'CWB',
  RJ: 'GIG', RN: 'NAT', RO: 'PVH', RR: 'BVB', RS: 'POA', SC: 'FLN', SE: 'AJU', SP: 'GRU', TO: 'PMW',
};

function aeroportoMaisProximo(uf) {
  return AEROPORTO_POR_UF[String(uf || '').toUpperCase()] || null;
}

// Serviços liberados pro seletor manual no hub — STANDARD/VELOZ ficam de
// fora da lista enquanto não tiverem código configurado (ver produtos.ts).
const SERVICOS_MANUAIS = ['EFACIL', 'PROXIMO_VOO', 'JUNTOS'];

// Regra automática do SeuBoné: até R$3.000 → EFACIL, acima → JUNTOS (não
// STANDARD — decisão do usuário, já que o código do STANDARD ainda não foi
// configurado pela LATAM; JUNTOS já tem código confirmado, então a regra
// automática nunca fica bloqueada esperando configuração).
const REGRA_SERVICO_SEUBONE = { limite: 3000, ateOLimite: 'EFACIL', acimaDoLimite: 'JUNTOS' };

let cliente = null;
/** Só para testes: troca o cliente (ex.: com fetch simulado) */
function definirCliente(c) { cliente = c; }

function obterCliente(env) {
  if (cliente) return cliente;
  if (!env.latamCargoUsuario || !env.latamCargoSenha) {
    throw new LatamErro('CREDENCIAL', 'Integração com a LATAM Cargo sem configuração', { detalhes: [{ codigo: 'CONFIG', descricao: 'Configure LATAM_CARGO_USUARIO e LATAM_CARGO_SENHA' }] });
  }
  cliente = new LatamCargo({
    usuario: env.latamCargoUsuario,
    senha: env.latamCargoSenha,
    ambiente: env.latamCargoAmbiente || 'prod',
    codigosServico: env.latamCargoCodigoStandard ? { STANDARD: env.latamCargoCodigoStandard } : undefined,
    regraServico: REGRA_SERVICO_SEUBONE,
  });
  return cliente;
}

const texto2 = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** A LATAM recusa ieCode com pontuação ("should be alphanumeric value" — confirmado em
 * teste real 30/09/2026: "20.535.768-7" falha, "205357687" e "ISENTO" passam). Tira tudo
 * que não é letra/número — nunca depender de alguém digitar certo, nem no .env nem no form. */
const alfanumerico = (v) => String(v ?? '').replace(/[^a-zA-Z0-9]/g, '').trim();
/** '17,5' / '17.5' / '1.234,50' → número (ponto só é separador de milhar quando também há vírgula) */
const numero2 = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/** Converte o formulário (chaves em português, tudo string) num ClienteMinuta — detecta CPF vs CNPJ pelo tamanho. */
function montarCliente(bruta) {
  const doc = (bruta.cpfCnpj || '').replace(/\D/g, '');
  const ehCnpj = doc.length === 14;
  return {
    nome: texto2(bruta.nome) || '',
    cnpj: ehCnpj ? doc : undefined,
    cpf: !ehCnpj ? doc : undefined,
    ie: ehCnpj ? (alfanumerico(bruta.ie) || 'ISENTO') : undefined,
    email: texto2(bruta.email),
    telefone: texto2(bruta.telefone) ? { numero: (bruta.telefone || '').replace(/\D/g, '') } : undefined,
    endereco: {
      cep: (bruta.endereco?.cep || '').replace(/\D/g, ''),
      logradouro: texto2(bruta.endereco?.logradouro) || '',
      numero: texto2(bruta.endereco?.numero),
      complemento: texto2(bruta.endereco?.complemento),
      bairro: texto2(bruta.endereco?.bairro),
      cidade: texto2(bruta.endereco?.cidade) || '',
      uf: (texto2(bruta.endereco?.uf) || '').toUpperCase(),
    },
  };
}

/** Converte o corpo do formulário do hub em EmissaoMinuta pronta para validar/montar/emitir. Não chama a LATAM. */
function montar(bruta, env) {
  const e = bruta || {};
  const destinatario = montarCliente(e.destinatario || {});
  const notas = [{
    numero: texto2(e.nota?.numero) || '',
    serie: texto2(e.nota?.serie) || '',
    emitidaEm: texto2(e.nota?.emitidaEm) || '',
    chave: texto2(e.nota?.chave),
    valor: numero2(e.nota?.valor),
  }];
  const volumes = (e.volumes || [])
    .filter((v) => texto2(String(v.quantidade ?? '')) || texto2(String(v.pesoKg ?? '')))
    .map((v) => ({
      quantidade: numero2(v.quantidade),
      pesoKg: numero2(v.pesoKg),
      alturaCm: numero2(v.alturaCm),
      larguraCm: numero2(v.larguraCm),
      comprimentoCm: numero2(v.comprimentoCm),
    }));
  const valorTotalNotas = notas.reduce((s, n) => s + (Number.isFinite(n.valor) ? n.valor : 0), 0);
  const servicoManual = texto2(e.servico) && e.servico !== 'AUTOMATICO' ? e.servico : undefined;

  const entregaDomicilio = !!e.entregaDomicilio;
  // Domicílio: o destino é sempre o aeroporto LATAM mais próximo da UF do
  // destinatário (decisão do usuário — não é escolha manual nesse modo,
  // fica definido pelo próprio sistema). Retirada: vem do seletor do form.
  const destino = entregaDomicilio
    ? aeroportoMaisProximo(destinatario.endereco.uf) || ''
    : (texto2(e.destino) || '').toUpperCase();

  const envio = {
    remetente: remetente(env),
    destinatario,
    // tomador/pagador de propósito omitidos: tomador sempre = remetente (ver comentário na função remetente()).
    origem: (env && env.latamCargoOrigemIata) || 'NAT',
    destino,
    servico: servicoManual,
    notas,
    volumes,
    seguro: { tipo: Number(e.seguroTipo) || undefined },
    pagamento: e.pagamento === 'DESTINO' ? 'DESTINO' : 'ORIGEM',
    entregaDomicilio,
    observacao: texto2(e.observacao),
  };
  return { envio, valorTotalNotas };
}

/** Mostra o que vai ser emitido (serviço sugerido/escolhido, XML que seria enviado). NÃO chama a LATAM. */
function previa(bruta, env) {
  const { envio, valorTotalNotas } = montar(bruta, env);
  let escolha;
  try {
    escolha = resolverServico(valorTotalNotas, envio.servico, obterCliente(env).opcoes.codigosServico, obterCliente(env).opcoes.regraServico);
  } catch (err) {
    if (err instanceof LatamErro) throw new ErroMinuta('SERVICO', err.message, err.detalhes);
    throw err;
  }
  try {
    montarXmlMinuta(envio, { codigosServico: obterCliente(env).opcoes.codigosServico, regraServico: obterCliente(env).opcoes.regraServico });
  } catch (err) {
    if (err instanceof LatamErro) throw new ErroMinuta('VALIDACAO', err.message, err.detalhes);
    throw err;
  }
  return {
    remetente: envio.remetente,
    destinatario: envio.destinatario,
    origem: envio.origem,
    destino: envio.destino,
    notas: envio.notas,
    volumes: envio.volumes,
    valorTotalNotas,
    servico: { codigo: escolha.servico, nome: escolha.nome, produtoLatam: escolha.codigo, automatico: escolha.automatico, motivo: escolha.motivo },
    seguroTipo: envio.seguro.tipo,
    pagamento: envio.pagamento,
    entregaDomicilio: envio.entregaDomicilio,
    observacao: envio.observacao,
  };
}

/** Cria a e-Minuta de verdade (objeto REAL, AWB rastreável no contrato). */
async function emitir(bruta, env) {
  const { envio } = montar(bruta, env);
  try {
    return await obterCliente(env).emitirMinuta(envio);
  } catch (e) {
    throw traduzir(e);
  }
}

/** Verificação de segurança: já existe rastreio pra essa chave de NF-e? (usar antes de reenviar após INDISPONIVEL). */
async function verificarPorChaveNfe(chaveNfe, env) {
  try {
    return await obterCliente(env).verificarPorChaveNfe(chaveNfe);
  } catch (e) {
    throw traduzir(e);
  }
}

class ErroMinuta extends Error {
  constructor(tipo, mensagem, detalhes) {
    super(mensagem);
    this.name = 'ErroMinuta';
    this.tipo = tipo; // 'VALIDACAO'|'SERVICO'|'CREDENCIAL'|'INDISPONIVEL'
    this.detalhes = detalhes || [];
  }
}

function traduzir(e) {
  if (e instanceof ErroMinuta) return e;
  if (!(e instanceof LatamErro)) return e;
  switch (e.tipo) {
    case 'DADOS_INVALIDOS': {
      const temSemCodigo = e.detalhes?.some((d) => d.codigo === 'SERVICO_SEM_CODIGO');
      return new ErroMinuta(temSemCodigo ? 'SERVICO' : 'VALIDACAO', `A LATAM recusou: ${e.message}`, e.detalhes);
    }
    case 'CREDENCIAL':
    case 'SEM_PERMISSAO': return new ErroMinuta('CREDENCIAL', 'A integração com a LATAM está sem acesso no momento', [{ codigo: e.tipo, descricao: e.message }]);
    default: return new ErroMinuta('INDISPONIVEL', e.message, e.detalhes);
  }
}

module.exports = {
  LatamErro, LatamCargo, ErroMinuta,
  remetente, SERVICOS_MANUAIS, NOMES_SERVICO, CODIGOS_SERVICO_PADRAO,
  AEROPORTOS, AEROPORTO_POR_UF, aeroportoMaisProximo,
  previa, emitir, verificarPorChaveNfe, definirCliente,
  montarXmlMinuta, resolverServico, sugerirServico, servicosDisponiveis,
};
