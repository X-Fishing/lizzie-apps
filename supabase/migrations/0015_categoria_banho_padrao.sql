-- ═══════════════════════════════════════════════════════════════════
-- 0014 — Banho padrão (milésimos) por categoria
-- Cada categoria tem sua regra de milesimagem: ao escolhê-la na Entrada
-- de Mercadoria (ou no produto), o campo Banho é preenchido sozinho
-- (editável por peça). Só se aplica ao ouro.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

alter table public.categorias
  add column if not exists banho_padrao numeric(12,4) not null default 0;
