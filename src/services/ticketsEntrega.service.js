// Entrega (transportadora) de um ticket de Erro de Envio: o retrato que veio da Lulu (alertas,
// situação, previsão) + o rastreio consultado direto na API da Azul. Só existe com TICKETS_BACKEND=db.
const db = require('../db');
const env = require('../config/env');

const AWB_AZUL = /^577-?\d{8}$/;
const COOLDOWN_CONSULTA_MS = 15000;
const ultimaConsulta = new Map(); // rowIndex -> instante da última chamada à Azul (protege a API de cliques repetidos)

const txt = (v) => String(v == null ? '' : v).trim();
const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

// ── Cliente da Azul (uma instância só; trocável nos testes) ──
let clienteAzul = null;
function obterClienteAzul() {
  if (clienteAzul) return clienteAzul;
  if (!env.azulToken && !(env.azulEmail && env.azulSenha)) return null;
  const { AzulRastreio } = require('./azulRastreio');
  clienteAzul = new AzulRastreio({ token: env.azulToken, email: env.azulEmail, senha: env.azulSenha });
  return clienteAzul;
}
/** Só para testes. */
function definirClienteAzul(c) { clienteAzul = c; }

/** Qual transportadora é: a que a Lulu informou; senão deduz pelo formato do código. */
function deduzirTransportadora(lulu, codigo) {
  const t = txt(lulu && lulu.transportadora).toLowerCase();
  if (t) return t;
  if (AWB_AZUL.test(txt(codigo))) return 'azul';
  return '';
}
const podeConsultarAzul = (transportadora, codigo) => transportadora === 'azul' && AWB_AZUL.test(txt(codigo));

// ── Retrato da Lulu ──
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

/** Texto automático que o importador antigo gravava em "Observação" (começa sempre com "Situação: "). */
const observacaoAutomatica = (obs) => /^Situação: /.test(String(obs || ''));

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
  if (codigo) await q.query(`update tickets set codigo_rastreio = $2 where row_index = $1 and codigo_rastreio = ''`, [n, codigo]);
  const previsao = require('./ticketsDb.service').paraTimestampBrasilia(card.previsao_entrega);
  if (previsao) await q.query('update tickets set previsao_entrega_transportadora = $2::timestamp where row_index = $1 and previsao_entrega_transportadora is null', [n, previsao]);
}

/**
 * Passa para o cartão "Entrega" o que estava escrito à mão no campo Observação pelo importador antigo
 * e deixa o campo livre. O texto antigo fica guardado em observacao_original. Só mexe em tickets que já têm
 * o retrato da Lulu (a informação não se perde) e cuja observação é o texto automático.
 */
async function liberarObservacoesAutomaticas() {
  return db.transaction(async (tx) => {
    const r = await tx.query(
      `select t.row_index::int as ri, t.observacao from tickets t join ticket_entrega e on e.ticket_row_index = t.row_index
        where e.lulu is not null and t.observacao like 'Situação: %'`,
    );
    for (const x of r.rows) {
      await tx.query('update ticket_entrega set observacao_original = coalesce(observacao_original, $2) where ticket_row_index = $1', [x.ri, x.observacao]);
      await tx.query(`update tickets set observacao = '' where row_index = $1`, [x.ri]);
    }
    return r.rows.length;
  });
}

// ── Rastreio da Azul ──
/** Rastreio normalizado da biblioteca -> versão enxuta para guardar e mostrar (sem o "bruto"). */
function resumirRastreioAzul(r) {
  return {
    awb: r.awb,
    situacao: r.situacao,
    previsaoEntrega: r.previsaoEntrega,
    entregueEm: r.entregueEm,
    previsaoVencida: !!r.previsaoVencida,
    recebedor: r.recebedor || null,
    fotoEntrega: r.fotoEntrega || null,
    ocorrencias: r.ocorrencias.map((o) => ({
      codigo: o.codigo, descricao: o.descricao, comentario: o.comentario, dataHora: o.dataHora,
      unidade: o.unidade, municipio: o.municipio, uf: o.uf, categoria: o.categoria, alerta: !!o.alerta, fotos: o.fotos,
    })),
  };
}

