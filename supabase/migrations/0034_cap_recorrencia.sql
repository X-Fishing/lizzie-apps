-- ═══════════════════════════════════════════════════════════════════
-- 0034 — Contas a Pagar: recorrência de pagamento (mensal/semanal/anual)
--        e parcelamento em X vezes. COMO APLICAR: Supabase → SQL Editor →
--        cole tudo → Run. Depois: select pg_notify('pgrst','reload schema');
-- IDEMPOTENTE. recorrencia = null → título avulso (comportamento atual).
-- ═══════════════════════════════════════════════════════════════════

alter table public.contas_a_pagar
  add column if not exists serie_id      uuid,   -- agrupa as ocorrências geradas juntas
  add column if not exists recorrencia   text,   -- mensal | semanal | anual | parcelado
  add column if not exists parcela_num   int,    -- posição na série (1..total)
  add column if not exists parcela_total int;    -- tamanho da série

do $$ begin
  alter table public.contas_a_pagar
    add constraint cap_recorrencia_check
    check (recorrencia in ('mensal','semanal','anual','parcelado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_cap_serie on public.contas_a_pagar(serie_id);
