-- ═══════════════════════════════════════════════════════════════════
-- 0045 — Histórico de conciliações (cabeçalho + itens), no mesmo padrão de
--        fechamentos_mostruario/fechamentos_divergencias (0003).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Depois:
--        select pg_notify('pgrst','reload schema');
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.conciliacoes (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid references public.banco_contas(id) on delete set null,
  periodo_ini      date,
  periodo_fim      date,
  total_movimentos  int,
  total_conciliados int,
  observacao       text,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create table if not exists public.conciliacao_itens (
  id              uuid primary key default gen_random_uuid(),
  conciliacao_id  uuid not null references public.conciliacoes(id) on delete cascade,
  movimento_id    uuid,
  ref_tipo        text check (ref_tipo in ('receber','pagar')),
  ref_id          uuid,
  valor           numeric(14,2),
  acao            text not null check (acao in ('conciliar','desconciliar')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_conciliacao_itens_conciliacao on public.conciliacao_itens(conciliacao_id);

alter table public.conciliacoes      enable row level security;
alter table public.conciliacao_itens enable row level security;

drop policy if exists conciliacoes_select on public.conciliacoes;
drop policy if exists conciliacoes_insert on public.conciliacoes;
drop policy if exists conciliacoes_delete on public.conciliacoes;
drop policy if exists conciliacao_itens_select on public.conciliacao_itens;
drop policy if exists conciliacao_itens_insert on public.conciliacao_itens;

create policy conciliacoes_select on public.conciliacoes for select to authenticated
  using ( public.is_staff() );
create policy conciliacoes_insert on public.conciliacoes for insert to authenticated
  with check ( public.is_gestor() );
create policy conciliacoes_delete on public.conciliacoes for delete to authenticated
  using ( public.is_admin() );

create policy conciliacao_itens_select on public.conciliacao_itens for select to authenticated
  using ( public.is_staff() );
create policy conciliacao_itens_insert on public.conciliacao_itens for insert to authenticated
  with check ( public.is_gestor() );

select pg_notify('pgrst','reload schema');
