-- Emissões de etiqueta Correios feitas pelo hub (uma linha por pré-postagem/caixa). Os Correios só guardam 120 dias e só dizem quem criou pelo login do
-- contrato (o mesmo para todos): aqui fica QUEM emitiu no hub, quando, o destinatário e o que foi cancelado, para o Histórico de emissões.
create table if not exists correios_emissoes (
  id_prepostagem   text primary key,                 -- id da pré-postagem nos Correios
  codigo_objeto    text        not null default '',  -- código de rastreio (ex.: OY602814415BR)
  servico          text        not null default '',  -- SEDEX / PAC
  codigo_servico   text        not null default '',
  volume           text        not null default '',  -- "1/3" quando a NF saiu em mais de uma caixa
  emitido_por_slug text        not null default '',
  emitido_por_nome text        not null default '',
  emitido_em       timestamptz not null default now(),
  chave_nfe        text        not null default '',
  pedido           text        not null default '',
  destinatario     text        not null default '',
  cidade_uf        text        not null default '',
  cep              text        not null default '',
  peso_g           integer,
  medidas          text        not null default '',
  observacao       text        not null default '',
  status           text        not null default 'PREPOSTADO',   -- último status conhecido (a tela confere nos Correios quando pode)
  cancelado_em     timestamptz,
  cancelado_por    text        not null default ''
);
create index if not exists correios_emissoes_emitido_em_idx on correios_emissoes (emitido_em desc);
create index if not exists correios_emissoes_codigo_idx on correios_emissoes (codigo_objeto);
alter table correios_emissoes enable row level security;
