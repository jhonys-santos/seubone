-- Solicitações Financeiro (Registro de Demandas, Reembolso, Pagamento) e Corridas Avulsas.
--
--  * id = o mesmo "RD1759...", "RB...", "PG...", "CA..." de antes (texto): o n8n devolve
--    esse id no webhook de retorno e as notificações citam esse id.
--  * ordem = ordem de chegada (a planilha era uma lista em ordem de inserção).
--  * Campos que parecem número mas são identificadores (agência, conta, chave Pix, CPF/CNPJ,
--    nº da nota, id da compra...) ficam como TEXTO, para nunca perder zero à esquerda.
--  * anexos = texto JSON, [{nome,url,downloadUrl}] com links do Google Drive, como na planilha.
--  * Datas "sem hora" (data, data_vencimento, data_corrida) são date; inserido_em/data_cadastro
--    são instantes (timestamptz) e saem em ISO UTC, como o Apps Script devolvia.

create table if not exists registro_demandas (
  id                  text primary key,
  ordem               bigint generated always as identity,
  data                date,
  data_vencimento     date,
  id_compra           text not null default '',
  link_card           text not null default '',
  solicitante         text not null default '',
  empresa             text not null default '',
  numero_corporativo  text not null default '',
  tipo_demanda        text not null default '',
  demanda_solicitada  text not null default '',
  observacao          text not null default '',
  email               text not null default '',
  anexos              text not null default '[]',
  status              text not null default 'Pendente',
  feito_por           text not null default '',
  inserido_em         timestamptz not null default now(),
  solicitante_slug    text not null default ''
);
create index if not exists registro_demandas_ordem_idx on registro_demandas (ordem);

create table if not exists reembolsos (
  id                    text primary key,
  ordem                 bigint generated always as identity,
  data_vencimento       date,
  id_referencia         text not null default '',
  cpf_cnpj              text not null default '',
  email                 text not null default '',
  motivo_reembolso      text not null default '',
  razao_social_cliente  text not null default '',
  banco                 text not null default '',
  agencia               text not null default '',
  conta                 text not null default '',
  chave_pix             text not null default '',
  tipo_chave            text not null default '',
  valor                 numeric not null default 0,
  empresa_responsavel   text not null default '',
  anexos                text not null default '[]',
  status                text not null default 'Pendente',
  feito_por             text not null default '',
  inserido_em           timestamptz not null default now(),
  solicitante_slug      text not null default ''
);
create index if not exists reembolsos_ordem_idx on reembolsos (ordem);

create table if not exists pagamentos (
  id                   text primary key,
  ordem                bigint generated always as identity,
  data_vencimento      date,
  cpf_cnpj             text not null default '',
  email                text not null default '',
  motivo               text not null default '',
  razao_social         text not null default '',
  banco                text not null default '',
  agencia              text not null default '',
  conta                text not null default '',
  chave_pix            text not null default '',
  tipo_chave           text not null default '',
  valor                numeric not null default 0,
  empresa_responsavel  text not null default '',
  solicitante          text not null default '',
  numero_nota_fiscal   text not null default '',
  anexos               text not null default '[]',
  status               text not null default 'Pendente',
  feito_por            text not null default '',
  inserido_em          timestamptz not null default now(),
  solicitante_slug     text not null default ''
);
create index if not exists pagamentos_ordem_idx on pagamentos (ordem);

create table if not exists corridas (
  id                   text primary key,
  ordem                bigint generated always as identity,
  data_cadastro        timestamptz not null default now(),
  data_corrida         date,
  numero_nf            text not null default '',
  endereco             text not null default '',
  valor                numeric not null default 0,
  print_urls           jsonb not null default '[]',   -- array de links do Drive
  registrado_por_slug  text not null default '',
  registrado_por_nome  text not null default '',
  nome_motorista       text not null default ''
);
create index if not exists corridas_data_idx on corridas (data_corrida);
