-- ═══════════════════════════════════════════════════════════════════
-- 0002 — Conferência de fechamento do mostruário
-- Flag de conferência física: marcada quando o admin confirma que a
-- peça VOLTOU na maleta. NÃO confunda com quantidade_devolvida (numérica,
-- entra no cálculo de estoque disponível) — esta coluna é só da conferência.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

alter table public.consignados
  add column if not exists devolvido boolean not null default false;
