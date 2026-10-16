-- Retorno do finfin: quando o financeiro move o card para "Concluído", o finfin chama o hub (webhook) e o hub guarda aqui
-- os anexos que o financeiro colocou (arquivos no Drive) e avisa o solicitante uma única vez (notificado_em).
alter table finfin_demandas add column if not exists anexos_retorno     json        not null default '[]';
alter table finfin_demandas add column if not exists concluido_por      text        not null default '';
alter table finfin_demandas add column if not exists comentario_retorno text        not null default '';
alter table finfin_demandas add column if not exists notificado_em      timestamptz;
