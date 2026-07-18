-- ═══════════════════════════════════════════════════════════════════
-- 0024 — Contas a Pagar (financeiro) + Categorias Financeiras
-- Títulos de despesa (fornecedores, contas fixas) com KPIs, filtros e
-- boleto. "Atrasado" NÃO é persistido — é derivado no app (aberto e
-- vencimento < hoje). Campos origem/entrada_id ficam preparados para a
-- integração futura com a Entrada de Mercadoria (sem FK por ora).
-- RLS no padrão do app: staff lê, gestor grava, admin deleta.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Categorias financeiras (alimenta o select de categoria do título; a
--    tela de gestão sai depois — por ora só a tabela + seed de despesas)
create table if not exists public.categorias_financeiras (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  tipo       text not null default 'despesa' check (tipo in ('despesa','receita')),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists categorias_financeiras_nome_tipo_uniq
  on public.categorias_financeiras (lower(nome), tipo);

insert into public.categorias_financeiras (nome, tipo)
select v.nome, 'despesa'
from (values
  ('Fornecedores'), ('Embalagens'), ('Frete'), ('Marketing'),
  ('Taxas e tarifas'), ('Impostos'), ('Pró-labore'), ('Aluguel'),
  ('Serviços'), ('Outros')
) as v(nome)
where not exists (
  select 1 from public.categorias_financeiras c
  where lower(c.nome) = lower(v.nome) and c.tipo = 'despesa'
);

-- 2) Contas a pagar
create table if not exists public.contas_a_pagar (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'aberto'
                  check (status in ('aberto','pago','cancelado')),
  vencimento      date not null,
  fornecedor_id   uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome text,                  -- snapshot (fornecedor pode ser excluído)
  descricao       text not null,
  categoria_id    uuid references public.categorias_financeiras(id) on delete set null,
  categoria_nome  text,                  -- snapshot
  observacao      text,
  valor           numeric(12,2) not null check (valor > 0),
  forma_pagamento text,                  -- PIX, Boleto, Cartão, Dinheiro, etc.
  boleto_url      text,                  -- link do boleto
  boleto_codigo   text,                  -- linha digitável
  data_pagamento  date,                  -- preenchida quando status = 'pago'
  origem          text not null default 'manual'
                  check (origem in ('manual','entrada_mercadoria')),
  entrada_id      uuid,                  -- ref futura à entrada (sem FK por ora)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists idx_cap_status     on public.contas_a_pagar(status);
create index if not exists idx_cap_vencimento on public.contas_a_pagar(vencimento);
create index if not exists idx_cap_fornecedor on public.contas_a_pagar(fornecedor_id);

-- 3) RLS
alter table public.categorias_financeiras enable row level security;
alter table public.contas_a_pagar         enable row level security;

drop policy if exists catfin_select on public.categorias_financeiras;
drop policy if exists catfin_write  on public.categorias_financeiras;
drop policy if exists cap_select    on public.contas_a_pagar;
drop policy if exists cap_insert    on public.contas_a_pagar;
drop policy if exists cap_update    on public.contas_a_pagar;
drop policy if exists cap_delete    on public.contas_a_pagar;

create policy catfin_select on public.categorias_financeiras for select to authenticated
  using ( public.is_staff() );
create policy catfin_write on public.categorias_financeiras for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

create policy cap_select on public.contas_a_pagar for select to authenticated
  using ( public.is_staff() );
create policy cap_insert on public.contas_a_pagar for insert to authenticated
  with check ( public.is_gestor() );
create policy cap_update on public.contas_a_pagar for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy cap_delete on public.contas_a_pagar for delete to authenticated
  using ( public.is_admin() );

-- 4) Trigger de updated_at
create or replace function public.cap_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_cap_updated_at on public.contas_a_pagar;
create trigger trg_cap_updated_at
  before update on public.contas_a_pagar
  for each row execute function public.cap_set_updated_at();

-- Obs.: adicione a chave de permissão 'financeiro_contas_pagar' ao pacote
-- do admin / perfis conforme o app (o item de menu já usa essa chave).
