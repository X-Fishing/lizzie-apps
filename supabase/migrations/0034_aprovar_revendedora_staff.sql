-- ═══════════════════════════════════════════════════════════════════
-- 0034 — Aprovar/revogar/editar revendedora liberado para qualquer funcionária
-- Antes: só gestor (admin + func_completo) atualizava profiles de terceiros
--        (policy profiles_update_gestor = is_gestor()).
-- Agora: is_staff() — qualquer funcionária com acesso à tela Revendedoras
--        pode aprovar/revogar/editar.
-- Continua protegido:
--   • trocar role/is_revendedora → só admin (trigger guard_profile_role);
--   • excluir profile → só admin (profiles_delete_admin);
--   • criar novo pré-cadastro (INSERT com id de terceiro) → continua gestor
--     (profiles_insert_gestor) — aqui só a edição/aprovação é aberta.
-- Rodar no SQL Editor. Idempotente. (RLS-policies.sql já reflete isto.)
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists profiles_update_gestor on public.profiles;
drop policy if exists profiles_update_staff  on public.profiles;

create policy profiles_update_staff on public.profiles
  for update to authenticated
  using ( public.is_staff() )
  with check ( public.is_staff() );
