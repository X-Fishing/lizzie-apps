-- ═══════════════════════════════════════════════════════════════════
-- FIX — venda "Luiz DHL" (R$323,00, Fiado, 10/06/2026) sem cliente_id.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Rodar 1x só.
--
-- DIAGNÓSTICO (20/08/2026, via diagnostico-luiz-dhl-selos.sql):
-- a venda 6aafe89c-0c41-4f8c-9e27-bc4af59d6c95 (R$323,00) tem cliente_id
-- E telefone_cliente NULOS — na hora do lançamento não foi capturado
-- nenhum telefone, então cliente_upsert_para_venda nunca rodou pra ela.
-- Por isso não conta na ficha da cliente (que agrupa por cliente_id) nem
-- gerou selo, embora apareça no Histórico de Vendas (que agrupa por
-- nome_cliente em texto). A outra venda ("Luiz DHL", R$227,00, Pix) já
-- está corretamente vinculada a clientes.id = 7215eeff-5e38-4582-afa2-
-- ee9b310bf283 (celular 5519992061283).
--
-- ⚠ CONFIRME antes de rodar: a consulta 1 do diagnóstico (clientes por
-- celular = '5519992061283') deve trazer só essa linha com esse id. Se
-- trouxer mais de uma cliente ou um id diferente, pare e me chama.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Vincula a venda órfã à cliente certa ─────────────────────────
-- Só toca cliente_id/telefone/auditoria — valor, peças, data e status
-- da venda ficam exatamente como estão.
update public.vendas
   set cliente_id         = '7215eeff-5e38-4582-afa2-ee9b310bf283',
       telefone_cliente   = '5519992061283',
       atualizado_em      = now(),
       atualizacao_motivo = 'Fix manual — telefone nao foi capturado na venda original; cliente identificada por nome (Luiz DHL / Pamela) batendo com a outra venda ja vinculada'
 where id = '6aafe89c-0c41-4f8c-9e27-bc4af59d6c95'
   and cliente_id is null; -- trava: não roda de novo se já tiver sido linkada

-- ── 2) Credita os selos retroativos dessa venda (R$323 → 2 selos) ──
select public.aplicar_fidelidade_venda('6aafe89c-0c41-4f8c-9e27-bc4af59d6c95');

-- ── 3) Confere o resultado — cartela deve estar com 3 selos agora ──
select c.id, c.status, c.selos, c.completada_em
  from public.fidelidade_cartelas c
 where c.cliente_id = '7215eeff-5e38-4582-afa2-ee9b310bf283'
 order by c.created_at desc;
