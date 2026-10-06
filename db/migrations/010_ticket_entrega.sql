-- Dados de entrega de um ticket de Erro de Envio: o que a Lulu mostrou (alertas, situação, previsão)
-- e o rastreio consultado direto na Azul (ocorrências). Um registro por ticket.
--   lulu  = último retrato vindo do CRM (atualizado pelo importador, 2x ao dia)
--   azul  = último rastreio consultado na API da Azul (botão "Consultar Azul agora")
--   observacao_original = texto automático que ficava no campo Observação antes (guardado, nada se perde)
create table if not exists ticket_entrega (
  ticket_row_index    bigint      primary key,
  lulu                jsonb,
  lulu_atualizado_em  timestamptz,
  azul                jsonb,
  azul_consultado_em  timestamptz,
  observacao_original text
);
alter table ticket_entrega enable row level security;
