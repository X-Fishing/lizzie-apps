-- ═══════════════════════════════════════════════════════════════════
-- 0016 — Cadastro completo de Revendedoras (dados do contrato)
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
--
-- 1) profiles ganha os campos NÃO sensíveis do endereço/contato.
-- 2) Gestor passa a poder CRIAR revendedora sem login (pré-cadastro):
--    dropa o FK profiles.id->auth.users e dá default gen_random_uuid().
-- 3) Dados sensíveis (CPF/RG/nascimento/fiador) numa tabela À PARTE
--    (revendedora_docs) com RLS só gestor/admin (LGPD) — func_basico NÃO lê.
-- 4) Vínculo automático: quem foi pré-cadastrada e depois cria conta no app
--    com o mesmo e-mail assume o cadastro existente (sem duplicar).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Campos não sensíveis em profiles (staff já enxerga) ──────────
alter table public.profiles
  add column if not exists email       text,
  add column if not exists cep         text,
  add column if not exists logradouro  text,
  add column if not exists numero      text,
  add column if not exists complemento text,
  add column if not exists bairro      text,
  add column if not exists estado      text;
-- (nome, telefone, cidade, created_at, foto_url já existem)

-- ── 2) Permitir profile SEM login (pré-cadastro pelo gestor) ────────
-- Dropa qualquer FK de profiles.id -> auth.users (nome varia por projeto).
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'profiles'
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.profiles alter column id set default gen_random_uuid();

-- Policy: gestor/admin cria profile (a insert_self continua pro signup).
drop policy if exists profiles_insert_gestor on public.profiles;
create policy profiles_insert_gestor on public.profiles
  for insert to authenticated
  with check ( public.is_gestor() );

-- ── 3) Documentos sensíveis (LGPD) — tabela separada ────────────────
create table if not exists public.revendedora_docs (
  profile_id uuid primary key references public.profiles(id) on delete cascade on update cascade,
  cpf text, rg text, data_nascimento date,
  fiador_nome text, fiador_cpf text, fiador_rg text,
  fiador_endereco text, fiador_email text, fiador_telefone text,
  updated_at timestamptz not null default now()
);

alter table public.revendedora_docs enable row level security;
drop policy if exists revdocs_select on public.revendedora_docs;
drop policy if exists revdocs_insert on public.revendedora_docs;
drop policy if exists revdocs_update on public.revendedora_docs;
drop policy if exists revdocs_delete on public.revendedora_docs;
-- A própria dona vê/edita os seus; gestor/admin veem/editam todos.
-- func_basico NÃO tem acesso (nem via API). Sem acesso anônimo.
create policy revdocs_select on public.revendedora_docs
  for select to authenticated using ( profile_id = auth.uid() or public.is_gestor() );
create policy revdocs_insert on public.revendedora_docs
  for insert to authenticated with check ( profile_id = auth.uid() or public.is_gestor() );
create policy revdocs_update on public.revendedora_docs
  for update to authenticated using ( profile_id = auth.uid() or public.is_gestor() )
  with check ( profile_id = auth.uid() or public.is_gestor() );
create policy revdocs_delete on public.revendedora_docs
  for delete to authenticated using ( public.is_gestor() );

-- ── 4) Vínculo automático do pré-cadastro no 1º login ───────────────
-- Se existe um profile ÓRFÃO (sem login) com o mesmo e-mail, o novo usuário
-- assume esse cadastro (reaponta id) em vez de criar outro. As tabelas-filho
-- referenciam revendedora_id (sem FK) — reapontamos na mão; revendedora_docs
-- acompanha por on update cascade.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  select p.id into v_old
    from public.profiles p
   where lower(p.email) = lower(new.email)
     and p.id <> new.id
     and not exists (select 1 from auth.users u where u.id = p.id)
   limit 1;

  if v_old is not null then
    -- Reaponta os dados operacionais do id antigo para o novo (o login).
    update public.consignados set revendedora_id = new.id where revendedora_id = v_old;
    update public.garantias    set revendedora_id = new.id where revendedora_id = v_old;
    update public.vendas       set revendedora_id = new.id where revendedora_id = v_old;
    update public.maletas      set revendedora_id = new.id where revendedora_id = v_old;
    update public.profiles     set id = new.id where id = v_old;  -- revendedora_docs cascata
    return new;
  end if;

  insert into public.profiles (id, role, nome, telefone, cidade, aprovada)
  values (
    new.id, 'revendedora',
    coalesce(
      new.raw_user_meta_data->>'nome',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'cidade',
    false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
