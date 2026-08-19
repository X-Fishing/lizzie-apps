-- ═══════════════════════════════════════════════════════════════════
-- 0063 — sincronizar_maleta passa a cadastrar o produto automaticamente.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente
-- (create or replace function, mesma assinatura).
--
-- ⚠️ NÃO confundir com db-functions.sql — aquele arquivo é histórico
-- ("não rode hoje", ver aviso no topo dele) e foi a causa do incidente
-- de hoje com registrar_venda duplicada. A partir de agora, toda
-- correção de função vira uma migration numerada como esta.
--
-- CONTEXTO (19/08/2026): "baixar mostruário"/"Atualizar itens da
-- maleta" grava a peça em `consignados`, mas nunca cria/atualiza a
-- linha correspondente em `produtos` (o catálogo interno). O Lançador
-- (bipe) só busca em `produtos` — então quando a peça volta sem vender
-- e alguém tenta relançá-la pra outra revendedora, o bipe nunca acha
-- ela. Ela não sumiu do banco: só nunca ganhou um "gêmeo" na tabela
-- certa. Este fix fecha essa lacuna na origem, pro problema não voltar.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.sincronizar_maleta(
  p_revendedora_id uuid,
  p_pedido_numero  text,
  p_itens          jsonb   -- [{referencia, descricao, quantidade, preco}]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item       record;
  v_qtd_app    integer;
  v_delta      integer;
  v_inseridos  integer := 0;
  v_maleta     uuid;
  v_produto_id uuid;
begin
  if not public.is_gestor() then
    raise exception 'Sem permissao';
  end if;

  -- Resolve (ou cria) a maleta ATIVA da revendedora para vincular as peças novas.
  select id into v_maleta from maletas
    where revendedora_id = p_revendedora_id and status = 'ativa' limit 1;
  if v_maleta is null then
    insert into maletas (revendedora_id, status, numero)
      values (p_revendedora_id, 'ativa', 1) returning id into v_maleta;
  end if;

  -- Agrupa por SKU (soma linhas repetidas do mesmo código no pedido).
  -- Ignora itens sem referência/código (não dá para reconciliar por contagem).
  for v_item in
    select
      x->>'referencia'                       as referencia,
      max(x->>'descricao')                   as descricao,
      sum( (x->>'quantidade')::numeric )     as quantidade,
      max( nullif(x->>'preco','')::numeric ) as preco
    from jsonb_array_elements(p_itens) as x
    where coalesce(x->>'referencia','') <> ''
    group by x->>'referencia'
  loop
    select coalesce(sum(quantidade_enviada), 0) into v_qtd_app
      from consignados
     where revendedora_id = p_revendedora_id
       and status = 'ativo'
       and referencia = v_item.referencia;

    v_delta := floor(v_item.quantidade)::int - v_qtd_app;

    if v_delta > 0 then
      -- Garante o "gêmeo" em produtos (catálogo interno) — sem isso o bipe
      -- do Lançador nunca acha a peça quando ela volta sem vender.
      select id into v_produto_id from produtos where sku = v_item.referencia limit 1;
      if v_produto_id is null then
        insert into produtos (nome, sku, preco_venda, formato, ativo)
          values (coalesce(v_item.descricao, v_item.referencia), v_item.referencia,
                  coalesce(v_item.preco, 0), 'simples', true)
        on conflict (sku) where sku is not null and sku <> '' do nothing
        returning id into v_produto_id;
        -- Corrida com outra sincronização simultânea criando o mesmo SKU:
        -- o "do nothing" não devolve id, busca de novo.
        if v_produto_id is null then
          select id into v_produto_id from produtos where sku = v_item.referencia limit 1;
        end if;
      end if;

      insert into consignados
        (revendedora_id, maleta_id, produto_id, descricao, referencia, quantidade_enviada,
         quantidade_vendida, quantidade_devolvida, preco_venda, foto_url, status, pedido_numero)
      values
        (p_revendedora_id, v_maleta, v_produto_id, v_item.descricao, v_item.referencia, v_delta,
         0, 0, v_item.preco, null, 'ativo', p_pedido_numero);
      v_inseridos := v_inseridos + v_delta;
    end if;
  end loop;

  return v_inseridos;
end;
$$;

revoke all on function public.sincronizar_maleta(uuid,text,jsonb) from public;
grant execute on function public.sincronizar_maleta(uuid,text,jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
