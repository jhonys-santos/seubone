// Entrega (transportadora) de um ticket de Erro de Envio: o retrato que veio da Lulu (alertas,
// situação, previsão) + o rastreio consultado direto na API da transportadora (Azul, Correios ou
// LATAM). Só existe com TICKETS_BACKEND=db.
const db = require('../db');
const env = require('../config/env');

const COOLDOWN_CONSULTA_MS = 15000;
const ultimaConsulta = new Map(); // rowIndex -> instante da última chamada à transportadora (protege a API de cliques repetidos)

const txt = (v) => String(v == null ? '' : v).trim();
const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

// ── Transportadoras ──────────────────────────────────────────────────────────
// Cada uma sabe: reconhecer o código de rastreio, dizer se o hub tem acesso configurado e consultar
// (devolvendo o rastreio já no formato único mostrado na tela, ou null quando não há registro).
let clienteAzul = null;
let clienteLatam = null;

const PROVEDORES = {
  azul: {
    nome: 'Azul',
    codigoValido: (c) => /^577-?\d{8}$/.test(c),
    configurado: () => !!(env.azulToken || (env.azulEmail && env.azulSenha)),
    async consultar(codigo) {
      if (!clienteAzul) {
        const { AzulRastreio } = require('./azulRastreio');
        clienteAzul = new AzulRastreio({ token: env.azulToken, email: env.azulEmail, senha: env.azulSenha });
      }
      const r = await clienteAzul.rastrearPorAwb(codigo);
      return r && resumirRastreioAzul(r);
    },
    configFaltando: 'AZUL_TOKEN',
  },
  correios: {
    nome: 'Correios',
    codigoValido: (c) => /^[A-Za-z]{2}\d{9}[A-Za-z]{2}$/.test(c),
    configurado: () => !!(env.correiosUsuario && env.correiosCodigoAcesso && /^\d{10}$/.test(env.correiosCartao || '')),
    async consultar(codigo) {
      const etiqueta = require('./correiosEtiqueta.service');
      const r = await require('./correiosRastreio').rastrear(etiqueta.obterCliente(env), codigo, etiqueta.CorreiosErro);
      return r && resumirRastreioCorreios(r);
    },
    configFaltando: 'CORREIOS_USUARIO, CORREIOS_CODIGO_ACESSO e CORREIOS_CARTAO',
  },
  latam: {
    nome: 'LATAM',
    codigoValido: (c) => /^957-?\d{8}$/.test(c),
    configurado: () => !!(env.latamCargoUsuario && env.latamCargoSenha),
    async consultar(codigo) {
      if (!clienteLatam) {
        const { LatamRastreio } = require('./latamRastreio/cliente');
        clienteLatam = new LatamRastreio({ usuario: env.latamCargoUsuario, senha: env.latamCargoSenha, ambiente: env.latamCargoAmbiente || 'prod' });
      }
      const r = await clienteLatam.rastrearPorAwb(codigo);
      return r && resumirRastreioLatam(r);
    },
    configFaltando: 'LATAM_CARGO_USUARIO e LATAM_CARGO_SENHA',
  },
};
/** Só para testes: troca a função de consulta de uma transportadora. */
function definirConsulta(chave, fn) { PROVEDORES[chave].consultar = fn; }

/** Qual provedor atende este ticket: o da transportadora que a Lulu informou (ou deduzido pelo formato do código). */
function provedorDe(transportadora, codigo) {
  const c = txt(codigo);
  if (!c) return null;
  const t = txt(transportadora).toLowerCase();
  if (t && PROVEDORES[t]) return PROVEDORES[t].codigoValido(c) ? t : null;
  if (t) return null; // transportadora que não temos (ex.: Jadlog)
  return Object.keys(PROVEDORES).find((k) => PROVEDORES[k].codigoValido(c)) || null;
}

function deduzirTransportadora(lulu, codigo) {
  const t = txt(lulu && lulu.transportadora).toLowerCase();
  if (t) return t;
  return Object.keys(PROVEDORES).find((k) => PROVEDORES[k].codigoValido(txt(codigo))) || '';
}

