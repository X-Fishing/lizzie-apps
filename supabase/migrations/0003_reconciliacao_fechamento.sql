-- ═══════════════════════════════════════════════════════════════════
-- 0003 — Reconciliação do fechamento pela conferência física + auditoria
-- A conferência física é o veredito final: peça devolvida NÃO é venda;
-- peça que não voltou É venda (se não estava lançada, fica sinalizada
-- como "Vendido por Divergência"). Tudo por LINHA (consignados.id).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- Flag de venda por divergência na peça (linha física)
alter table public.consignados
  add column if not exists vendido_por_divergencia boolean not null default false;

-- Log de auditoria do fechamento (cabeçalho)
create table if not exists public.fechamentos_mostruario (
  id uuid primary key default gen_random_uuid(),
  pedido_numero text,
  revendedora_id uuid references public.profiles(id) on delete set null,
  revendedora_nome text,
  total_pecas int,
  total_vendidas int,
  total_devolvidas int,
  total_divergencias int,
  finalizado_com_divergencia boolean not null default false,
  admin_user_id uuid,                 -- auth.uid() de quem finalizou
  created_at timestamptz not null default now()
);

-- Log de auditoria do fechamento (itens divergentes)
create table if not exists public.fechamentos_divergencias (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references public.fechamentos_mostruario(id) on delete cascade,
  consignado_id uuid,
  descricao text,
  codigo text,
  tipo text  -- 'vendido_por_divergencia' | 'devolvido_estava_vendido'
);
create index if not exists idx_fech_div_fechamento on public.fechamentos_divergencias(fechamento_id);

-- RLS no padrão do app (staff lê, gestor grava — mesmas funções das maletas)
alter table public.fechamentos_mostruario enable row level security;
alter table public.fechamentos_divergencias enable row level security;

drop policy if exists fech_select on public.fechamentos_mostruario;
drop policy if exists fech_insert on public.fechamentos_mostruario;
drop policy if exists fdiv_select on public.fechamentos_divergencias;
drop policy if exists fdiv_insert on public.fechamentos_divergencias;

create policy fech_select on public.fechamentos_mostruario for select to authenticated
  using ( public.is_staff() );
create policy fech_insert on public.fechamentos_mostruario for insert to authenticated
  with check ( public.is_gestor() );
create policy fdiv_select on public.fechamentos_divergencias for select to authenticated
  using ( public.is_staff() );
create policy fdiv_insert on public.fechamentos_divergencias for insert to authenticated
  with check ( public.is_gestor() );
