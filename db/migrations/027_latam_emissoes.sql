-- e-Minutas LATAM Cargo emitidas pelo hub (uma linha por emissão). A LATAM não tem listagem de e-Minutas utilizável nem cancelamento: o histórico
-- vem deste registro (quem emitiu, quando, para quem, NF, serviço) + a consulta de rastreio por AWB. "previa" guarda os dados da emissão para
-- reimprimir a etiqueta interna.
create table if not exists latam_emissoes (
  minuta            text primary key,                  -- número da e-Minuta/AWB (ex.: 957-31496135)
  emitido_em        timestamptz not null default now(),
  emitido_por_slug  text        not null default '',
  emitido_por_nome  text        not null default '',
  chave_nfe         text        not null default '',
  numero_nf         text        not null default '',
  valor_nf          numeric(14,2),
  destinatario      text        not null default '',
  cidade_uf         text        not null default '',
  cep               text        not null default '',
  servico           text        not null default '',
  entrega_domicilio boolean     not null default false,
  destino_iata      text        not null default '',
  volumes           integer,
  peso_kg           numeric(10,3),
  aviso             text        not null default '',
  previa            json        not null default '{}',
  situacao          text,                              -- último rastreio conhecido (ENTREGUE, EM_TRANSITO, ...) ou SEM_REGISTRO
  entregue_em       timestamptz,
  consultado_em     timestamptz
);
create index if not exists latam_emissoes_emitido_em_idx on latam_emissoes (emitido_em desc);
create index if not exists latam_emissoes_chave_idx on latam_emissoes (chave_nfe);
alter table latam_emissoes enable row level security;
