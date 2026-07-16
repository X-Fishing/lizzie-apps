-- ═══════════════════════════════════════════════════════════════════
-- 0020 — Formas de Pagamento + Categorias Financeiras (Fase 1 redesign)
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
-- Cadastros simples usados pelo Financeiro. Padrão de RLS dos demais
-- cadastros: leitura = staff; escrita = gestor. Sem acesso anônimo.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.formas_pagamento (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  taxa       numeric not null default 0,   -- % sobre a venda
  prazo      text,                          -- texto livre: "na hora", "30 dias"...
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categorias_financeiras (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  tipo       text not null default 'despesa',  -- 'receita' | 'despesa'
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.formas_pagamento       enable row level security;
alter table public.categorias_financeiras enable row level security;

do $$
declare t text;
begin
  foreach t in array array['formas_pagamento','categorias_financeiras'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_write  on public.%I', t, t);
    execute format($f$create policy %I_select on public.%I for select to authenticated using ( public.is_staff() )$f$, t, t);
    execute format($f$create policy %I_write  on public.%I for all    to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() )$f$, t, t);
  end loop;
end $$;
