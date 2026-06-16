-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Row Level Security (RLS) + Níveis de acesso
-- ════════════════════════════════════════════════════════════════════
-- Níveis (coluna profiles.role):
--   revendedora    -> vê/gere só o próprio (catálogo, vendas, garantias)
--   func_basico    -> staff: VÊ tudo, registra garantias; NÃO importa Bling,
--                     NÃO gere catálogo, NÃO mexe em revendedoras
--   func_completo  -> gestor: Bling, gere/exclui catálogo, aprova revendedoras
--   admin          -> tudo + define papéis + exclui revendedoras
--
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- Idempotente (dropa tudo e recria). Rode toda vez que mudar o modelo.
-- ════════════════════════════════════════════════════════════════════

-- ── Helpers (SECURITY DEFINER evitam recursão de RLS) ─────────────────
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.is_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','func_completo'));
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','func_completo','func_basico'));
$$;
revoke all on function public.is_admin()  from public;
revoke all on function public.is_gestor() from public;
revoke all on function public.is_staff()  from public;
grant execute on function public.is_admin()  to authenticated;
grant execute on function public.is_gestor() to authenticated;
grant execute on function public.is_staff()  to authenticated;

-- ── Só admin pode alterar o nível (role) de qualquer profile ──────────
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Apenas admin pode alterar o nivel de acesso';
  end if;
  return new;
end; $$;

-- ── LIMPEZA: derruba TODAS as policies das tabelas antes de recriar ───
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','consignados','garantias','vendas','venda_itens','recebimentos')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- profiles
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;

drop trigger if exists guard_profile_role_trg on public.profiles;
create trigger guard_profile_role_trg before update on public.profiles
  for each row execute function public.guard_profile_role();

-- Ler: a própria linha, ou tudo se for staff.
create policy profiles_select on public.profiles
  for select to authenticated
  using ( id = auth.uid() or public.is_staff() );

-- Criar: só o próprio registro (cadastro).
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check ( id = auth.uid() );

-- Atualizar a própria linha (sem se auto-promover nem se auto-aprovar).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and aprovada = (select aprovada from public.profiles where id = auth.uid())
  );

-- Gestor/admin atualizam qualquer profile (aprovar/revogar, bling_id).
-- Troca de role é barrada para não-admin pelo trigger guard_profile_role.
create policy profiles_update_gestor on public.profiles
  for update to authenticated
  using ( public.is_gestor() )
  with check ( public.is_gestor() );

-- Só admin deleta profiles (excluir revendedora).
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using ( public.is_admin() );

-- ════════════════════════════════════════════════════════════════════
-- consignados (catálogo) — escrita: dono OU gestor
-- ════════════════════════════════════════════════════════════════════
alter table public.consignados enable row level security;
create policy consignados_select on public.consignados
  for select to authenticated using ( revendedora_id = auth.uid() or public.is_staff() );
create policy consignados_insert on public.consignados
  for insert to authenticated with check ( revendedora_id = auth.uid() or public.is_gestor() );
create policy consignados_update on public.consignados
  for update to authenticated using ( revendedora_id = auth.uid() or public.is_gestor() )
  with check ( revendedora_id = auth.uid() or public.is_gestor() );
create policy consignados_delete on public.consignados
  for delete to authenticated using ( revendedora_id = auth.uid() or public.is_gestor() );

-- ════════════════════════════════════════════════════════════════════
-- garantias — registrar: dono OU staff; excluir: dono OU gestor
-- ════════════════════════════════════════════════════════════════════
alter table public.garantias enable row level security;
create policy garantias_select on public.garantias
  for select to authenticated using ( revendedora_id = auth.uid() or public.is_staff() );
create policy garantias_insert on public.garantias
  for insert to authenticated with check ( revendedora_id = auth.uid() or public.is_staff() );
create policy garantias_update on public.garantias
  for update to authenticated using ( revendedora_id = auth.uid() or public.is_staff() )
  with check ( revendedora_id = auth.uid() or public.is_staff() );
create policy garantias_delete on public.garantias
  for delete to authenticated using ( revendedora_id = auth.uid() or public.is_gestor() );

-- ════════════════════════════════════════════════════════════════════
-- vendas — dono OU staff
-- ════════════════════════════════════════════════════════════════════
alter table public.vendas enable row level security;
create policy vendas_select on public.vendas
  for select to authenticated using ( revendedora_id = auth.uid() or public.is_staff() );
create policy vendas_insert on public.vendas
  for insert to authenticated with check ( revendedora_id = auth.uid() or public.is_staff() );
create policy vendas_update on public.vendas
  for update to authenticated using ( revendedora_id = auth.uid() or public.is_staff() )
  with check ( revendedora_id = auth.uid() or public.is_staff() );
create policy vendas_delete on public.vendas
  for delete to authenticated using ( revendedora_id = auth.uid() or public.is_staff() );

-- ════════════════════════════════════════════════════════════════════
-- venda_itens — herda da venda
-- ════════════════════════════════════════════════════════════════════
alter table public.venda_itens enable row level security;
create policy venda_itens_select on public.venda_itens for select to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_itens.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_itens_insert on public.venda_itens for insert to authenticated
  with check ( exists (select 1 from public.vendas v where v.id = venda_itens.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_itens_delete on public.venda_itens for delete to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_itens.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );

-- ════════════════════════════════════════════════════════════════════
-- recebimentos — herda da venda
-- ════════════════════════════════════════════════════════════════════
alter table public.recebimentos enable row level security;
create policy recebimentos_select on public.recebimentos for select to authenticated
  using ( exists (select 1 from public.vendas v where v.id = recebimentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy recebimentos_insert on public.recebimentos for insert to authenticated
  with check ( exists (select 1 from public.vendas v where v.id = recebimentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy recebimentos_delete on public.recebimentos for delete to authenticated
  using ( exists (select 1 from public.vendas v where v.id = recebimentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
