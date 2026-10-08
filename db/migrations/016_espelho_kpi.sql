-- ESPELHO dos números que a planilha de KPIs (e os CSVs publicados) já calculam. NÃO recalcula nada: só guarda a última
-- cópia boa, para os painéis responderem rápido sem abrir a planilha a cada consulta. A planilha continua sendo a fonte;
-- se a cópia estiver velha ou faltar, os painéis consultam a planilha como sempre.
--  kpi_espelho: por time (atendimento | resolucao), as séries diárias exatamente como o Apps Script as calcula
--               (datas[i] é o dia da posição i de cada série em por_consultor / por_equipe). Colunas "json" (não jsonb) de propósito:
--               preservam a ORDEM das chaves, que o Apps Script devolvia numa ordem específica.
--  csv_espelho: último texto dos CSVs publicados do Ranking SAC (atd, rsl, kpi, agenda).
create table if not exists kpi_espelho (
  time          text        primary key,
  datas         json        not null,
  por_consultor json        not null,
  por_equipe    json        not null,
  atualizado_em timestamptz not null default now()
);
create table if not exists csv_espelho (
  chave         text        primary key,
  conteudo      text        not null,
  atualizado_em timestamptz not null default now()
);
alter table kpi_espelho enable row level security;
alter table csv_espelho enable row level security;
