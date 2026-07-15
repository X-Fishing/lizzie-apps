-- ═══════════════════════════════════════════════════════════════════
-- 0019 — Separar "nível de acesso" (role) de "é revendedora" (flag)
-- Duas dimensões independentes: profiles.role continua sendo o acesso;
-- profiles.is_revendedora diz se a pessoa aparece na lista de revendedoras
-- (tem consignados/garantias/contrato). Uma funcionária pode revender.
-- Invariante: role='revendedora' ⟹ is_revendedora=true.
--
-- NOTA: esta migração foi originalmente aplicada direto no SQL Editor do
-- Supabase (dashboard) e só depois versionada aqui a partir do log, para
-- manter a sequência de migrações completa. Idempotente.
--
-- Depois de rodar, RE-RODAR o RLS-policies.sql inteiro (o trigger
-- guard_profile_role passou a proteger is_revendedora também).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Nova coluna
alter table public.profiles
  add column if not exists is_revendedora boolean not null default false;

-- 2) Backfill: quem já é role='revendedora' passa a ter a flag
update public.profiles set is_revendedora = true where role = 'revendedora';

-- 3) Invariante (após o backfill, os dados já respeitam)
alter table public.profiles drop constraint if exists profiles_revendedora_flag_chk;
alter table public.profiles
  add constraint profiles_revendedora_flag_chk
  check (role <> 'revendedora' or is_revendedora = true);

-- 4) Índice para a listagem por flag
create index if not exists profiles_is_revendedora_idx
  on public.profiles (is_revendedora) where is_revendedora = true;

-- 5) UF válida (2 letras maiúsculas) — corrige o bug do "464".
--    NOT VALID: enforça em novos INSERT/UPDATE sem falhar em dados legados
--    ruins (ex.: um cadastro de teste com estado='464'). Ao editar aquela
--    linha, o front (select de UF) já grava um valor válido.
--    Antes de VALIDAR no futuro, limpe: select id,nome,estado from profiles
--    where estado is not null and estado !~ '^[A-Z]{2}$';
alter table public.profiles drop constraint if exists profiles_estado_uf_chk;
alter table public.profiles
  add constraint profiles_estado_uf_chk
  check (estado is null or estado ~ '^[A-Z]{2}$') not valid;

-- 6) CPF único (impede cadastro duplicado da mesma pessoa). O CPF está em
--    revendedora_docs (LGPD), não em profiles.
--    ANTES de rodar, cheque duplicados (a criação falha se houver):
--    select cpf, count(*) from revendedora_docs where cpf is not null
--      group by cpf having count(*) > 1;
create unique index if not exists revendedora_docs_cpf_uniq
  on public.revendedora_docs (cpf) where cpf is not null;

-- 7) Novo signup cria role='revendedora' — agora TEM que marcar a flag,
--    senão a invariante do passo 3 barra o cadastro. Recria o trigger da
--    0016 com is_revendedora=true no insert (mantém o vínculo por e-mail).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  select p.id into v_old
    from public.profiles p
   where lower(p.email) = lower(new.email)
     and p.id <> new.id
     and not exists (select 1 from auth.users u where u.id = p.id)
   limit 1;

  if v_old is not null then
    update public.consignados set revendedora_id = new.id where revendedora_id = v_old;
    update public.garantias    set revendedora_id = new.id where revendedora_id = v_old;
    update public.vendas       set revendedora_id = new.id where revendedora_id = v_old;
    update public.maletas      set revendedora_id = new.id where revendedora_id = v_old;
    update public.profiles     set id = new.id where id = v_old;
    return new;
  end if;

  insert into public.profiles (id, role, is_revendedora, nome, telefone, cidade, aprovada)
  values (
    new.id, 'revendedora', true,
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
