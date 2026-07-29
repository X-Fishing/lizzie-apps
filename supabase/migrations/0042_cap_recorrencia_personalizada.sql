-- ═══════════════════════════════════════════════════════════════════
-- 0042 — Contas a Pagar: recorrência "Personalizada" (a cada N dia(s)/
--        semana(s)/mês(es)/ano(s)), além de mensal/semanal/anual/parcelado
--        (0034). COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
--        Depois: select pg_notify('pgrst','reload schema');
-- IDEMPOTENTE. rec_intervalo/rec_unidade só são usados quando
-- recorrencia = 'personalizada' (senão ficam null).
-- ═══════════════════════════════════════════════════════════════════

alter table public.contas_a_pagar
  add column if not exists rec_intervalo int,   -- ex.: 15 (junto de rec_unidade='dia' = a cada 15 dias)
  add column if not exists rec_unidade   text;  -- dia | semana | mes | ano

-- Recria o check para incluir 'personalizada' (o de 0034 não previa esse valor).
alter table public.contas_a_pagar drop constraint if exists cap_recorrencia_check;
alter table public.contas_a_pagar add constraint cap_recorrencia_check
  check (recorrencia in ('mensal','semanal','anual','parcelado','personalizada'));

alter table public.contas_a_pagar drop constraint if exists cap_rec_unidade_check;
alter table public.contas_a_pagar add constraint cap_rec_unidade_check
  check (rec_unidade is null or rec_unidade in ('dia','semana','mes','ano'));

select pg_notify('pgrst','reload schema');
