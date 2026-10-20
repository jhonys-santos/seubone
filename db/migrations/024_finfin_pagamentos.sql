-- Pagamentos enviados ao finfin (kanban "Pagamentos" da SeuBoné): o mesmo recibo local das demandas gerais (finfin_demandas), agora com a
-- coluna "formulario" ('gerais' = Registro, 'pagamento' = Pagamento) e os campos próprios do pagamento guardados em "dados" (json):
-- razao_social, vencimento, cpf_cnpj, motivo, banco, agencia, conta, pix_tipo, pix_chave, valor, nota_fiscal.
-- Linhas existentes são do Registro e ficam como 'gerais'.
alter table finfin_demandas add column if not exists formulario text not null default 'gerais';
alter table finfin_demandas add column if not exists dados      json not null default '{}';
create index if not exists finfin_demandas_formulario_idx on finfin_demandas (formulario, solicitante_slug, criado_em desc);
