-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — peças "órfãs" (consignados ativo com maleta_id nulo)
-- NÃO é migração: a seção 1 só lê. Rode no SQL Editor quando quiser.
--
-- CONTEXTO (17/08/2026): o caso da revendedora Leina (ver
-- diagnostico-leina-maleta.sql) confirmou a causa #5 do pipeline
-- Bling→app — um sync incremental gravou 13 peças (pedido #18711,
-- mesmíssimo timestamp — um lote só) SEM vincular a nenhuma maleta.
-- Como a tela da revendedora só mostra `consignados.maleta_id ===
-- maleta ATIVA dela`, essas linhas ficam invisíveis pra sempre, mesmo
-- existindo na tabela. Este script checa se outras revendedoras têm o
-- mesmo problema, e a seção 2 (comentada) conserta todo mundo de uma vez.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Quantas peças órfãs cada revendedora tem, e desde quando ───────
-- (status='ativo': só o que ainda está em campo — peça já vendida/encerrada
-- não precisa de maleta_id pra aparecer em lugar nenhum)
select p.nome as revendedora, count(*) as pecas_orfas,
       min(c.created_at) as orfa_mais_antiga, max(c.created_at) as orfa_mais_recente,
       array_agg(distinct c.pedido_numero) as pedidos_envolvidos
  from public.consignados c
  join public.profiles p on p.id = c.revendedora_id
 where c.status = 'ativo' and c.maleta_id is null
 group by p.nome
 order by pecas_orfas desc;

-- ── (detalhe linha a linha, se quiser conferir antes de rodar o conserto) ──
-- select c.id, p.nome as revendedora, c.referencia, c.descricao, c.pedido_numero, c.created_at
--   from public.consignados c
--   join public.profiles p on p.id = c.revendedora_id
--  where c.status = 'ativo' and c.maleta_id is null
--  order by p.nome, c.created_at;

-- ═══════════════════════════════════════════════════════════════════
-- 2) CONSERTO (não é read-only — revise a seção 1 antes de rodar isto).
-- Vincula cada peça órfã à maleta ATIVA da PRÓPRIA revendedora dela
-- (join correlacionado — cada linha vai pra maleta certa, não uma só
-- pra todo mundo). Revendedora sem maleta ativa no momento fica de fora
-- (não haveria maleta certa pra apontar) — rode nela de novo depois que
-- a maleta ativa existir.
-- ═══════════════════════════════════════════════════════════════════
-- update public.consignados c
--    set maleta_id = m.id
--   from public.maletas m
--  where c.status = 'ativo'
--    and c.maleta_id is null
--    and m.revendedora_id = c.revendedora_id
--    and m.status = 'ativa';

-- ── Conferência pós-conserto (deve voltar zero linhas) ─────────────────
-- select count(*) from public.consignados where status = 'ativo' and maleta_id is null;
