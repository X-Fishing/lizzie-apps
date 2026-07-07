-- Migração: código do fornecedor no catálogo-mestre (2026-07-06)
-- Rodar UMA vez no Supabase → SQL Editor, ANTES de usar a versão nova do app.
-- (o app passa a selecionar esta coluna; sem ela a tela Produtos quebra)

alter table public.produtos
  add column if not exists codigo_fornecedor text;

comment on column public.produtos.codigo_fornecedor is
  'Código da peça no fornecedor — usado na busca quando não temos o SKU';

-- busca por igualdade/prefixo (a busca do app filtra no cliente, mas o índice
-- deixa preparado pra busca server-side futura)
create index if not exists produtos_cod_fornecedor_idx
  on public.produtos (codigo_fornecedor)
  where codigo_fornecedor is not null;
