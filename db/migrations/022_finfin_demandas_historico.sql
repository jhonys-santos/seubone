-- Para as solicitações do formulário novo (finfin) aparecerem no Histórico de solicitações, o recibo local guarda também a descrição
-- e o telefone que foram enviados ao finfin.
alter table finfin_demandas add column if not exists descricao text not null default '';
alter table finfin_demandas add column if not exists telefone  text not null default '';
