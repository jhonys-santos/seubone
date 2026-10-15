-- Demandas enviadas ao finfin (kanban "Envio de demandas - Gerais"): registro local de cada card criado pelo hub, para saber quem
-- pediu o quê, achar o card pelo código (DM-...) e, mais adiante, avisar o solicitante quando o financeiro concluir.
-- O card em si mora no finfin; aqui fica só o recibo.
create table if not exists finfin_demandas (
  ordem               bigint generated always as identity primary key,
  id_finfin           text        not null unique,          -- UUID mandado ao finfin (reenviar o mesmo não duplica)
  codigo              text        not null default '',      -- DM-0042
  solicitante_slug    text        not null default '',
  solicitante_nome    text        not null default '',
  solicitante_email   text        not null default '',
  demanda             text        not null default '',
  especificacao       text        not null default '',
  link_lulu           text        not null default '',
  titulo              text        not null default '',
  coluna              text        not null default 'backlog',
  modo                text        not null default 'producao',   -- 'teste' enquanto o novo formulário está em validação
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  concluido_em        timestamptz
);
create index if not exists finfin_demandas_solicitante_idx on finfin_demandas (solicitante_slug, criado_em desc);
create index if not exists finfin_demandas_codigo_idx on finfin_demandas (codigo);
alter table finfin_demandas enable row level security;
