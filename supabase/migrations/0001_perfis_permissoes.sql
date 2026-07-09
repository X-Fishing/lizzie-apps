-- ═══════════════════════════════════════════════════════════════════
-- 0001 — Perfis (cargos) e permissões de menu + tabela de funcionários
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
-- Granularidade: a permissão decide se o funcionário VÊ/acessa o item
-- de menu; ações internas ficam liberadas para quem tem acesso.
-- ═══════════════════════════════════════════════════════════════════

-- Perfis (cargos): ex. "Vendedora", "Estoque"
create table if not exists public.perfis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text,
  is_sistema boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chaves de menu liberadas por perfil
create table if not exists public.perfil_permissoes (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  chave_menu text not null,
  primary key (perfil_id, chave_menu)
);
create index if not exists idx_perfil_permissoes_perfil on public.perfil_permissoes(perfil_id);

-- Funcionários (vinculados ao auth.users pelo e-mail no primeiro login)
create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  email text unique,
  perfil_id uuid references public.perfis(id) on delete set null,
  is_admin boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Se a tabela funcionarios JÁ existir com outro formato, rode no lugar do create:
-- alter table public.funcionarios add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
-- alter table public.funcionarios add column if not exists perfil_id uuid references public.perfis(id) on delete set null;
-- alter table public.funcionarios add column if not exists is_admin boolean not null default false;
create index if not exists idx_funcionarios_auth on public.funcionarios(auth_user_id);

-- Perfil de sistema (bloqueado para edição/exclusão no app)
insert into public.perfis (nome, descricao, is_sistema)
values ('Administrador', 'Acesso total ao sistema', true)
on conflict (nome) do nothing;

-- Admins iniciais: cria/atualiza o registro de funcionário já vinculado
insert into public.funcionarios (nome, email, is_admin, auth_user_id)
select coalesce(p.nome, u.email), u.email, true, u.id
from auth.users u
left join public.profiles p on p.id = u.id
where u.email in ('rondoncoutinho@gmail.com', 'lidiane.sfigueiredo@gmail.com')
on conflict (email) do update set is_admin = true, auth_user_id = excluded.auth_user_id;

-- ── Funções (security definer p/ não esbarrar em RLS) ───────────────
create or replace function public.fn_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.funcionarios
    where auth_user_id = auth.uid() and ativo = true), false);
$$;

-- Permissões do usuário logado (admin recebe todas as chaves)
create or replace function public.fn_minhas_permissoes()
returns table(chave_menu text) language sql stable security definer set search_path = public as $$
  select pp.chave_menu from public.funcionarios f
    join public.perfil_permissoes pp on pp.perfil_id = f.perfil_id
    where f.auth_user_id = auth.uid() and f.ativo = true
  union
  select unnest(array[
    'dashboard','vendas_controle','vendas_produtos','vendas_lancar','vendas_troca',
    'financeiro','calculadora','marketing','cad_categorias','cad_colecoes',
    'cad_fornecedores','cad_clientes','cad_revendedoras','cad_garantias',
    'cad_funcionarios','cad_formas_pagamento','cad_categorias_fin'])
  where public.fn_is_admin();
$$;

-- Auto-vínculo no primeiro login: liga o funcionário (criado por e-mail
-- pelo admin) ao auth.users do usuário logado.
create or replace function public.fn_vincular_funcionario()
returns void language sql security definer set search_path = public as $$
  update public.funcionarios set auth_user_id = auth.uid()
  where auth_user_id is null
    and lower(email) = lower((select email from auth.users where id = auth.uid()));
$$;

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.perfis enable row level security;
alter table public.perfil_permissoes enable row level security;
alter table public.funcionarios enable row level security;

drop policy if exists perfis_admin_all on public.perfis;
drop policy if exists perfis_read_all  on public.perfis;
drop policy if exists pp_admin_write   on public.perfil_permissoes;
drop policy if exists pp_read_all      on public.perfil_permissoes;
drop policy if exists func_admin_all   on public.funcionarios;
drop policy if exists func_self_read   on public.funcionarios;

create policy perfis_admin_all on public.perfis for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy perfis_read_all  on public.perfis for select using (true);
create policy pp_admin_write   on public.perfil_permissoes for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy pp_read_all      on public.perfil_permissoes for select using (true);
create policy func_admin_all   on public.funcionarios for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy func_self_read   on public.funcionarios for select using (auth_user_id = auth.uid());

-- ── Diagnóstico ─────────────────────────────────────────────────────
-- Se o app acusar "acesso negado (RLS)" ao salvar funcionário/perfil,
-- o admin logado não está vinculado (fn_is_admin() = false). Re-vincule:
-- update public.funcionarios f set auth_user_id = u.id
--   from auth.users u
--   where u.email = f.email and f.is_admin = true and f.auth_user_id is null;
