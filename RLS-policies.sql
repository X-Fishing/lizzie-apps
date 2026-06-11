-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Row Level Security (RLS)
-- ════════════════════════════════════════════════════════════════════
-- Motivo: auditoria de 11/06/2026 mostrou que `profiles` (7 linhas, com
-- telefones = PII/LGPD) e `consignados` (100 linhas) estavam LEGÍVEIS por
-- qualquer pessoa com a anon key pública (que está no index.html).
--
-- COMO APLICAR:
--   1. Supabase → SQL Editor → cole este arquivo inteiro → Run.
--   2. Logo depois, TESTE o app:
--        - login como admin: ver revendedoras, importar Bling, aprovar cadastro;
--        - login como revendedora: ver catálogo, vender, criar garantia.
--      Se algo parar de carregar, é policy faltando — me avise ANTES de
--      desabilitar o RLS de novo.
--   3. Re-rode o teste anônimo: profiles e consignados devem voltar 0 linhas.
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- ════════════════════════════════════════════════════════════════════

-- ── Helper: quem é admin (SECURITY DEFINER evita recursão de RLS) ──────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- profiles
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_insert_self          on public.profiles;
drop policy if exists profiles_update_own            on public.profiles;
drop policy if exists profiles_update_admin          on public.profiles;
drop policy if exists profiles_delete_admin          on public.profiles;

-- Ler: a própria linha, ou tudo se for admin.
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using ( id = auth.uid() or public.is_admin() );

-- Criar: só o próprio registro (id = auth.uid()) no cadastro.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check ( id = auth.uid() );

-- Atualizar a própria linha (NÃO pode se auto-promover a admin nem se auto-aprovar).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and aprovada = (select aprovada from public.profiles where id = auth.uid())
  );

-- Admin atualiza qualquer profile (aprovar/revogar, role, bling_contato_id).
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- Só admin deleta profiles.
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using ( public.is_admin() );

-- ════════════════════════════════════════════════════════════════════
-- consignados  (catálogo)  — coluna dona: revendedora_id
-- ════════════════════════════════════════════════════════════════════
alter table public.consignados enable row level security;

drop policy if exists consignados_select on public.consignados;
drop policy if exists consignados_insert on public.consignados;
drop policy if exists consignados_update on public.consignados;
drop policy if exists consignados_delete on public.consignados;

create policy consignados_select on public.consignados
  for select to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

create policy consignados_insert on public.consignados
  for insert to authenticated
  with check ( revendedora_id = auth.uid() or public.is_admin() );

create policy consignados_update on public.consignados
  for update to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() )
  with check ( revendedora_id = auth.uid() or public.is_admin() );

create policy consignados_delete on public.consignados
  for delete to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

-- ════════════════════════════════════════════════════════════════════
-- garantias  — coluna dona: revendedora_id
-- (auditoria deu 0 linhas anônimas; reforce as policies mesmo assim)
-- ════════════════════════════════════════════════════════════════════
alter table public.garantias enable row level security;

drop policy if exists garantias_select on public.garantias;
drop policy if exists garantias_insert on public.garantias;
drop policy if exists garantias_update on public.garantias;
drop policy if exists garantias_delete on public.garantias;

create policy garantias_select on public.garantias
  for select to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

create policy garantias_insert on public.garantias
  for insert to authenticated
  with check ( revendedora_id = auth.uid() or public.is_admin() );

create policy garantias_update on public.garantias
  for update to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() )
  with check ( revendedora_id = auth.uid() or public.is_admin() );

-- Só admin deleta garantias de terceiros; revendedora deleta as próprias.
create policy garantias_delete on public.garantias
  for delete to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

-- ════════════════════════════════════════════════════════════════════
-- vendas  — coluna dona: revendedora_id
-- ════════════════════════════════════════════════════════════════════
alter table public.vendas enable row level security;

drop policy if exists vendas_select on public.vendas;
drop policy if exists vendas_insert on public.vendas;
drop policy if exists vendas_update on public.vendas;
drop policy if exists vendas_delete on public.vendas;

create policy vendas_select on public.vendas
  for select to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

create policy vendas_insert on public.vendas
  for insert to authenticated
  with check ( revendedora_id = auth.uid() or public.is_admin() );

create policy vendas_update on public.vendas
  for update to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() )
  with check ( revendedora_id = auth.uid() or public.is_admin() );

create policy vendas_delete on public.vendas
  for delete to authenticated
  using ( revendedora_id = auth.uid() or public.is_admin() );

-- ════════════════════════════════════════════════════════════════════
-- venda_itens  — sem coluna dona direta; herda da venda (venda_id)
-- ════════════════════════════════════════════════════════════════════
alter table public.venda_itens enable row level security;

drop policy if exists venda_itens_select on public.venda_itens;
drop policy if exists venda_itens_insert on public.venda_itens;
drop policy if exists venda_itens_update on public.venda_itens;
drop policy if exists venda_itens_delete on public.venda_itens;

create policy venda_itens_select on public.venda_itens
  for select to authenticated
  using ( exists (
    select 1 from public.vendas v
    where v.id = venda_itens.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));

create policy venda_itens_insert on public.venda_itens
  for insert to authenticated
  with check ( exists (
    select 1 from public.vendas v
    where v.id = venda_itens.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));

create policy venda_itens_delete on public.venda_itens
  for delete to authenticated
  using ( exists (
    select 1 from public.vendas v
    where v.id = venda_itens.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));

-- ════════════════════════════════════════════════════════════════════
-- recebimentos  — herda da venda (venda_id)
-- ════════════════════════════════════════════════════════════════════
alter table public.recebimentos enable row level security;

drop policy if exists recebimentos_select on public.recebimentos;
drop policy if exists recebimentos_insert on public.recebimentos;
drop policy if exists recebimentos_delete on public.recebimentos;

create policy recebimentos_select on public.recebimentos
  for select to authenticated
  using ( exists (
    select 1 from public.vendas v
    where v.id = recebimentos.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));

create policy recebimentos_insert on public.recebimentos
  for insert to authenticated
  with check ( exists (
    select 1 from public.vendas v
    where v.id = recebimentos.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));

create policy recebimentos_delete on public.recebimentos
  for delete to authenticated
  using ( exists (
    select 1 from public.vendas v
    where v.id = recebimentos.venda_id
      and ( v.revendedora_id = auth.uid() or public.is_admin() )
  ));
