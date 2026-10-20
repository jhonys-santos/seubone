-- Qual coluna do kanban gerou o último aviso ao solicitante. Antes o aviso era um só (notificado_em, "concluído"); agora há kanbans em que o
-- retorno tem mais de um desfecho (reembolso: Pago ou Negado; análise de termo: Pré-aprovado, Reprovado ou Ajustar) e o solicitante precisa
-- ser avisado de cada um, uma vez por coluna.
alter table finfin_demandas add column if not exists notificado_coluna text;
update finfin_demandas set notificado_coluna = coluna where notificado_em is not null and notificado_coluna is null;
