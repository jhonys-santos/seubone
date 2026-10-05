// Notificações do sininho em Postgres. Mesma API de notificacoes.service.js
// (listarNaoLidas, adicionar, marcarLida, marcarTodasLidas) e mesmo formato de
// resposta ({ id, mensagem, link, lidaPor, criadoEm, destinatario }).
const db = require('../db');

const COLUNAS = `id, mensagem, link, lida_por as "lidaPor", destinatario,
  to_char(criada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "criadoEm"`;

function paraContrato(r) {
  return { ...r, link: r.link || null, destinatario: r.destinatario || null, lidaPor: r.lidaPor || [] };
}

/**
 * Apaga notificações direcionadas já lidas pelo destinatário e as gerais já lidas
 * por TODOS os usuários cadastrados. Sem lista de usuários não arrisca apagar.
 */
async function podar(todosSlugs) {
  if (!todosSlugs || !todosSlugs.length) return;
  await db.query(
    `delete from notificacoes
      where (destinatario <> '' and destinatario = any(lida_por))
         or (destinatario = '' and $1::text[] <@ lida_por)`,
    [todosSlugs],
  );
}

async function listarNaoLidas(slug) {
  const r = await db.query(
    `select ${COLUNAS} from notificacoes
      where (destinatario = '' or destinatario = $1) and not ($1 = any(lida_por))
      order by criada_em desc, id desc`,
    [slug],
  );
  return r.rows.map(paraContrato);
}

async function adicionar(mensagem, link, destinatarioSlug, todosSlugs) {
  const id = 'NTF' + Date.now() + Math.random().toString(36).slice(2, 6);
  await db.query(
    'insert into notificacoes (id, mensagem, link, destinatario) values ($1, $2, $3, $4)',
    [id, String(mensagem || ''), link || null, destinatarioSlug || ''],
  );
  await podar(todosSlugs);
}

async function marcarLida(id, slug, todosSlugs) {
  const r = await db.query(
    `update notificacoes
        set lida_por = case when $2 = any(lida_por) then lida_por else array_append(lida_por, $2) end
      where id = $1 returning id`,
    [String(id), slug],
  );
  await podar(todosSlugs);
  return r.rowCount > 0;
}

/** Botão "Limpar todas": marca de uma vez tudo que a pessoa ainda não leu. Devolve quantas. */
async function marcarTodasLidas(slug, todosSlugs) {
  const r = await db.query(
    `update notificacoes set lida_por = array_append(lida_por, $1)
      where (destinatario = '' or destinatario = $1) and not ($1 = any(lida_por)) returning id`,
    [slug],
  );
  await podar(todosSlugs);
  return r.rowCount;
}

module.exports = { listarNaoLidas, adicionar, marcarLida, marcarTodasLidas };
