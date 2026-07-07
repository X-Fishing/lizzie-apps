-- Reset do catálogo de produtos (2026-07-06)
-- Apaga tudo que foi importado de teste e recomeça o banco de produtos a partir
-- das peças que estão/estiveram em catálogo de revendedora (tabela consignados).
-- Rodar no Supabase → SQL Editor. Pode rodar mais de uma vez (idempotente).

-- 1) Limpa o catálogo de teste.
--    produto_variacoes cai em cascata; consignados.produto_id vira null sozinho.
delete from public.produtos;

-- 2) Semeia 1 produto por referência (SKU) a partir dos consignados,
--    usando o lançamento mais recente como fonte de nome/preço.
insert into public.produtos (nome, sku, preco_venda, foto_url, formato, estoque_qtd, ativo)
select distinct on (c.referencia)
       c.descricao,
       c.referencia,
       coalesce(c.preco_venda, 0),
       c.foto_url,
       'simples',
       0,        -- estoque central zerado: as peças estão nas maletas
       true
from public.consignados c
where c.referencia is not null and c.referencia <> ''
order by c.referencia, c.created_at desc;

-- 3) Vincula cada consignado ao produto recém-criado (pelo SKU).
update public.consignados c
set produto_id = p.id
from public.produtos p
where c.produto_id is null and c.referencia = p.sku;

-- 4) Conferência: quantos produtos nasceram e quantos consignados ficaram
--    sem vínculo (peças lançadas sem referência — normal existir algumas).
select
  (select count(*) from public.produtos)                                        as produtos_criados,
  (select count(*) from public.consignados where produto_id is not null)       as consignados_vinculados,
  (select count(*) from public.consignados where produto_id is null)           as consignados_sem_referencia;
