-- ═══════════════════════════════════════════════════════════════════
-- 0021 — Papel duplo funcionária/revendedora.
-- A flag profiles.is_revendedora (0019) já separa "é revendedora" do role.
-- Aqui:
--   (a) intenção de revendedora no cadastro de funcionário (sobrevive ao 1º login);
--   (b) guard_profile_role passa a honrar o selo app.allow_role_change (senão a
--       promoção de revendedora->func_basico no 1º login quebra p/ não-admin);
--   (c) fn_vincular_funcionario copia funcionarios.eh_revendedora -> is_revendedora;
--   (d) reparo de quem virou funcionária e perdeu a flag antes do backfill da 0019.
-- ORDEM IMPORTA: o guard (b) precisa existir ANTES do reparo (d), e o reparo roda
-- sob o selo (no SQL Editor não há auth.uid(), então sem o selo o guard barra).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- (a) Intenção marcada no cadastro de funcionário (copiada p/ o profile no login).
alter table public.funcionarios
  add column if not exists eh_revendedora boolean not null default false;

-- (b) guard_profile_role: honra o selo que as RPCs SECURITY DEFINER já setam.
--     O caminho da UI (profiles.update direto) NÃO seta o selo -> continua só-admin.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.is_revendedora is distinct from old.is_revendedora)
     and not public.is_admin()
     and coalesce(current_setting('app.allow_role_change', true), 'off') <> 'on' then
    raise exception 'Apenas admin pode alterar o nivel de acesso ou a flag de revendedora';
  end if;
  return new;
end; $$;

-- (c) fn_vincular_funcionario: no vínculo/promoção (já sob o selo), copia a
--     intenção eh_revendedora para a flag do profile, preservando quando já true.
create or replace function public.fn_vincular_funcionario()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_admin boolean;
  v_role  text;
begin
  if v_uid is null then return null; end if;
  select email into v_email from auth.users where id = v_uid;

  -- Vínculo (idempotente): casa o funcionário cadastrado pelo e-mail.
  update public.funcionarios
     set auth_user_id = v_uid
   where auth_user_id is null
     and lower(email) = lower(v_email);

  -- É funcionário ativo? Pega o nível.
  select is_admin into v_admin
    from public.funcionarios
   where auth_user_id = v_uid and ativo
   limit 1;

  if not found then
    return null;  -- não é funcionário: segue como revendedora (fluxo normal)
  end if;

  -- Libera a troca de role/flag SÓ nesta transação (guard_profile_role honra o selo).
  perform set_config('app.allow_role_change', 'on', true);

  -- Promove. Nunca REBAIXA quem já é gestor/admin (troca manual continua valendo).
  -- Copia a intenção de revendedora do cadastro para a flag (preserva se já true).
  update public.profiles p
     set role = case
                  when v_admin then 'admin'
                  when role in ('admin', 'func_completo', 'func_basico') then role
                  else 'func_basico'
                end,
         aprovada = true,
         is_revendedora = p.is_revendedora
           or coalesce((select f.eh_revendedora from public.funcionarios f
                        where f.auth_user_id = v_uid and f.ativo limit 1), false)
   where p.id = v_uid;

  select role into v_role from public.profiles where id = v_uid;
  return v_role;
end;
$$;

revoke all on function public.fn_vincular_funcionario() from public;
grant execute on function public.fn_vincular_funcionario() to authenticated;

-- (d) Reparo (sob o selo, pois o SQL Editor não é "admin"): quem tem vínculo em
--     funcionarios E dados de revendedora (consignados próprios) e ficou sem a
--     flag, remarca. No banco atual isso atinge a LIDIANE OFICIAL (88 consignados).
--     Para marcar alguém específico depois: set_config + update por uuid.
-- Bloco único (mesma transação) para o selo cobrir os updates com certeza.
do $$
begin
  perform set_config('app.allow_role_change', 'on', true);

  update public.profiles p set is_revendedora = true
  where is_revendedora = false
    and exists (select 1 from public.funcionarios f where f.auth_user_id = p.id)
    and exists (select 1 from public.consignados c where c.revendedora_id = p.id);

  -- Alinha a intenção do funcionário com a flag atual do profile já vinculado.
  update public.funcionarios f set eh_revendedora = true
  from public.profiles p
  where p.id = f.auth_user_id and p.is_revendedora = true and f.eh_revendedora = false;
end $$;
