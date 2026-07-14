-- ═══════════════════════════════════════════════════════════════════
-- 0013 — Permissão do menu "Entrada de Mercadoria" (lançamento em lote)
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.fn_minhas_permissoes()
returns table(chave_menu text) language sql stable security definer set search_path = public as $$
  select pp.chave_menu from public.funcionarios f
    join public.perfil_permissoes pp on pp.perfil_id = f.perfil_id
    where f.auth_user_id = auth.uid() and f.ativo = true
  union
  select unnest(array[
    'dashboard','vendas_controle','vendas_produtos','vendas_entrada_mercadoria',
    'vendas_lancar','vendas_troca',
    'financeiro','calculadora','marketing','cad_categorias','cad_colecoes',
    'cad_fornecedores','cad_clientes','cad_revendedoras','cad_garantias',
    'cad_funcionarios','cad_formas_pagamento','cad_categorias_fin',
    'cad_faixas_comissao','cad_precificacao',
    'acao_editar_maleta_finalizada','acao_estornar_recebimento'])
  where public.fn_is_admin();
$$;
