-- ═══════════════════════════════════════════════════════════════════
-- 0064 — Observações da maleta (mostruário). COMO APLICAR: Supabase →
-- SQL Editor → cole tudo → Run. Idempotente.
--
-- PEDIDO: campo de anotação livre por maleta (ex.: "peças que voltaram
-- da maleta passada", combinados com a revendedora — mesma ideia do
-- campo Observações do pedido no Bling), visível também no histórico
-- de catálogos fechados (ícone com tooltip por cima do texto).
-- RLS já cobre: maletas_update já é só-gestor (maletas-schema.sql).
-- ═══════════════════════════════════════════════════════════════════

alter table public.maletas add column if not exists observacao text;

select pg_notify('pgrst', 'reload schema');