/** Nome da transportadora como aparece no campo Fábrica do ticket ("Azul", "LATAM", "Correios"). */
function nomeParaFabrica(transportadora, codigo) {
  const t = txt(transportadora).toLowerCase() || deduzirTransportadora(null, codigo);
  if (PROVEDORES[t]) return PROVEDORES[t].nome;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

// ── Retrato da Lulu ──────────────────────────────────────────────────────────
/** Card do endpoint "alerta de entrega" da Lulu -> o pedaço que interessa guardar. */
function resumirCardLulu(card) {
  return {
    transportadora: txt(card.transportadora).toLowerCase(),
    codigoRastreio: txt(card.codigo_rastreio),
    situacao: txt(card.situacao),
    previsaoEntrega: txt(card.previsao_entrega) || null,
    ultimaConsulta: txt(card.ultima_consulta) || null,
    emAlertaDesde: txt(card.em_alerta_desde) || null,
    alertas: (card.alertas || []).map((a) => ({
      codigo: txt(a.codigo),
      descricao: txt(a.descricao),
      categoria: txt(a.categoria),
      ocorridaEm: txt(a.ocorrida_em) || null,
      local: txt(a.local),
      fotoInsucesso: txt(a.foto_insucesso) || null,
    })),
  };
}

async function salvarLulu(rowIndex, card, q = db) {
  const n = inteiro(rowIndex);
  if (n == null) return;
  await q.query(
    `insert into ticket_entrega (ticket_row_index, lulu, lulu_atualizado_em) values ($1, $2::jsonb, now())
     on conflict (ticket_row_index) do update set lulu = excluded.lulu, lulu_atualizado_em = now()`,
    [n, JSON.stringify(resumirCardLulu(card))],
  );
  // O código de rastreio e a previsão da transportadora podem só ter aparecido na Lulu depois que o ticket
  // foi aberto: preenche o que estiver vazio (nunca troca um valor que já existe).
  const codigo = txt(card.codigo_rastreio);
  const nomeTransp = nomeParaFabrica(card.transportadora, codigo);
  if (nomeTransp) await q.query(`update tickets set fabrica = $2 where row_index = $1 and fabrica = ''`, [n, nomeTransp]); // só preenche vazio
  if (codigo) await q.query(`update tickets set codigo_rastreio = $2 where row_index = $1 and codigo_rastreio = ''`, [n, codigo]);
  const previsao = require('./ticketsDb.service').paraTimestampBrasilia(card.previsao_entrega);
  if (previsao) await q.query('update tickets set previsao_entrega_transportadora = $2::timestamp where row_index = $1 and previsao_entrega_transportadora is null', [n, previsao]);
}

/**
 * Tickets antigos de Erro de Envio traziam as ocorrências escritas à mão no campo Observação ("Situação: ...").
 * Esse texto passa a aparecer no cartão "Entrega"; aqui o campo é esvaziado e o texto original fica guardado em
 * ticket_entrega.observacao_original (nada se perde). Só mexe no texto automático: o que alguém escreveu fica.
 */
async function liberarObservacoesAutomaticas() {
  return db.transaction(async (tx) => {
    const r = await tx.query(
      `select row_index::int as ri, observacao from tickets where identificador = 'Erro de Envio' and observacao like 'Situação: %'`,
    );
    for (const x of r.rows) {
      await tx.query(
        `insert into ticket_entrega (ticket_row_index, observacao_original) values ($1, $2)
         on conflict (ticket_row_index) do update set observacao_original = coalesce(ticket_entrega.observacao_original, excluded.observacao_original)`,
        [x.ri, x.observacao],
      );
      await tx.query(`update tickets set observacao = '' where row_index = $1`, [x.ri]);
    }
    return r.rows.length;
  });
}

/**
 * Em Erro de Envio, o campo Fábrica passa a mostrar a transportadora (Azul, LATAM, Correios). Preenche os tickets
 * que ainda estão com Fábrica vazia (pela Lulu ou, na falta dela, pelo formato do código); nunca troca o que alguém escolheu.
 */
async function preencherFabricaComTransportadora() {
  const r = await db.query(
    `select t.row_index::int as ri, t.codigo_rastreio as codigo, e.lulu from tickets t left join ticket_entrega e on e.ticket_row_index = t.row_index
      where t.identificador = 'Erro de Envio' and t.fabrica = ''`);
  let n = 0;
  for (const x of r.rows) {
    const nome = nomeParaFabrica(x.lulu && x.lulu.transportadora, x.codigo || (x.lulu && x.lulu.codigoRastreio));
    if (!nome) continue;
    await db.query(`update tickets set fabrica = $2 where row_index = $1 and fabrica = ''`, [x.ri, nome]);
    n++;
  }
  return n;
}

// ── Rastreio da transportadora: formato único para a tela ───────────────────
const SEM_FOTOS = { insucesso: null, comprovante: null, assinatura: null };

function resumirRastreioAzul(r) {
  return {
    codigo: r.awb,
    situacao: r.situacao,
    previsaoEntrega: r.previsaoEntrega,
    entregueEm: r.entregueEm,
    previsaoVencida: !!r.previsaoVencida,
    recebedor: r.recebedor || null,
    localizacao: null,
    ocorrencias: r.ocorrencias.map((o) => ({
      codigo: o.codigo, descricao: o.descricao, comentario: '', dataHora: o.dataHora, // o comentário da Azul é texto técnico (rota, motorista, coordenadas): não vai para a tela
      unidade: o.unidade, municipio: o.municipio, uf: o.uf, categoria: o.categoria, alerta: !!o.alerta, fotos: o.fotos || SEM_FOTOS,
    })),
  };
}

function resumirRastreioCorreios(r) {
  return {
    codigo: r.codigo,
    situacao: r.situacao,
    previsaoEntrega: r.previsaoEntrega,
    entregueEm: r.entregueEm,
    previsaoVencida: !!r.previsaoVencida,
    recebedor: null,
    localizacao: null,
    ocorrencias: r.ocorrencias.map((o) => ({
      codigo: o.codigo, descricao: o.descricao, comentario: o.detalhe || '', dataHora: o.dataHora,
      unidade: o.unidade, municipio: o.municipio, uf: o.uf, categoria: o.categoria, alerta: !!o.alerta, fotos: SEM_FOTOS,
    })),
  };
}

function resumirRastreioLatam(r) {
  const { cidadeDoAeroporto } = require('./latamRastreio/localizacao');
  return {
    codigo: r.awb,
    situacao: r.situacao,
    previsaoEntrega: r.previsaoEntrega || null, // a LATAM não informa previsão
    entregueEm: r.entregueEm,
    previsaoVencida: false,
    recebedor: r.recebedor || null,
    localizacao: (r.localizacao && r.localizacao.texto) || null,
    ocorrencias: r.ocorrencias.map((o) => ({
      codigo: o.codigo, descricao: o.descricao, comentario: o.voo ? `Voo ${o.voo}` : '', dataHora: o.dataHora,
      unidade: o.aeroporto || null, municipio: cidadeDoAeroporto(o.aeroporto), uf: null, categoria: o.categoria, alerta: !!o.alerta, fotos: SEM_FOTOS,
    })),
  };
}

// ── Leitura e consulta ───────────────────────────────────────────────────────
async function carregarTicket(n) {
  const r = await db.query(
    `select row_index::int as "rowIndex", identificador, codigo_rastreio as "codigoRastreio" from tickets where row_index = $1`, [n]);
  return r.rows[0] || null;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

function montarResposta(ticket, linha) {
  const lulu = (linha && linha.lulu) || null;
  const codigo = txt(ticket.codigoRastreio) || txt(lulu && lulu.codigoRastreio);
  const transportadora = deduzirTransportadora(lulu, codigo);
  const provedor = provedorDe(transportadora, codigo);
  return {
    ok: true,
    entrega: {
      transportadora,
      nomeTransportadora: (PROVEDORES[transportadora] && PROVEDORES[transportadora].nome) || '',
      codigoRastreio: codigo,
      podeConsultar: !!provedor && PROVEDORES[provedor].configurado(),
      lulu,
      luluAtualizadoEm: iso(linha && linha.lulu_atualizado_em),
      rastreio: (linha && linha.rastreio) || null,
      rastreioFonte: (linha && linha.rastreio_fonte) || null,
      rastreioConsultadoEm: iso(linha && linha.rastreio_consultado_em),
    },
  };
}

async function ler(rowIndex) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: false, erro: 'rowIndex ausente' };
  const ticket = await carregarTicket(n);
  if (!ticket) return { ok: false, erro: 'Ticket não encontrado.' };
  const r = await db.query('select lulu, lulu_atualizado_em, rastreio, rastreio_fonte, rastreio_consultado_em from ticket_entrega where ticket_row_index = $1', [n]);
  return montarResposta(ticket, r.rows[0]);
}

