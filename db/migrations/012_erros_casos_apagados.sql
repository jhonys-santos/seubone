-- Quando um caso do Painel de Erros é substituído por um novo registro com o mesmo ID da venda, o caso antigo é
-- apagado. Esta tabela guarda uma cópia (caso + histórico) de cada um, para ser possível recuperar se foi engano.
create table if not exists erros_casos_apagados (
  id               bigint generated always as identity primary key,
  apagado_em       timestamptz not null default now(),
  apagado_por      text        not null default '',
  apagado_por_slug text        not null default '',
  motivo           text        not null default '',
  row_index        bigint      not null,
  id_venda         text        not null default '',
  caso             jsonb       not null,
  historico        jsonb       not null default '[]'::jsonb
);
create index if not exists erros_casos_apagados_id_venda_idx on erros_casos_apagados (id_venda);
alter table erros_casos_apagados enable row level security;
