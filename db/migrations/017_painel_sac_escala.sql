-- Escala de serviço e Trocas de sábado do Painel SAC (abas Escala_<consultor> e Trocas) em Postgres.
-- Mesmo contrato que o Apps Script devolvia (ver src/services/escalaDb.service.js).
--
--  * sac_escala_pessoas: quem tem escala (era o ABAS_MAP do Apps Script) e o nome mostrado na Home (coluna C da aba Usuarios).
--  * sac_escala: uma linha por pessoa e mês; "dias" guarda os 31 status (T, F, FN, FM, TR, FE) na ordem dos dias 1..31,
--    exatamente como as colunas B..AF da planilha. "mes" é 0..11 (janeiro = 0), como o painel sempre usou.
--  * sac_trocas: pedidos de troca de sábado. id é o mesmo "TR<milissegundos>" que a planilha gerava.
-- RLS ligado em tudo: o hub conecta como dono (ignora RLS); a API pública do Supabase não enxerga nada.
create table if not exists sac_escala_pessoas (
  slug  text   primary key,
  nome  text   not null default '',
  ordem int    not null default 0
);

create table if not exists sac_escala (
  slug          text        not null,
  ano           int         not null,
  mes           int         not null check (mes between 0 and 11),
  rotulo        text        not null default '',
  dias          text[]      not null check (array_length(dias, 1) = 31),
  atualizado_em timestamptz not null default now(),
  primary key (slug, ano, mes)
);

create table if not exists sac_trocas (
  ordem               bigint generated always as identity primary key,
  id                  text        not null unique,
  solicitante         text        not null,
  dia_sol             int         not null,
  mes_sol             int         not null,
  ano_sol             int         not null,
  alvo                text        not null,
  dia_alvo            int         not null,
  mes_alvo            int         not null,
  ano_alvo            int         not null,
  status              text        not null default 'pendente',
  criada_em           timestamptz,
  criada_em_original  text        not null default '',
  respondida_em       timestamptz
);
create index if not exists sac_trocas_alvo_idx on sac_trocas (alvo, status);

alter table sac_escala_pessoas enable row level security;
alter table sac_escala enable row level security;
alter table sac_trocas enable row level security;