function mensagemDeErro(nome, e) {
  const t = e && e.tipo;
  if (t === 'CREDENCIAL') return `A ${nome} recusou o acesso do hub (credencial inválida ou vencida). Avise o time técnico.`;
  if (t === 'SEM_PERMISSAO') return `O acesso do hub à ${nome} não tem permissão para esse envio (outro CNPJ ou recurso não liberado).`;
  if (t === 'DADOS_INVALIDOS') return `A ${nome} não aceitou esse código de rastreio.`;
  if (t === 'LIMITE') return `A ${nome} limitou as consultas por agora. Tente de novo em alguns minutos.`;
  if (t === 'INDISPONIVEL') return `A ${nome} não respondeu agora. Tente de novo em instantes.`;
  return `Falha ao consultar a ${nome}: ${(e && e.message) || e}`;
}

/** Consulta a transportadora do ticket agora, guarda o resultado e devolve o cartão atualizado. */
async function consultar(rowIndex, agora = Date.now()) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: false, erro: 'rowIndex ausente' };
  const ticket = await carregarTicket(n);
  if (!ticket) return { ok: false, erro: 'Ticket não encontrado.' };
  const e = (await ler(n)).entrega;
  if (!e.codigoRastreio) return { ok: false, erro: 'Este ticket ainda não tem código de rastreio.' };
  const chave = provedorDe(e.transportadora, e.codigoRastreio);
  if (!chave) return { ok: false, erro: 'A consulta direta só está disponível para envios pela Azul, Correios ou LATAM, com o código de rastreio no formato certo.' };
  const prov = PROVEDORES[chave];
  if (!prov.configurado()) return { ok: false, erro: `O acesso do hub à ${prov.nome} não está configurado (${prov.configFaltando}).` };

  const anterior = ultimaConsulta.get(n);
  if (anterior && agora - anterior < COOLDOWN_CONSULTA_MS) return { ok: false, erro: `Acabei de consultar a ${prov.nome} para este ticket. Aguarde alguns segundos.` };
  ultimaConsulta.set(n, agora);

  let resumo;
  try {
    resumo = await prov.consultar(e.codigoRastreio);
  } catch (err) {
    ultimaConsulta.delete(n); // falha não deve travar a próxima tentativa
    return { ok: false, erro: mensagemDeErro(prov.nome, err) };
  }
  if (!resumo) return { ok: false, erro: `A ${prov.nome} ainda não tem registro desse código de rastreio.` };

  await db.query(
    `insert into ticket_entrega (ticket_row_index, rastreio, rastreio_fonte, rastreio_consultado_em) values ($1, $2::jsonb, $3, now())
     on conflict (ticket_row_index) do update set rastreio = excluded.rastreio, rastreio_fonte = excluded.rastreio_fonte, rastreio_consultado_em = now()`,
    [n, JSON.stringify(resumo), chave],
  );
  return ler(n);
}

module.exports = {
  ler, consultar, salvarLulu, resumirCardLulu, liberarObservacoesAutomaticas, preencherFabricaComTransportadora, nomeParaFabrica,
  resumirRastreioAzul, resumirRastreioCorreios, resumirRastreioLatam,
  deduzirTransportadora, provedorDe, definirConsulta, COOLDOWN_CONSULTA_MS,
};
