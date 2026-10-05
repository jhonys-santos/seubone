-- Notificações do sininho. Antes ficavam numa aba da planilha do Registro de
-- Demandas, lidas pelo Apps Script a cada 25 segundos por TODA aba aberta.
--
--  * destinatario = '' -> aviso para todo mundo; com slug -> só para essa pessoa.
--  * lida_por = slugs de quem já leu (cada um marca para si).
--  * A regra de apagar (direcionada lida pelo destinatário; geral lida por todos
--    os usuários) continua no hub, em notificacoesDb.service.js.
--  * criada_em tem fuso (timestamptz): a tela converte para a hora local de quem vê.

create table if not exists notificacoes (
  id           text primary key,
  mensagem     text        not null default '',
  link         text,
  destinatario text        not null default '',
  lida_por     text[]      not null default '{}',
  criada_em    timestamptz not null default now()
);
create index if not exists notificacoes_destinatario_idx on notificacoes (destinatario);
