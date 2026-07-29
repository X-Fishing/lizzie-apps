-- ═══════════════════════════════════════════════════════════════════
-- 0044 — Conciliação bancária: contas do banco + movimentações importadas
--        (OFX) ou lançadas na mão, casadas com financeiro_lancamentos
--        (a receber) ou contas_a_pagar (a pagar).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Depois:
--        select pg_notify('pgrst','reload schema');
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Contas do banco (dimensão simples; financeiro_lancamentos.conta hoje é
--    texto livre default 'C6 Bank' — esta tabela vira a referência real).
create table if not exists public.banco_contas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  banco      text,
  tipo       text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.banco_contas (nome, banco, tipo)
select 'C6 Bank', 'C6', 'corrente'
where not exists (select 1 from public.banco_contas where nome = 'C6 Bank');

-- 2) Movimentações (importadas de OFX ou lançadas na mão).
create table if not exists public.banco_movimentos (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid references public.banco_contas(id) on delete set null,
  conta_label text,                 -- snapshot do nome (sobrevive se a conta for removida)
  data        date not null,
  descricao   text,
  memo        text,
  valor       numeric(14,2) not null,      -- assinado: negativo=débito, positivo=crédito
  tipo        text not null check (tipo in ('credito','debito')),
  fitid       text,                        -- id único do OFX (dedup/reimport)

  conciliado       boolean not null default false,
  conciliado_tipo  text check (conciliado_tipo in ('receber','pagar')),
  conciliado_ref   uuid,             -- -> financeiro_lancamentos.id ou contas_a_pagar.id
  categoria_id     uuid references public.categorias_financeiras(id) on delete set null,
  conciliado_em    timestamptz,
  conciliado_por   uuid,

  desconciliado_em     timestamptz,  -- soft "desfazer" (nunca apaga, espelha o estorno)
  desconciliado_por    uuid,
  desconciliacao_motivo text,

  origem       text not null default 'ofx' check (origem in ('ofx','manual')),
  importado_em timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Reimportar o mesmo arquivo OFX não duplica: mesma conta + mesmo FITID = a mesma linha.
create unique index if not exists banco_mov_fitid_uniq
  on public.banco_movimentos (conta_id, fitid) where fitid is not null;

create index if not exists idx_banco_mov_data       on public.banco_movimentos(data);
create index if not exists idx_banco_mov_conciliado on public.banco_movimentos(conciliado);
create index if not exists idx_banco_mov_conta      on public.banco_movimentos(conta_id);

-- 3) RLS — mesmo padrão do financeiro (staff lê, gestor grava, admin deleta).
alter table public.banco_contas     enable row level security;
alter table public.banco_movimentos enable row level security;

drop policy if exists banco_contas_select on public.banco_contas;
drop policy if exists banco_contas_write  on public.banco_contas;
drop policy if exists banco_mov_select    on public.banco_movimentos;
drop policy if exists banco_mov_insert    on public.banco_movimentos;
drop policy if exists banco_mov_update    on public.banco_movimentos;
drop policy if exists banco_mov_delete    on public.banco_movimentos;

create policy banco_contas_select on public.banco_contas for select to authenticated
  using ( public.is_staff() );
create policy banco_contas_write on public.banco_contas for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

create policy banco_mov_select on public.banco_movimentos for select to authenticated
  using ( public.is_staff() );
create policy banco_mov_insert on public.banco_movimentos for insert to authenticated
  with check ( public.is_gestor() );
create policy banco_mov_update on public.banco_movimentos for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy banco_mov_delete on public.banco_movimentos for delete to authenticated
  using ( public.is_admin() );

select pg_notify('pgrst','reload schema');
