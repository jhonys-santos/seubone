-- Reembolso x Painel de Erros: todo reembolso precisa ter o erro registrado (conferido pelo ID da venda) ou ser dispensado com um motivo.
-- Só a dispensa fica aqui; "registrado" é conferido ao vivo no Painel de Erros pelo ID da venda.
create table if not exists reembolso_erro_dispensa (
  codigo   text        not null,                 -- DM-0042 (card do reembolso)
  id_venda text        not null,                 -- um reembolso pode ter mais de um ID de venda
  motivo   text        not null,
  por_slug text        not null default '',
  por_nome text        not null default '',
  em       timestamptz not null default now(),
  primary key (codigo, id_venda)
);

-- Aviso diário no sino: "você tem N reembolsos sem erro registrado". Uma linha por pessoa por dia, para não repetir.
create table if not exists reembolso_erro_aviso (
  slug text not null,
  dia  date not null,
  qtd  int  not null default 0,
  primary key (slug, dia)
);

alter table reembolso_erro_dispensa enable row level security;
alter table reembolso_erro_aviso enable row level security;
