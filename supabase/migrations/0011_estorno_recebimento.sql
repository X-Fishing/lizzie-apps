-- ═══════════════════════════════════════════════════════════════════
-- 0011 — Estorno de recebimento (ação especial por permissão)
-- O lançamento estornado NÃO é deletado (auditoria): fica marcado e o
-- valor volta para a pendência ("A receber") do mesmo fechamento.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- Colunas de auditoria do estorno
alter table public.financeiro_lancamentos
  add column if not exists estornado boolean not null default false,
  add column if not exists estornado_em timestamptz,
  add column if not exists estornado_por uuid,
  add column if not exists estorno_motivo text;

-- Permissão no pacote do admin (array completo e atual)
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
    'cad_faixas_comissao','acao_editar_maleta_finalizada','acao_estornar_recebimento'])
  where public.fn_is_admin();
$$;

-- RLS: a policy flan_write (0009) é "for all" para gestor — já cobre o
-- UPDATE do estorno. Nada a criar aqui.
