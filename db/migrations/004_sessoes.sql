-- Sessões de login (express-session + connect-pg-simple). Antes ficavam em
-- arquivos no disco do Render, que é apagado a cada deploy (todo mundo era
-- deslogado). Aqui sobrevivem a deploys e reinícios.
create table if not exists sessoes (
  sid    varchar     not null primary key,
  sess   json        not null,
  expire timestamp(6) not null
);
create index if not exists sessoes_expire_idx on sessoes (expire);
