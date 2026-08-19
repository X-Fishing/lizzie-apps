-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — peças vindas do Bling (consignados) sem produto
-- cadastrado no catálogo interno (produtos). Só leitura.
--
-- CONTEXTO (19/08/2026): "baixar mostruário" (src/bling.js) grava só em
-- consignados — nunca cria/atualiza produtos. "Importar do Bling" (dentro
-- de Produtos) é um fluxo MANUAL separado que ninguém liga ao primeiro.
-- O Lançador (bipe) só busca em produtos (lookupProduto, lancador.js) —
-- por isso peça que volta sem vender não é achada pra relançar: ela
-- existe em consignados, mas nunca ganhou um "gêmeo" em produtos.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Quantas peças de cada revendedora estão nessa situação ─────────
select p.nome as revendedora, count(*) as pecas_sem_produto,
       min(c.created_at) as mais_antiga, max(c.created_at) as mais_recente
  from public.consignados c
  join public.profiles p on p.id = c.revendedora_id
 where c.pedido_numero is not null            -- só o que veio do Bling
   and c.referencia is not null and c.referencia <> ''
   and not exists (
     select 1 from public.produtos pr
      where pr.sku = c.referencia or pr.codigo_barras = c.referencia
   )
 group by p.nome
 order by pecas_sem_produto desc;

-- ── 2) Total geral (visão rápida do tamanho do problema) ───────────────
select count(*) as total_pecas_sem_produto,
       count(distinct c.referencia) as skus_distintos_sem_produto,
       count(distinct c.revendedora_id) as revendedoras_afetadas
  from public.consignados c
 where c.pedido_numero is not null
   and c.referencia is not null and c.referencia <> ''
   and not exists (
     select 1 from public.produtos pr
      where pr.sku = c.referencia or pr.codigo_barras = c.referencia
   );

-- ── 3) Amostra (20 linhas) pra conferir se o padrão faz sentido ────────
select c.id, p.nome as revendedora, c.referencia, c.descricao, c.pedido_numero,
       c.status, c.quantidade_enviada, c.quantidade_vendida, c.created_at
  from public.consignados c
  join public.profiles p on p.id = c.revendedora_id
 where c.pedido_numero is not null
   and c.referencia is not null and c.referencia <> ''
   and not exists (
     select 1 from public.produtos pr
      where pr.sku = c.referencia or pr.codigo_barras = c.referencia
   )
 order by c.created_at desc
 limit 20;
