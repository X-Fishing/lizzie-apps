-- ═══════════════════════════════════════════════════════════════════
-- 0005 — Ação especial: corrigir conferência de maleta finalizada
-- 1) Nova chave de permissão 'acao_editar_maleta_finalizada' (o admin
--    recebe tudo via fn_minhas_permissoes; perfis marcam no checklist —
--    perfil_permissoes já aceita chaves arbitrárias, sem tabela nova).
-- 2) Rastro da correção no cabeçalho da auditoria.
-- 3) RLS de UPDATE/DELETE na auditoria (a 0003 só criou select/insert).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.fn_minhas_permissoes()
returns table(chave_menu text) language sql stable security definer set search_path = public as $$
  select pp.chave_menu from public.funcionarios f
    join public.perfil_permissoes pp on pp.perfil_id = f.perfil_id
    where f.auth_user_id = auth.uid() and f.ativo = true
  union
  select unnest(array[
    'dashboard','vendas_controle','vendas_produtos','vendas_lancar','vendas_troca',
    'financeiro','calculadora','marketing','cad_categorias','cad_colecoes',
    'cad_fornecedores','cad_clientes','cad_revendedoras','cad_garantias',
    'cad_funcionarios','cad_formas_pagamento','cad_categorias_fin',
    'acao_editar_maleta_finalizada'])
  where public.fn_is_admin();
$$;

-- Rastro da correção
alter table public.fechamentos_mostruario
  add column if not exists corrigido_em timestamptz,
  add column if not exists corrigido_por uuid;

-- RLS: correção precisa atualizar o cabeçalho e substituir os itens
drop policy if exists fech_update on public.fechamentos_mostruario;
drop policy if exists fdiv_delete on public.fechamentos_divergencias;

create policy fech_update on public.fechamentos_mostruario for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy fdiv_delete on public.fechamentos_divergencias for delete to authenticated
  using ( public.is_gestor() );
