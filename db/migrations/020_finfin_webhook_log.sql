-- Registro de cada chamada que o finfin faz ao webhook do hub (para saber se o retorno do financeiro chegou, e o que aconteceu).
create table if not exists finfin_webhook_log (
  id               bigint generated always as identity primary key,
  recebido_em      timestamptz not null default now(),
  http             int         not null,
  codigo           text        not null default '',
  coluna           text        not null default '',
  resultado        text        not null default '',   -- concluido | atualizado | ignorado | recusado | erro
  anexos_recebidos int         not null default 0,
  anexos_novos     int         not null default 0,
  notificado       boolean     not null default false,
  erro             text        not null default '',
  ip               text        not null default '',
  duracao_ms       int         not null default 0
);
create index if not exists finfin_webhook_log_recebido_idx on finfin_webhook_log (recebido_em desc);
alter table finfin_webhook_log enable row level security;
