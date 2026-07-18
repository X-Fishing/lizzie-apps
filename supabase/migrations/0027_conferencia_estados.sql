-- ═══════════════════════════════════════════════════════════════════
-- 0027 — Conferência final: estados "vendida" e "extraviada" por peça
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- extraviado : peça que não voltou na maleta e não foi vendida — fica FORA
--   do total vendido/comissão e é registrada na auditoria (tipo 'extraviada').
-- conf_vendida : marcação explícita "Vendida" na conferência. Persiste para
--   o gate "todas conferidas" sobreviver a um reload no meio da conferência.
--
-- Exclusividade dos três estados (devolvido/conf_vendida/extraviado) é
-- garantida no código (cada marcação zera as outras duas), no mesmo padrão
-- do resto do app. fechamentos_divergencias.tipo é text livre (0003), então
-- o novo tipo 'extraviada' não exige alteração de schema.
-- ═══════════════════════════════════════════════════════════════════
alter table public.consignados
  add column if not exists extraviado boolean not null default false;
alter table public.consignados
  add column if not exists conf_vendida boolean not null default false;
