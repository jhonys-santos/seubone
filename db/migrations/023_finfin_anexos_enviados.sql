-- Arquivos que o próprio solicitante enviou ao criar o card (nome + hash do conteúdo). O finfin devolve TODOS os anexos do card no
-- webhook de conclusão; com isso o hub mostra só o que o financeiro acrescentou.
alter table finfin_demandas add column if not exists anexos_enviados json not null default '[]';
