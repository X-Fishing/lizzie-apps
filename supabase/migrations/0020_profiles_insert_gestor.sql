-- ═══════════════════════════════════════════════════════════════════
-- 0020 — Recria a policy de INSERT do gestor em profiles
-- (numerada 0020: a 0019 "is_revendedora/flag" foi aplicada direto no
--  dashboard e ainda precisa ser versionada como 0019_*.sql à parte.)
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
--
-- Contexto: a migração 0016 definia a policy profiles_insert_gestor, mas
-- ela NÃO estava presente no banco (as demais partes da 0016 — colunas de
-- endereço, default gen_random_uuid() no id e drop da FK id->auth.users —
-- estavam aplicadas). Sem esta policy, o gestor/admin não conseguia
-- pré-cadastrar revendedora: o insert client-side gera um profile com
-- id != auth.uid() e era barrado por RLS (42501) → app mostrava "Erro ao criar".
--
-- A policy profiles_insert_self (with check id = auth.uid()) continua
-- existindo para o fluxo de signup (handle_new_user).
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists profiles_insert_gestor on public.profiles;
create policy profiles_insert_gestor on public.profiles
  for insert to authenticated
  with check ( public.is_gestor() );
