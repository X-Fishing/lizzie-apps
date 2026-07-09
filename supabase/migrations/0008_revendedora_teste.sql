-- ═══════════════════════════════════════════════════════════════════
-- 0008 — Revendedora de TESTE (isolada de faturamento e estoque)
-- No app as revendedoras vivem em public.profiles (role = 'revendedora').
-- O isolamento é por FILTRO nas agregações do front (helper ehRevTeste):
-- marcar o flag remove retroativamente tudo que ela já lançou dos totais,
-- sem apagar nenhum dado. As maletas dela seguem 100% funcionais p/ teste.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists teste boolean not null default false;

-- marcar a conta de teste (ajuste o identificador se o nome for outro):
update public.profiles set teste = true
where role = 'revendedora' and nome ilike 'Lidiane Oficial%';