async function carregarTicket(n) {
  const r = await db.query(
    `select row_index::int as "rowIndex", identificador, codigo_rastreio as "codigoRastreio" from tickets where row_index = $1`, [n]);
  return r.rows[0] || null;
}

function montarResposta(ticket, linha) {
  const lulu = (linha && linha.lulu) || null;
  const codigo = txt(ticket.codigoRastreio) || txt(lulu && lulu.codigoRastreio);
  const transportadora = deduzirTransportadora(lulu, codigo);
  return {
    ok: true,
    entrega: {
      transportadora,
      codigoRastreio: codigo,
      podeConsultar: podeConsultarAzul(transportadora, codigo) && !!(env.azulToken || (env.azulEmail && env.azulSenha)),
      lulu,
      luluAtualizadoEm: linha && linha.lulu_atualizado_em ? new Date(linha.lulu_atualizado_em).toISOString() : null,
      azul: (linha && linha.azul) || null,
      azulConsultadoEm: linha && linha.azul_consultado_em ? new Date(linha.azul_consultado_em).toISOString() : null,
    },
  };
}

async function ler(rowIndex) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: false, erro: 'rowIndex ausente' };
  const ticket = await carregarTicket(n);
  if (!ticket) return { ok: false, erro: 'Ticket não encontrado.' };
  const r = await db.query('select lulu, lulu_atualizado_em, azul, azul_consultado_em from ticket_entrega where ticket_row_index = $1', [n]);
  return montarResposta(ticket, r.rows[0]);
}

const MENSAGEM_ERRO_AZUL = {
  CREDENCIAL: 'A Azul recusou o acesso do hub (token inválido ou vencido). Avise o time técnico para renovar o AZUL_TOKEN.',
  SEM_PERMISSAO: 'Esse envio pertence a outro CNPJ da Seubone que o acesso do hub à Azul não enxerga.',
  DADOS_INVALIDOS: 'A Azul não aceitou esse código de rastreio.',
  INDISPONIVEL: 'A Azul não respondeu agora. Tente de novo em instantes.',
};

/** Consulta a Azul agora, guarda o resultado e devolve o cartão atualizado. */
async function consultarAzul(rowIndex, agora = Date.now()) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: false, erro: 'rowIndex ausente' };
  const ticket = await carregarTicket(n);
  if (!ticket) return { ok: false, erro: 'Ticket não encontrado.' };
  const atual = await ler(n);
  const e = atual.entrega;
  if (!e.codigoRastreio) return { ok: false, erro: 'Este ticket ainda não tem código de rastreio.' };
  if (e.transportadora !== 'azul' || !AWB_AZUL.test(e.codigoRastreio)) return { ok: false, erro: 'A consulta direta só está disponível para envios pela Azul.' };
  const cliente = obterClienteAzul();
  if (!cliente) return { ok: false, erro: 'O acesso do hub à Azul não está configurado (AZUL_TOKEN).' };

  const anterior = ultimaConsulta.get(n);
  if (anterior && agora - anterior < COOLDOWN_CONSULTA_MS) return { ok: false, erro: 'Acabei de consultar a Azul para este ticket. Aguarde alguns segundos.' };
  ultimaConsulta.set(n, agora);

  let rastreio;
  try {
    rastreio = await cliente.rastrearPorAwb(e.codigoRastreio);
  } catch (err) {
    ultimaConsulta.delete(n); // falha não deve travar a próxima tentativa
    return { ok: false, erro: MENSAGEM_ERRO_AZUL[err && err.tipo] || `Falha ao consultar a Azul: ${(err && err.message) || err}` };
  }
  if (!rastreio) return { ok: false, erro: 'A Azul ainda não tem registro desse código de rastreio.' };

  await db.query(
    `insert into ticket_entrega (ticket_row_index, azul, azul_consultado_em) values ($1, $2::jsonb, now())
     on conflict (ticket_row_index) do update set azul = excluded.azul, azul_consultado_em = now()`,
    [n, JSON.stringify(resumirRastreioAzul(rastreio))],
  );
  return ler(n);
}

module.exports = {
  ler, consultarAzul, salvarLulu, resumirCardLulu, resumirRastreioAzul, liberarObservacoesAutomaticas, observacaoAutomatica,
  deduzirTransportadora, definirClienteAzul, COOLDOWN_CONSULTA_MS,
};
