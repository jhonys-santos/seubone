-- Pedidos Urgentes (aba "Pedidos") em Postgres. Mesmo contrato do Apps Script: lista de objetos com os nomes de coluna da planilha.
--  * id é o UUID que a planilha já usava; ordem preserva a ordem de inclusão (a planilha era só append).
--  * Datas são instantes reais (timestamptz): a tela já recebe ISO em UTC e converte para Brasília.
--  * Manifesto, nota fiscal e foto da OS continuam no Google Drive (só os links/ids ficam aqui).
create table if not exists pedidos_urgentes (
  ordem               bigint generated always as identity primary key,
  id                  text        not null unique,
  os                  text        not null default '',
  cliente             text        not null default '',
  link_crm            text        not null default '',
  transportadora      text        not null default '',
  modalidade          text        not null default '',
  tipo_envio_aereo    text        not null default '',
  aeroporto_retirada  text        not null default '',
  os_imagem_id        text        not null default '',
  manifesto_link      text        not null default '',
  nota_fiscal_link    text        not null default '',
  observacao          text        not null default '',
  prazo               timestamptz,
  status              text        not null default 'Pendente',
  inserido_por        text        not null default '',
  inserido_em         timestamptz not null default now(),
  despachado_por      text        not null default '',
  despachado_em       timestamptz
);
create index if not exists pedidos_urgentes_status_idx on pedidos_urgentes (status, prazo);
create index if not exists pedidos_urgentes_inserido_idx on pedidos_urgentes (inserido_em);
alter table pedidos_urgentes enable row level security;
