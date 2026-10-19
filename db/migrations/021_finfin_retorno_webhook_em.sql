-- Separa "o finfin chamou o webhook (com os anexos do financeiro)" de "o hub descobriu a conclusão consultando o finfin".
-- retorno_webhook_em só é preenchido pelo webhook; a consulta automática marca a coluna e avisa, mas não traz arquivos.
alter table finfin_demandas add column if not exists retorno_webhook_em timestamptz;
update finfin_demandas set retorno_webhook_em = notificado_em where notificado_em is not null and jsonb_array_length(anexos_retorno::jsonb) > 0 and retorno_webhook_em is null;
