-- ═══════════════════════════════════════════════════════════════════
-- 0035 — Vincula a venda à maleta/ciclo. COMO APLICAR: Supabase → SQL
--        Editor → Run. Depois: select pg_notify('pgrst','reload schema');
-- Sem isso as vendas continuam "acumuladas" (sem noção de ciclo).
-- ═══════════════════════════════════════════════════════════════════

-- Maleta em que a venda foi feita (= ciclo). null = venda antiga sem vínculo.
alter table public.vendas
  add column if not exists maleta_id uuid references public.maletas(id) on delete set null;

create index if not exists idx_vendas_maleta on public.vendas(maleta_id);

-- Backfill: deriva a maleta pelas peças vendidas (venda_itens → consignados).
-- Uma venda pega a maleta de qualquer item com peça do catálogo (todos os
-- itens de uma venda vêm da mesma maleta ativa na prática).
update public.vendas v
set maleta_id = sub.mid
from (
  select vi.venda_id, max(c.maleta_id::text)::uuid as mid
  from public.venda_itens vi
  join public.consignados c on c.id = vi.consignado_id
  where vi.consignado_id is not null and c.maleta_id is not null
  group by vi.venda_id
) sub
where v.id = sub.venda_id and v.maleta_id is null;
