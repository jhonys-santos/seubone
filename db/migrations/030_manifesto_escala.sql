-- Escala do Manifesto: quem faz o Manifesto em cada data (e a que horas), e os pedidos de troca entre pessoas.
-- O alerta do Manifesto (manifesto-alerta.js) passa a ler daqui quando MANIFESTO_ESCALA=on; sem linha para a data, vale o rodízio semanal da Agenda.
create table if not exists manifesto_escala (
  data           date        primary key,
  slug           text        not null default '',            -- '' = sem Manifesto nesse dia (feriado, folga geral): o alerta fica quieto
  nome           text        not null default '',
  hora           text        not null default '17:45',       -- HH:MM (sexta costuma ser 16:45)
  atualizado_por text        not null default '',
  atualizado_em  timestamptz not null default now()
);

-- Troca de dias entre duas pessoas: quem pede cede o dia dele e assume o do colega; o colega faz o inverso. Só vale se o colega aceitar.
create table if not exists manifesto_trocas (
  id              bigint generated always as identity primary key,
  solicitante     text        not null,
  solicitante_nome text       not null default '',
  data_sol        date        not null,
  alvo            text        not null,
  alvo_nome       text        not null default '',
  data_alvo       date        not null,
  status          text        not null default 'pendente',   -- pendente | aceita | recusada | cancelada
  motivo          text        not null default '',
  criada_em       timestamptz not null default now(),
  respondida_em   timestamptz
);
create index if not exists manifesto_trocas_alvo_idx on manifesto_trocas (alvo, status);
create index if not exists manifesto_trocas_sol_idx on manifesto_trocas (solicitante, status);

alter table manifesto_escala enable row level security;
alter table manifesto_trocas enable row level security;
