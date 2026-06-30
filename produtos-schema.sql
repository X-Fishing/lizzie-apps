-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Cadastro próprio de Produtos (saída do Bling)
-- ════════════════════════════════════════════════════════════════════
-- Cria as tabelas do catálogo-mestre próprio do sistema:
--   categorias, colecoes, fornecedores, produtos, produto_variacoes
-- + RLS (staff lê, gestor/admin gerencia) + vínculo opcional em consignados.
--
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- Idempotente: pode rodar várias vezes (create if not exists / replace).
-- Depende de RLS-policies.sql (helpers is_staff/is_gestor) já aplicado.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── trigger genérico de updated_at ────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════
-- categorias
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists categorias_nome_uniq
  on public.categorias (lower(nome));

-- ════════════════════════════════════════════════════════════════════
-- colecoes  (no lugar do "lote" do Bling)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.colecoes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ano        integer,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists colecoes_nome_uniq
  on public.colecoes (lower(nome));

-- ════════════════════════════════════════════════════════════════════
-- fornecedores  (compartilhada: cadastro central + atalho no produto)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.fornecedores (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj_cpf   text,
  telefone   text,
  email      text,
  contato    text,
  observacao text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- produtos  (catálogo-mestre)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.produtos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  sku            text,                       -- Código (SKU) interno
  codigo_barras  text,                       -- GTIN/EAN — lido no bipe
  preco_venda    numeric(12,2) not null default 0,
  custo_compra   numeric(12,2) not null default 0,
  categoria_id   uuid references public.categorias(id)  on delete set null,
  colecao_id     uuid references public.colecoes(id)    on delete set null,
  fornecedor_id  uuid references public.fornecedores(id) on delete set null,
  formato        text not null default 'simples',  -- 'simples' | 'variacao'
  peso_liquido   numeric(12,3),
  peso_bruto     numeric(12,3),
  largura        numeric(12,2),
  altura         numeric(12,2),
  profundidade   numeric(12,2),
  descricao_curta text,
  foto_url       text,
  estoque_qtd    integer not null default 0,  -- saldo central (empresa)
  deposito       text not null default 'Geral',
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- SKU e código de barras únicos quando preenchidos (não bloqueia nulos).
create unique index if not exists produtos_sku_uniq
  on public.produtos (sku) where sku is not null and sku <> '';
create unique index if not exists produtos_codbarras_uniq
  on public.produtos (codigo_barras) where codigo_barras is not null and codigo_barras <> '';
create index if not exists produtos_categoria_idx on public.produtos (categoria_id);
create index if not exists produtos_colecao_idx   on public.produtos (colecao_id);

drop trigger if exists produtos_set_updated_at on public.produtos;
create trigger produtos_set_updated_at before update on public.produtos
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- produto_variacoes  (cor, tamanho, etc.)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.produto_variacoes (
  id            uuid primary key default gen_random_uuid(),
  produto_id    uuid not null references public.produtos(id) on delete cascade,
  atributo      text not null,               -- ex.: "Cor"
  valor         text not null,               -- ex.: "Dourado"
  sku           text,
  codigo_barras text,
  preco_venda   numeric(12,2),
  estoque_qtd   integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists prod_var_produto_idx on public.produto_variacoes (produto_id);
create unique index if not exists prod_var_codbarras_uniq
  on public.produto_variacoes (codigo_barras) where codigo_barras is not null and codigo_barras <> '';

-- ════════════════════════════════════════════════════════════════════
-- vínculo opcional do catálogo da revendedora ao produto-mestre
-- (não quebra nada existente; serve para o lançador com bipe)
-- ════════════════════════════════════════════════════════════════════
alter table public.consignados
  add column if not exists produto_id uuid references public.produtos(id) on delete set null;

-- ════════════════════════════════════════════════════════════════════
-- RLS — staff lê tudo; gestor/admin gerencia (insert/update/delete)
-- ════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('categorias','colecoes','fornecedores','produtos','produto_variacoes')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- helper: aplica o mesmo conjunto de policies "staff lê / gestor gerencia"
do $$
declare t text;
begin
  foreach t in array array['categorias','colecoes','fornecedores','produtos','produto_variacoes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($f$create policy %I on public.%I for select to authenticated using ( public.is_staff() )$f$,
                   t||'_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated with check ( public.is_gestor() )$f$,
                   t||'_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() )$f$,
                   t||'_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated using ( public.is_gestor() )$f$,
                   t||'_delete', t);
  end loop;
end $$;

-- FIM
