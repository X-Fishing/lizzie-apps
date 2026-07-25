-- ═══════════════════════════════════════════════════════════════════
-- 0037 — CORREÇÃO CRÍTICA: adoção do pré-cadastro quebrava a criação da conta
--
-- SINTOMA: revendedora pré-cadastrada que JÁ TEM maleta (ou contrato emitido)
-- não conseguia criar acesso. Ao se cadastrar, o signUp morria com
-- "Database error saving new user" — e ela voltava para o login, onde só via
-- "e-mail ou senha incorretos". Foi por isso que mandar link/pedir para ela
-- se cadastrar nunca resolveu.
--
-- CAUSA: o trigger handle_new_user (0025) fazia, nesta ordem:
--     update maletas set revendedora_id = new.id ...   ← new.id AINDA NÃO
--     update profiles set id = new.id ...                existe em profiles
-- Como maletas.revendedora_id é NOT NULL REFERENCES profiles(id), a primeira
-- linha viola a FK. Além disso contratos_emissoes e fechamentos_mostruario
-- também apontam para profiles(id) e NÃO eram atualizados nem cascateavam,
-- então o update do profiles.id falharia depois.
--
-- CORREÇÃO:
--   1) toda FK que aponta para profiles(id) passa a ter ON UPDATE CASCADE
--      (o padrão que revendedora_docs já usava desde a 0016);
--   2) o trigger muda o profiles.id PRIMEIRO — os filhos seguem via cascade —
--      e só então acerta as tabelas sem FK;
--   3) o profile passa a guardar o e-mail no cadastro novo (antes ficava NULL,
--      o que impedia vínculo futuro e escondia a revendedora do "Criar acesso").
--
-- Rodar no SQL Editor DEPOIS da 0036. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- 1) ON UPDATE CASCADE em todas as FKs que referenciam profiles(id).
--    Percorre o catálogo: pega qualquer tabela que aponte para profiles e
--    recria a constraint preservando a regra de DELETE existente.
do $$
declare r record;
begin
  for r in
    select con.conname,
           con.conrelid::regclass::text as tabela,
           pg_get_constraintdef(con.oid)  as def
      from pg_constraint con
      join pg_class ref on ref.oid = con.confrelid
     where con.contype = 'f'
       and ref.relname = 'profiles'
       and ref.relnamespace = 'public'::regnamespace
       and pg_get_constraintdef(con.oid) not ilike '%on update cascade%'
  loop
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
    execute format('alter table %s add constraint %I %s on update cascade', r.tabela, r.conname, r.def);
    raise notice 'FK %.% agora tem ON UPDATE CASCADE', r.tabela, r.conname;
  end loop;
end $$;

-- 2) Trigger corrigido: ordem certa + e-mail preenchido no cadastro novo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  -- Pré-cadastro órfão com o mesmo e-mail (sem conta de acesso ainda)?
  select p.id into v_old
    from public.profiles p
   where lower(p.email) = lower(new.email)
     and p.id <> new.id
     and not exists (select 1 from auth.users u where u.id = p.id)
   limit 1;

  if v_old is not null then
    -- ADOÇÃO: o id do profile passa a ser o do login. As FKs com ON UPDATE
    -- CASCADE (maletas, contratos_emissoes, fechamentos, revendedora_docs...)
    -- acompanham sozinhas — por isso este update vem PRIMEIRO.
    update public.profiles set id = new.id where id = v_old;

    -- Tabelas que guardam o id sem FK para profiles: acerta pelo id antigo.
    -- (Se alguma tiver FK, o cascade já resolveu e estes updates são no-op.)
    update public.consignados set revendedora_id = new.id where revendedora_id = v_old;
    update public.garantias    set revendedora_id = new.id where revendedora_id = v_old;
    update public.vendas       set revendedora_id = new.id where revendedora_id = v_old;
    update public.maletas      set revendedora_id = new.id where revendedora_id = v_old;
    return new;
  end if;

  -- Cadastro novo (sem pré-cadastro): grava também o e-mail, senão o profile
  -- nasce sem chave de vínculo e some das ações que dependem de e-mail.
  insert into public.profiles (id, role, is_revendedora, nome, email, telefone, cidade, aprovada)
  values (
    new.id, 'revendedora', true,
    coalesce(
      new.raw_user_meta_data->>'nome',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)),
    lower(new.email),
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
