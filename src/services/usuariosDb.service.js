// Usuários do hub (login, senha, papel, slug, painéis liberados) em Postgres. Devolve os mesmos
// objetos que hubListarUsuarios() do Apps Script do Painel SAC devolvia; o cache em memória e a
// autenticação continuam em usuarios.service.js.
const db = require('../db');

const paraObjeto = (r) => ({
  id: r.id,
  usuario: r.usuario,
  senhaHash: r.senha_hash,
  nome: r.nome,
  slug: r.slug,
  role: r.role,
  tipo: r.tipo ? r.tipo : null,
  paineis: Array.isArray(r.paineis) ? r.paineis : [],
  indicadoresPendentes: !!r.indicadores_pendentes,
});

async function listar() {
  const r = await db.query('select * from hub_usuarios order by ordem');
  return r.rows.map(paraObjeto);
}

/** Cria ou atualiza pelo "usuario" (sem diferenciar maiúscula/minúscula), como a planilha fazia. */
async function salvar(u) {
  const paineis = Array.isArray(u.paineis) ? u.paineis : String(u.paineis || '').split(',').map((s) => s.trim()).filter(Boolean);
  await db.query(
    `insert into hub_usuarios (id, usuario, senha_hash, nome, slug, role, tipo, paineis, indicadores_pendentes)
     values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9)
     on conflict ((lower(btrim(usuario)))) do update set
       id = excluded.id, usuario = excluded.usuario, senha_hash = excluded.senha_hash, nome = excluded.nome, slug = excluded.slug,
       role = excluded.role, tipo = excluded.tipo, paineis = excluded.paineis, indicadores_pendentes = excluded.indicadores_pendentes`,
    [u.id || `u-${u.slug}`, u.usuario, u.senhaHash, u.nome || '', u.slug, u.role || 'colaborador', u.tipo || null, paineis, !!u.indicadoresPendentes],
  );
  return { ok: true };
}

module.exports = { listar, salvar };
