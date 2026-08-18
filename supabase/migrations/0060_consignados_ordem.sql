-- ═══════════════════════════════════════════════════════════════════
-- 0060 — Ordem de lançamento na maleta. COMO APLICAR: Supabase → SQL
-- Editor → cole tudo → Run. Idempotente.
--
-- PEDIDO: "queremos que a MALETA fique na ordem que os itens são
-- lançados". Hoje a ordem padrão é alfabética por descrição
-- (state.cSort). `created_at` não serve pra isso: um import em lote
-- (Bling) grava o MESMO created_at (até o microssegundo) em todas as
-- linhas do lote, porque now() é fixo por transação — confirmado com
-- dado real desta sessão (88 peças, mesmíssimo timestamp). Por isso a
-- coluna abaixo usa um contador monotônico de verdade (identity), que
-- resolve empate corretamente mesmo dentro do mesmo INSERT em lote —
-- vale 100% para TODA peça lançada a partir de agora.
--
-- Ressalva sobre dado ANTIGO: adicionar a coluna a uma tabela existente
-- faz o Postgres preencher `ordem` pela ordem física atual das linhas
-- (backfill automático) — na prática bate com a ordem de lançamento
-- original para peça que nunca foi tocada depois, mas uma linha que já
-- sofreu UPDATE (ex.: virou vendida) pode ter mudado de posição física
-- nesse meio tempo. Não tem como reconstruir a ordem exata original
-- retroativamente — só o "dali pra frente" é garantido.
-- ═══════════════════════════════════════════════════════════════════

alter table public.consignados
  add column if not exists ordem bigint generated always as identity;

create index if not exists consignados_maleta_ordem_idx
  on public.consignados (maleta_id, ordem);

select pg_notify('pgrst', 'reload schema');
