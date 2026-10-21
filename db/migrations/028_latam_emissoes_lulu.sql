-- e-Minutas LATAM que vieram dos cards do Lulu (coluna "Alerta de Entrega" hoje; "Código de rastreio" quando o Lulu liberar o endpoint). O hub não emitiu essas:
-- não têm a prévia (sem reimpressão de etiqueta) e a data de emissão só é conhecida depois da consulta de rastreio (a LATAM informa a criação da e-Minuta).
alter table latam_emissoes add column if not exists origem          text not null default 'hub';   -- 'hub' | 'lulu'
alter table latam_emissoes add column if not exists id_pedido       text not null default '';
alter table latam_emissoes add column if not exists titulo_negocio  text not null default '';
alter table latam_emissoes add column if not exists negocio_id      text not null default '';
alter table latam_emissoes add column if not exists lulu_visto_em   timestamptz;
create index if not exists latam_emissoes_pedido_idx on latam_emissoes (id_pedido);
-- false enquanto emitido_em é só a data em que o card entrou em alerta no Lulu; vira true quando a consulta de rastreio traz a criação real da e-Minuta.
alter table latam_emissoes add column if not exists emitido_exato boolean not null default true;
