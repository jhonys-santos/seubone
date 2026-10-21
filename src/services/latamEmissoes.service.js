// Registro local das e-Minutas LATAM emitidas pelo hub (tabela latam_emissoes): quem emitiu, quando, para quem, e o último rastreio conhecido.
// A LATAM não oferece listagem utilizável nem cancelamento; o Histórico vem daqui.
const db = require('../db');

const str = (v) => String(v == null ? '' : v);

/**
 * Grava a emissão. resultado: o que emitir() devolveu ({ minuta, aviso }); previa: o que previa() devolveu.
 * Nunca derruba a emissão: se gravar falhar, a e-Minuta já existe na LATAM (só loga).
 */
async function registrarEmissao({ resultado, previa, usuario }) {
  try {
    const nota = (previa.notas && previa.notas[0]) || {};
    const d = previa.destinatario || {};
    const end = d.endereco || {};
    const volumes = (previa.volumes || []).reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    const peso = (previa.volumes || []).reduce((s, v) => s + (Number(v.pesoKg) || 0) * (Number(v.quantidade) || 0), 0);
    await db.query(
      `insert into latam_emissoes (minuta, emitido_por_slug, emitido_por_nome, chave_nfe, numero_nf, valor_nf, destinatario, cidade_uf, cep, servico,
         entrega_domicilio, destino_iata, volumes, peso_kg, aviso, previa)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::json) on conflict (minuta) do nothing`,
      [str(resultado.minuta), str(usuario.slug), str(usuario.nome), str(nota.chave).replace(/\D/g, ''), str(nota.numero),
        Number.isFinite(Number(previa.valorTotalNotas)) ? Number(previa.valorTotalNotas) : null, str(d.nome),
        end.cidade ? `${end.cidade}/${end.uf || ''}` : '', str(end.cep), str(previa.servico && previa.servico.nome),
        !!previa.entregaDomicilio, str(previa.destino), volumes || null, peso || null, str(resultado.aviso), JSON.stringify(previa)],
    );
  } catch (e) { console.error('[latam-emissoes] e-Minuta emitida, mas falhou ao gravar o registro:', e.message); }
}

/** "95739107541" / "957-39107541" / "39107541" -> "957-39107541"; qualquer outra coisa -> null. */
function normalizarAwb(codigo) {
  const d = str(codigo).replace(/\D/g, '');
  if (/^957\d{8}$/.test(d)) return '957-' + d.slice(3);
  if (/^\d{8}$/.test(d)) return '957-' + d;
  return null;
}

/**
 * Guarda as e-Minutas LATAM que estão nos cards do Lulu (origem 'lulu'). Card de outra transportadora é ignorado. Uma e-Minuta que o hub já emitiu só
 * ganha os dados do pedido. A data de emissão não vem no card: entra a da entrada em alerta e é corrigida na consulta de rastreio (a LATAM informa a criação).
 * Devolve { latam, novos, atualizados, semCodigo }.
 */
async function importarCardsLulu(cards) {
  const out = { latam: 0, novos: 0, atualizados: 0, semCodigo: 0 };
  for (const c of cards || []) {
    const transp = str(c.transportadora).trim().toLowerCase();
    const minuta = normalizarAwb(c.codigo_rastreio);
    if (transp && transp !== 'latam') continue;
    if (!transp && !minuta) continue;
    out.latam++;
    if (!minuta) { out.semCodigo++; continue; }
    const existe = (await db.query('select 1 from latam_emissoes where minuta = $1', [minuta])).rowCount > 0;
    const nf = str(c.nota_fiscal && c.nota_fiscal.numero).replace(/^0+/, '');
    const cliente = str(c.cliente && c.cliente.razao_social).trim();
    const quando = c.em_alerta_desde && !Number.isNaN(Date.parse(c.em_alerta_desde)) ? new Date(c.em_alerta_desde).toISOString() : new Date().toISOString();
    await db.query(
      `insert into latam_emissoes (minuta, emitido_em, emitido_por_nome, numero_nf, destinatario, situacao, consultado_em, origem, id_pedido, titulo_negocio, negocio_id, lulu_visto_em, emitido_exato)
       values ($1,$2,'Lulu',$3,$4,$5,$6,'lulu',$7,$8,$9, now(), false)
       on conflict (minuta) do update set
         id_pedido = case when latam_emissoes.id_pedido = '' then excluded.id_pedido else latam_emissoes.id_pedido end,
         titulo_negocio = case when latam_emissoes.titulo_negocio = '' then excluded.titulo_negocio else latam_emissoes.titulo_negocio end,
         negocio_id = case when latam_emissoes.negocio_id = '' then excluded.negocio_id else latam_emissoes.negocio_id end,
         numero_nf = case when latam_emissoes.numero_nf = '' then excluded.numero_nf else latam_emissoes.numero_nf end,
         lulu_visto_em = now()`,
      [minuta, quando, nf, cliente, str(c.situacao) || null, c.ultima_consulta && !Number.isNaN(Date.parse(c.ultima_consulta)) ? new Date(c.ultima_consulta).toISOString() : null,
        c.id_pedido != null ? String(c.id_pedido) : '', str(c.titulo_negocio).trim(), str(c.negocio_id)],
    );
    if (existe) out.atualizados++; else out.novos++;
  }
  return out;
}

/** Emissões do período (datas AAAA-MM-DD, horário de Brasília), sem o blob da prévia. */
async function listar({ de, ate }) {
  const r = await db.query(
    `select minuta, emitido_em, emitido_por_slug, emitido_por_nome, chave_nfe, numero_nf, valor_nf::float8 as valor_nf, destinatario, cidade_uf, cep, servico,
            entrega_domicilio, destino_iata, volumes, peso_kg::float8 as peso_kg, aviso, situacao, entregue_em, consultado_em,
            origem, id_pedido, titulo_negocio, negocio_id, emitido_exato, (previa::text <> '{}') as tem_previa
       from latam_emissoes
      where (emitido_em at time zone 'America/Sao_Paulo')::date between $1::date and $2::date
      order by emitido_em desc`, [de, ate]);
  return r.rows;
}

/** Dados para reimprimir a etiqueta (a prévia da emissão). */
async function obterPrevia(minuta) {
  const r = await db.query('select minuta, previa from latam_emissoes where minuta = $1', [minuta]);
  if (!r.rowCount) return null;
  const p = r.rows[0].previa;
  const previa = typeof p === 'string' ? JSON.parse(p) : p;
  if (!previa || !Object.keys(previa).length) return null;   // e-Minuta que veio do Lulu: o hub não tem os dados para a etiqueta
  return { minuta: r.rows[0].minuta, previa };
}

/** Guarda o último rastreio conhecido (situação e data de entrega). */
async function atualizarRastreio(minuta, { situacao, entregueEm, emitidoEm }) {
  // Nas e-Minutas vindas do Lulu a data de emissão ainda é a da entrada em alerta: a consulta traz a criação real (createdDate da LATAM).
  const emitido = emitidoEm && !Number.isNaN(Date.parse(emitidoEm)) ? new Date(emitidoEm).toISOString() : null;
  await db.query(
    `update latam_emissoes set situacao = $2, entregue_em = $3, consultado_em = now(), emitido_em = case when origem = 'lulu' and $4::timestamptz is not null then $4::timestamptz else emitido_em end,
            emitido_exato = case when origem = 'lulu' and $4::timestamptz is not null then true else emitido_exato end where minuta = $1`,
    [minuta, situacao, entregueEm || null, emitido]);
}

module.exports = { registrarEmissao, importarCardsLulu, normalizarAwb, listar, obterPrevia, atualizarRastreio };
