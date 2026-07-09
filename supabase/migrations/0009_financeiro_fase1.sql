-- ═══════════════════════════════════════════════════════════════════
-- 0009 — Financeiro FASE 1: recebimento das maletas + PIX estático
-- Regra de ouro: faturamento = valor_a_receber (líquido após comissão).
-- Contas TESTE (profiles.teste) nunca lançam aqui (filtro no app).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- Config do recebedor PIX (1 linha; editável no app em Financeiro)
create table if not exists public.config_pix (
  id int primary key default 1,
  chave_pix text not null,
  nome_recebedor text not null,   -- máx 25 chars no BR Code
  cidade text not null,           -- máx 15 chars no BR Code
  updated_at timestamptz default now()
);
insert into public.config_pix (id, chave_pix, nome_recebedor, cidade)
values (1, '37690436000160', 'Lizzie Semijoias', 'CAMPINAS')
on conflict (id) do nothing;

-- Lançamentos financeiros (base do módulo; já serve às fases 2-3)
create table if not exists public.financeiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('receber','pagar')),
  descricao text not null,
  pessoa_id uuid,
  pessoa_nome text,
  categoria text,                         -- ex.: 'Acerto de Vendas'
  forma_pagamento text,                   -- 'PIX' | 'Dinheiro' | ...
  conta text default 'C6 Bank',
  valor numeric(12,2) not null,
  vencimento date,
  data_recebimento date,
  pago boolean not null default false,
  origem text,                            -- 'maleta' | 'manual'
  fechamento_id uuid,                     -- fk lógica p/ fechamentos_mostruario
  maleta_ref text,
  created_at timestamptz default now()
);
create index if not exists idx_fin_lanc_tipo on public.financeiro_lancamentos(tipo);
create index if not exists idx_fin_lanc_pago on public.financeiro_lancamentos(pago);
create index if not exists idx_fin_lanc_fech on public.financeiro_lancamentos(fechamento_id);

-- RLS no padrão do app: staff lê, gestor grava
alter table public.config_pix enable row level security;
alter table public.financeiro_lancamentos enable row level security;

drop policy if exists cpix_select on public.config_pix;
drop policy if exists cpix_write  on public.config_pix;
drop policy if exists flan_select on public.financeiro_lancamentos;
drop policy if exists flan_write  on public.financeiro_lancamentos;

create policy cpix_select on public.config_pix for select to authenticated
  using ( public.is_staff() );
create policy cpix_write on public.config_pix for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy flan_select on public.financeiro_lancamentos for select to authenticated
  using ( public.is_staff() );
create policy flan_write on public.financeiro_lancamentos for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

-- Obs.: a chave 'financeiro' já está no pacote do admin em fn_minhas_permissoes
-- (migração 0001) e no checklist de perfis — o menu deixa de ser EM BREVE no app.
