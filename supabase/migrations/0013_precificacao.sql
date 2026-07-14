-- ═══════════════════════════════════════════════════════════════════
-- 0012 — Precificação (substitui o motor da planilha "Cadastro Preço")
-- Fornecedor ganha o desconto como CAMPO (adeus VLOOKUP/#N/A); cotações
-- por tipo de banho e parâmetros globais editáveis no app; produto guarda
-- SNAPSHOT do cálculo (a cotação do ouro muda — histórico não distorce).
-- Obs.: descontos e percentuais em PONTOS PERCENTUAIS (19 = 19%), no
-- mesmo padrão das faixas de comissão do app.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- Parâmetros globais (1 linha, editável na tela Precificação)
create table if not exists public.parametros_precificacao (
  id int primary key default 1,
  mao_de_obra numeric(12,4) not null default 3,
  rateio      numeric(12,4) not null default 4,
  margem      numeric(12,4) not null default 3,
  updated_at  timestamptz default now()
);
insert into public.parametros_precificacao (id) values (1) on conflict (id) do nothing;

-- Tipos de banho + cotação (editável — a cotação do ouro muda)
create table if not exists public.tipos_banho (
  codigo text primary key,          -- 'o','b','n','p','d'
  nome   text not null,
  cotacao numeric(12,4) not null,
  sufixo_nome text,                 -- vai para o nome do produto (ou null)
  ativo boolean not null default true
);
insert into public.tipos_banho (codigo, nome, cotacao, sufixo_nome) values
  ('o', 'Ouro 18k',      815,    'Ouro 18 k'),
  ('b', 'Ródio Branco',  3000,   'Ródio Branco'),
  ('n', 'Ródio Negro',   100000, null),   -- 100000 = trava herdada da planilha; revisar
  ('p', 'Prata',         0.89,   null),
  ('d', 'Diamantado',    100000, null)    -- idem
on conflict (codigo) do nothing;

-- Fornecedor ganha o desconto (19 = 19%)
alter table public.fornecedores
  add column if not exists desconto numeric(5,2) not null default 0;

-- Produto: entradas do cálculo + snapshot dos calculados
alter table public.produtos add column if not exists tipo_banho text references public.tipos_banho(codigo);
alter table public.produtos add column if not exists banho          numeric(12,4) default 0; -- só usado no ouro
alter table public.produtos add column if not exists verniz         numeric(12,4) default 0;
alter table public.produtos add column if not exists peso           numeric(12,4);           -- gramas (p/ cálculo)
alter table public.produtos add column if not exists preco_bruto    numeric(12,2);           -- "peça bruta"
alter table public.produtos add column if not exists modelo         text;
alter table public.produtos add column if not exists custo          numeric(12,2);
alter table public.produtos add column if not exists custo_verniz   numeric(12,2);
alter table public.produtos add column if not exists preco_sugerido numeric(12,2);
alter table public.produtos add column if not exists precificado_em timestamptz;
alter table public.produtos add column if not exists cotacao_usada  numeric(12,4);
alter table public.produtos add column if not exists desconto_usado numeric(5,2);
-- (o "preço final" da planilha = produtos.preco_venda, que já existe;
--  "Cod. Forn" = produtos.codigo_fornecedor, que já existe)

-- RLS no padrão dos cadastros: staff lê, gestor grava
alter table public.parametros_precificacao enable row level security;
alter table public.tipos_banho enable row level security;

drop policy if exists pparam_select on public.parametros_precificacao;
drop policy if exists pparam_write  on public.parametros_precificacao;
drop policy if exists tbanho_select on public.tipos_banho;
drop policy if exists tbanho_write  on public.tipos_banho;

create policy pparam_select on public.parametros_precificacao for select to authenticated
  using ( public.is_staff() );
create policy pparam_write on public.parametros_precificacao for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy tbanho_select on public.tipos_banho for select to authenticated
  using ( public.is_staff() );
create policy tbanho_write on public.tipos_banho for all to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

-- Permissão do novo item de menu "Precificação" (Cadastros) no pacote do admin
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
    'cad_faixas_comissao','cad_precificacao',
    'acao_editar_maleta_finalizada','acao_estornar_recebimento'])
  where public.fn_is_admin();
$$;
