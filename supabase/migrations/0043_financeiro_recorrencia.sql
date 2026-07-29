-- ═══════════════════════════════════════════════════════════════════
-- 0043 — Contas a Receber: recorrência de contas manuais (mensal/semanal/
--        anual/parcelado/personalizada), no mesmo padrão da 0034/0042
--        (contas_a_pagar). Aplica-se só a lançamentos origem='manual'
--        (acerto de maleta não recorre). COMO APLICAR: Supabase → SQL
--        Editor → cole tudo → Run. Depois:
--        select pg_notify('pgrst','reload schema');
-- IDEMPOTENTE. recorrencia = null → lançamento avulso (comportamento atual).
-- ═══════════════════════════════════════════════════════════════════

alter table public.financeiro_lancamentos
  add column if not exists serie_id      uuid,   -- agrupa as ocorrências geradas juntas
  add column if not exists recorrencia   text,   -- mensal | semanal | anual | parcelado | personalizada
  add column if not exists parcela_num   int,    -- posição na série (1..total)
  add column if not exists parcela_total int,    -- tamanho da série
  add column if not exists rec_intervalo int,    -- só quando recorrencia='personalizada'
  add column if not exists rec_unidade   text;   -- dia | semana | mes | ano

alter table public.financeiro_lancamentos drop constraint if exists fin_recorrencia_check;
alter table public.financeiro_lancamentos add constraint fin_recorrencia_check
  check (recorrencia in ('mensal','semanal','anual','parcelado','personalizada'));

alter table public.financeiro_lancamentos drop constraint if exists fin_rec_unidade_check;
alter table public.financeiro_lancamentos add constraint fin_rec_unidade_check
  check (rec_unidade is null or rec_unidade in ('dia','semana','mes','ano'));

create index if not exists idx_fin_lanc_serie on public.financeiro_lancamentos(serie_id);

select pg_notify('pgrst','reload schema');
