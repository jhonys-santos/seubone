// Registro local das emissões de etiqueta Correios feitas pelo hub (tabela correios_emissoes): quem emitiu, quando, para quem, e o que foi cancelado.
// Os Correios só guardam 120 dias e identificam quem criou pelo login do contrato (o mesmo para todos); aqui fica o usuário do hub.
const db = require('../db');

const str = (v) => String(v == null ? '' : v);

/**
 * Grava uma linha por caixa emitida.
 * resultado: o que emitir() devolveu ({ servico, volumes: [{ id, codigoObjeto }] });  previa: o que previa() devolveu (destinatário, pedido, chave, pesos).
 * Nunca derruba a emissão: se gravar falhar, a etiqueta já existe nos Correios (só loga).
 */
async function registrarEmissao({ resultado, previa, usuario }) {
  try {
    const total = resultado.volumes.length;
    for (let i = 0; i < total; i++) {
      const v = resultado.volumes[i];
      const med = previa.volumes[i] || {};
      const d = previa.destinatario || {};
      const end = d.endereco || {};
      await db.query(
        `insert into correios_emissoes (id_prepostagem, codigo_objeto, servico, codigo_servico, volume, emitido_por_slug, emitido_por_nome, chave_nfe, pedido,
           destinatario, cidade_uf, cep, peso_g, medidas, observacao)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (id_prepostagem) do nothing`,
        [v.id, str(v.codigoObjeto), str(resultado.servico), str(previa.codigoServico), total > 1 ? `${i + 1}/${total}` : '', str(usuario.slug), str(usuario.nome),
          str(previa.chaveNFe), str(previa.pedido), str(d.nome), end.cidade ? `${end.cidade}/${end.uf || ''}` : '', str(end.cep),
          Number.isFinite(med.pesoG) ? Math.round(med.pesoG) : null,
          med.alturaCm ? `${med.alturaCm}×${med.larguraCm}×${med.comprimentoCm}` : '', str(previa.observacao)],
      );
    }
  } catch (e) { console.error('[correios-emissoes] etiqueta emitida, mas falhou ao gravar o registro:', e.message); }
}

/** Marca como cancelada (ou com o status que os Correios devolveram) e guarda quem cancelou. */
async function registrarCancelamento({ id, status, usuario }) {
  try {
    await db.query(
      `update correios_emissoes set status = $2, cancelado_em = case when $2 in ('CANCELADO','ESTORNADO') then coalesce(cancelado_em, now()) else cancelado_em end,
              cancelado_por = case when $2 in ('CANCELADO','ESTORNADO') then $3 else cancelado_por end where id_prepostagem = $1`,
      [id, str(status || 'CANCELADO'), str(usuario.nome || usuario.slug)]);
  } catch (e) { console.error('[correios-emissoes] cancelada nos Correios, mas falhou ao gravar o registro:', e.message); }
}

/** Linhas emitidas pelo hub no período (datas AAAA-MM-DD, horário de Brasília). */
async function listar({ de, ate }) {
  const r = await db.query(
    `select id_prepostagem, codigo_objeto, servico, codigo_servico, volume, emitido_por_slug, emitido_por_nome, emitido_em, chave_nfe, pedido, destinatario,
            cidade_uf, cep, peso_g, medidas, observacao, status, cancelado_em, cancelado_por
       from correios_emissoes
      where (emitido_em at time zone 'America/Sao_Paulo')::date between $1::date and $2::date
      order by emitido_em desc`, [de, ate]);
  return r.rows;
}

module.exports = { registrarEmissao, registrarCancelamento, listar };
