-- Controle do backup automático para as planilhas (segunda a sexta, 20h): uma linha por dia.
-- Serve para (1) não rodar duas vezes no mesmo dia, (2) recuperar se o servidor estava fora do
-- ar às 20h (roda assim que voltar, no mesmo dia), (3) limitar as tentativas e saber o que deu errado.
create table if not exists backups_planilhas (
  data         date primary key,
  status       text        not null,              -- rodando | ok | erro
  tentativas   int         not null default 1,
  iniciado_em  timestamptz not null default now(),
  concluido_em timestamptz,
  detalhe      text        not null default ''
);
alter table backups_planilhas enable row level security;
