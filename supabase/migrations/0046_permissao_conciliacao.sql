-- ═══════════════════════════════════════════════════════════════════
-- 0046 — Admin recebe a chave 'financeiro_conciliacao' no pacote fixo
--        (lista atualizada vs. 0039, que já tinha 'financeiro_contas_pagar').
-- Só afeta o fallback de admin; gestor/staff sem is_admin continuam
-- controlados pela tabela perfil_permissoes (tela Perfis & Permissões).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- IDEMPOTENTE.
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
    'financeiro','financeiro_contas_pagar','financeiro_conciliacao','calculadora','marketing',
    'marketing_fidelidade','marketing_bonus',
    'cad_categorias','cad_colecoes','cad_fornecedores','cad_clientes',
    'cad_revendedoras','cad_garantias','cad_funcionarios','cad_perfis',
    'cad_formas_pagamento','cad_categorias_fin','cad_faixas_comissao',
    'cad_precificacao','cad_raspadinha',
    'acao_editar_maleta_finalizada','acao_estornar_recebimento',
    'acao_completar_venda_antiga'])
  where public.fn_is_admin();
$$;
revoke all on function public.fn_minhas_permissoes() from public;
grant  execute on function public.fn_minhas_permissoes() to authenticated;

select pg_notify('pgrst','reload schema');
