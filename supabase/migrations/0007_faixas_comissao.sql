-- ═══════════════════════════════════════════════════════════════════
-- 0007 — Faixas de Comissão (editáveis em Cadastros) + comissão no
-- fechamento do mostruário.
-- Match: valor_min <= total_vendido and (valor_max is null or total <= valor_max),
-- só faixas ativas. Sem faixa casando => 0% (o app avisa "sem faixa definida").
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.faixas_comissao (
  id uuid primary key default gen_random_uuid(),
  valor_min numeric(12,2) not null,        -- início da faixa (inclusive)
  valor_max numeric(12,2),                 -- fim (inclusive); NULL = "acima de"
  percentual numeric(5,2) not null,        -- ex.: 30.00
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comissão aplicada no fechamento (gravada na auditoria)
alter table public.fechamentos_mostruario
  add column if not exists comissao_percentual numeric(5,2),
  add column if not exists comissao_valor numeric(12,2),
  add column if not exists valor_a_receber numeric(12,2),
  add column if not exists total_vendido_valor numeric(12,2);

-- RLS no padrão dos cadastros: staff lê, gestor grava
alter table public.faixas_comissao enable row level security;
drop policy if exists faixas_select on public.faixas_comissao;
drop policy if exists faixas_write  on public.faixas_comissao;
create policy faixas_select on public.faixas_comissao for select to authenticated
  using ( public.is_staff() );
create policy faixas_write on public.faixas_comissao for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

-- Permissão do novo item de menu no pacote do admin
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
    'cad_funcionarios','cad_formas_pagamento','cad_categorias_fin',
    'cad_faixas_comissao','acao_editar_maleta_finalizada'])
  where public.fn_is_admin();
$$;

-- Seed de exemplo (descomente e AJUSTE os valores reais):
-- insert into public.faixas_comissao (valor_min, valor_max, percentual) values
--   (0,       1999.99, 25.00),
--   (2000,    3999.99, 30.00),
--   (4000,    null,    35.00);
