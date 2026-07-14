-- ═══════════════════════════════════════════════════════════════════
-- 0012 — Funcionário deixa de nascer como "revendedora pendente"
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
--
-- Problema: handle_new_user cria TODO novo usuário como role='revendedora',
-- aprovada=false. O fn_vincular_funcionario só preenchia auth_user_id, sem
-- tocar em profiles.role — então o funcionário ficava preso na tela
-- "aguardando aprovação" e aparecia na lista de Revendedoras pendentes.
--
-- Correção: o vínculo passa a PROMOVER o profile pelo cadastro de
-- funcionários (is_admin -> 'admin'; demais -> 'func_basico', preservando
-- quem já é gestor/admin) e marcar aprovada=true. Retorna o papel efetivo.
--
-- Detalhe: profiles tem o trigger guard_profile_role, que barra troca de
-- role para quem não é admin (RLS-policies.sql). A promoção do funcionário
-- é feita por função confiável (security definer), então o guard passa a
-- aceitar um "selo" de transação (GUC app.allow_role_change='on') que só
-- código server-side confiável seta — usuário comum nunca consegue setá-lo
-- via API, pois não roda SQL arbitrário.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Guard passa a honrar o selo de transação (além de admin).
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and not public.is_admin()
     and current_setting('app.allow_role_change', true) is distinct from 'on' then
    raise exception 'Apenas admin pode alterar o nivel de acesso';
  end if;
  return new;
end; $$;

-- 2) Vínculo + promoção do papel (return type void -> text: dropar antes).
drop function if exists public.fn_vincular_funcionario();

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

  -- Libera a troca de role SÓ nesta transação (guard_profile_role honra o selo).
  perform set_config('app.allow_role_change', 'on', true);

  -- Promove. Nunca REBAIXA quem já é gestor/admin (troca manual continua valendo).
  update public.profiles
     set role = case
                  when v_admin then 'admin'
                  when role in ('admin', 'func_completo', 'func_basico') then role
                  else 'func_basico'
                end,
         aprovada = true
   where id = v_uid;

  select role into v_role from public.profiles where id = v_uid;
  return v_role;
end;
$$;

revoke all on function public.fn_vincular_funcionario() from public;
grant execute on function public.fn_vincular_funcionario() to authenticated;

-- 3) Conserta quem já está preso como revendedora pendente por ser funcionário.
--    (mesmo selo de transação para passar pelo guard no SQL Editor).
do $$
begin
  perform set_config('app.allow_role_change', 'on', true);
  update public.profiles p
     set role = case when f.is_admin then 'admin' else 'func_basico' end,
         aprovada = true
    from public.funcionarios f
   where f.auth_user_id = p.id
     and f.ativo
     and p.role = 'revendedora';
end $$;
