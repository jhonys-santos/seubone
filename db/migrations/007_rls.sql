-- Segurança: o Supabase expõe as tabelas do schema "public" numa API REST pública (PostgREST)
-- que qualquer pessoa com a chave "anon" do projeto (ela não é secreta) consegue chamar.
-- Tabela criada por SQL nasce SEM proteção ali. Com RLS ligado e nenhuma policy, a API pública
-- não enxerga nada. O hub não é afetado: ele conecta direto no Postgres como dono das tabelas,
-- e o dono ignora o RLS.
--
-- Rode de novo sempre que criar uma tabela nova.
alter table if exists tickets            enable row level security;
alter table if exists ticket_historico   enable row level security;
alter table if exists notificacoes       enable row level security;
alter table if exists sessoes            enable row level security;
alter table if exists erros_casos        enable row level security;
alter table if exists erros_historico    enable row level security;
alter table if exists registro_demandas  enable row level security;
alter table if exists reembolsos         enable row level security;
alter table if exists pagamentos         enable row level security;
alter table if exists corridas           enable row level security;
