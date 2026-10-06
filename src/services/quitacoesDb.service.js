// Quitações Pendentes em Postgres. Cada função devolve o mesmo JSON que o Apps Script
// (apps-script/quitacoes) devolvia, pra tela não perceber a troca.
const db = require('../db');

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const str = (v) => String(v == null ? '' : v);

/** "2026-10-12" (ou ISO) -> "2026-10-12"; qualquer outra coisa -> null. */
function paraData(v) {
  const s = str(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

const SQL_ITENS = `select id,
  to_char(data_cadastro at time zone 'UTC', ${ISO_UTC}) as "dataCadastro",
  id_venda_omie as "idVendaOmie", cliente,
  coalesce(to_char(data_prevista, 'YYYY-MM-DD'), '') as "dataPrevista",
  link_crm as "linkCrm", modalidade, tipo_envio_aereo as "tipoEnvioAereo", aeroporto,
  frete_dedicado as "freteDedicado", transportadora, entregador, observacao,
  cadastrado_por_slug as "cadastradoPorSlug", cadastrado_por_nome as "cadastradoPorNome", status,
  coalesce(to_char(data_pagamento at time zone 'UTC', ${ISO_UTC}), '') as "dataPagamento"
  from quitacoes`;

/** status: 'pendente' (padrão) ou 'pago'. desde/ate: "AAAA-MM-DD" (dia inteiro, hora de Brasília), sobre a data do pagamento (ou do cadastro se não houver). */
async function listar(status, desde, ate) {
  const params = [status || 'pendente'];
  let filtro = '';
  const dDesde = paraData(desde);
  const dAte = paraData(ate);
  if (dDesde) { params.push(`${dDesde}T00:00:00-03:00`); filtro += ` and coalesce(data_pagamento, data_cadastro) >= $${params.length}::timestamptz`; }
  if (dAte) { params.push(`${dAte}T23:59:59-03:00`); filtro += ` and coalesce(data_pagamento, data_cadastro) <= $${params.length}::timestamptz`; }
  const r = await db.query(`${SQL_ITENS} where status = $1${filtro} order by data_cadastro desc, ordem desc`, params);
  return { ok: true, itens: r.rows };
}

/** id = "QT" + milissegundos, como antes; se colidir, tenta o próximo milissegundo. */
async function cadastrar(b) {
  const base = Date.now();
  for (let i = 0; i < 10; i++) {
    const id = `QT${base + i}`;
    try {
      await db.query(
        `insert into quitacoes (id, id_venda_omie, cliente, data_prevista, link_crm, modalidade, tipo_envio_aereo, aeroporto,
           frete_dedicado, transportadora, entregador, observacao, cadastrado_por_slug, cadastrado_por_nome)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, str(b.idVendaOmie), str(b.cliente), paraData(b.dataPrevista), str(b.linkCrm), str(b.modalidade), str(b.tipoEnvioAereo), str(b.aeroporto),
          !!b.freteDedicado, str(b.transportadora), str(b.entregador), str(b.observacao), str(b.cadastradoPorSlug), str(b.cadastradoPorNome)],
      );
      return { ok: true, id };
    } catch (e) {
      if (e && e.code === '23505') continue;
      return { ok: false, erro: (e && e.message) || String(e) };
    }
  }
  return { ok: false, erro: 'Não foi possível gerar um id único.' };
}

async function marcarPago(id) {
  const r = await db.query(
    `update quitacoes set status = 'pago', data_pagamento = coalesce(data_pagamento, now()) where id = $1`,
    [str(id)],
  );
  return r.rowCount ? { ok: true } : { ok: false, erro: 'Pedido nao encontrado.' };
}

module.exports = { listar, cadastrar, marcarPago, paraData };
