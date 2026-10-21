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

/** Emissões do período (datas AAAA-MM-DD, horário de Brasília), sem o blob da prévia. */
async function listar({ de, ate }) {
  const r = await db.query(
    `select minuta, emitido_em, emitido_por_slug, emitido_por_nome, chave_nfe, numero_nf, valor_nf::float8 as valor_nf, destinatario, cidade_uf, cep, servico,
            entrega_domicilio, destino_iata, volumes, peso_kg::float8 as peso_kg, aviso, situacao, entregue_em, consultado_em
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
  return { minuta: r.rows[0].minuta, previa: typeof p === 'string' ? JSON.parse(p) : p };
}

/** Guarda o último rastreio conhecido (situação e data de entrega). */
async function atualizarRastreio(minuta, { situacao, entregueEm }) {
  await db.query('update latam_emissoes set situacao = $2, entregue_em = $3, consultado_em = now() where minuta = $1', [minuta, situacao, entregueEm || null]);
}

module.exports = { registrarEmissao, listar, obterPrevia, atualizarRastreio };
