-- O rastreio consultado direto na transportadora passa a servir Azul, Correios e LATAM:
-- "azul" vira "rastreio" (mesmo formato normalizado para as três).
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'ticket_entrega' and column_name = 'azul') then
    alter table ticket_entrega rename column azul to rastreio;
    alter table ticket_entrega rename column azul_consultado_em to rastreio_consultado_em;
  end if;
end $$;
alter table ticket_entrega add column if not exists rastreio_fonte text;  -- 'azul' | 'correios' | 'latam'
