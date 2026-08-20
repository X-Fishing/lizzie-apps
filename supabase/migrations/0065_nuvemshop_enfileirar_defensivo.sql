-- ═══════════════════════════════════════════════════════════════════
-- 0065 — nuvemshop_enfileirar ignora produto que já não existe mais.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- BUG (20/08/2026): excluir um produto que JÁ foi bipado em alguma
-- maleta (mesmo maleta antiga/encerrada) sempre falhava com:
--   "insert or update on table nuvemshop_sync_queue violates foreign
--    key constraint nuvemshop_sync_queue_produto_id_fkey"
--
-- CAUSA: consignados.produto_id tem "on delete set null" — ao apagar o
-- produto, o Postgres cascateia um UPDATE em cada consignados que
-- apontava pra ele (produto_id vira null). Isso dispara o trigger
-- consignados_enfileira_nuvemshop (nuvemshop-estoque-schema.sql), que
-- tenta reenfileirar sincronização pro produto ANTIGO (old.produto_id)
-- — só que esse produto já foi apagado NA MESMA transação, então o
-- insert em nuvemshop_sync_queue esbarra na FK. Não era só dos "PRODUTO
-- TESTE 1/2/3": qualquer produto real com histórico em maleta quebrava
-- exclusão do mesmo jeito.
--
-- FIX: nuvemshop_enfileirar() confere se o produto ainda existe antes
-- de tentar enfileirar — se já sumiu, não tem o que sincronizar mesmo.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.nuvemshop_enfileirar(
  p_produto_id uuid,
  p_variacao_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_produto_id is null then return; end if;
  -- Produto já não existe mais (ex.: exclusão em cascata que zerou o
  -- produto_id de um consignado dentro do mesmo DELETE) — nada a
  -- sincronizar, e enfileirar aqui só ia esbarrar na FK.
  if not exists (select 1 from public.produtos where id = p_produto_id) then
    return;
  end if;
  insert into public.nuvemshop_sync_queue (produto_id, produto_variacao_id)
  select p_produto_id, p_variacao_id
  where not exists (
    select 1 from public.nuvemshop_sync_queue q
    where q.processado = false
      and q.produto_id = p_produto_id
      and q.produto_variacao_id is not distinct from p_variacao_id
  );
end; $$;

select pg_notify('pgrst', 'reload schema');
