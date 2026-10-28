-- Decisões tomadas no hub sobre cards do finfin (hoje: aprovar ou negar um Reembolso SAC). A API do finfin mostra tudo que vem do hub como "Sistema" e não
-- aceita comentário ao mover o card: quem decidiu, quando e o motivo ficam registrados aqui.
create table if not exists finfin_decisoes (
  id          bigint generated always as identity primary key,
  codigo      text        not null,                              -- DM-0042
  formulario  text        not null default 'reembolso_sac',
  decisao     text        not null,                              -- 'aprovado' | 'negado'
  coluna_de   text        not null default '',
  coluna_para text        not null default '',
  motivo      text        not null default '',
  por_slug    text        not null default '',
  por_nome    text        not null default '',
  em          timestamptz not null default now()
);
create index if not exists finfin_decisoes_codigo_idx on finfin_decisoes (codigo, em desc);
alter table finfin_decisoes enable row level security;
