-- ═══════════════════════════════════════════════════════════════════
-- 0042 — Hardening de RLS (achados do SAST). COMO APLICAR: Supabase →
--        SQL Editor → Run. Depois: select pg_notify('pgrst','reload schema');
-- Idempotente (create or replace / drop+create policy).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) buscar_cliente_por_telefone: NÃO vazar cliente de OUTRA revendedora ──
-- Era SECURITY DEFINER e ignorava a RLS de `clientes`: qualquer revendedora,
-- sabendo/adivinhando um celular, obtinha nome+nascimento+selos de cliente
-- alheio. Agora escopa igual à RLS de clientes: staff vê todos; a revendedora
-- só acha cliente com quem ELA já vendeu.
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, nascimento date, selos integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.data_nascimento, coalesce(f.selos, 0)
    from public.clientes c
    left join public.fidelidade_cartelas f
      on f.cliente_id = c.id and f.status = 'aberta'
   where public.tel_br_valido(p_telefone)
     and c.celular = public.tel_normalizado(p_telefone)
     and (
       public.is_staff()
       or exists (select 1 from public.vendas v
                  where v.cliente_id = c.id and v.revendedora_id = auth.uid())
     )
   limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public, anon;
grant  execute on function public.buscar_cliente_por_telefone(text) to authenticated;

-- ── 2) profiles_update_staff: staff só edita profiles de REVENDEDORA ──
-- Antes: is_staff() sozinho deixava func_basico editar profiles de OUTROS
-- funcionários (nome/telefone/aprovada). Escopa a linhas de revendedora.
-- (Troca de role/flags já é barrada pelo trigger guard_profile_role.)
drop policy if exists profiles_update_staff on public.profiles;
create policy profiles_update_staff on public.profiles
  for update to authenticated
  using ( public.is_staff() and (is_revendedora = true or role = 'revendedora') )
  with check ( public.is_staff() and (is_revendedora = true or role = 'revendedora') );

-- ── 3) perfis / perfil_permissoes: exigir login (não expor a anon) ──
-- Antes: `using (true)` sem `to authenticated` → legível pelo role PUBLIC/anon.
drop policy if exists perfis_read_all on public.perfis;
create policy perfis_read_all on public.perfis
  for select to authenticated using (true);
drop policy if exists pp_read_all on public.perfil_permissoes;
create policy pp_read_all on public.perfil_permissoes
  for select to authenticated using (true);
