-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — itens sumidos da relação da revendedora Leina
-- NÃO é migração: nada aqui altera dados. Rode no SQL Editor quando quiser.
--
-- Contexto (17/08/2026): Leina reportou 3 itens que não aparecem na
-- "relação" dela no app. Duas etiquetas fotografadas confirmam existência
-- física: código 20427 (R$42,00) e código 16962 (R$69,00). O 3º item não
-- foi fotografado.
--
-- Investigação do código encontrou 5 pontos independentes no pipeline
-- Bling→app onde um item pode ser silenciosamente perdido:
--   1) Import inicial só pega o pedido Bling MAIS RECENTE — item de um
--      pedido mais antigo nunca entra.
--   2) "Atualizar itens da maleta" só lista como candidato pedido já
--      vinculado OU "Em aberto" — um pedido já "Atendido" e nunca
--      importado fica invisível pro admin (nem aparece pra escolher).
--   3) Item SEM CÓDIGO no Bling é descartado na sincronização (só vira
--      um aviso que some da tela).
--   4) Item com "delta ≤ 0" (Bling já contado pela maleta atual) não é
--      inserido (aviso que também some).
--   5) Escopo de maleta_id: a revendedora só vê itens da maleta ATIVA —
--      linha com maleta_id nulo/desatualizado fica invisível só pra ela,
--      mesmo existindo na tabela (ver PROMPT-MALETAS-BACKFILL.md).
--
-- COMO LER O RESULTADO:
--   Seção 3 vazia + seção 4 com linhas de OUTRA revendedora com esses
--     códigos → o item foi atribuído à pessoa errada (variante de 1/2).
--   Seção 3 com linha(s) mas maleta_id diferente da maleta ativa dela
--     (comparar com seção 2) → é o caso 5 (escopo de maleta).
--   Seção 3 e 4 vazias, seção 5 sem linha → o código nem existe no
--     catálogo (produtos) — provavelmente nunca foi importado do Bling
--     (casos 1, 2 ou 3).
--   Seção 6 mostra se há um "buraco" temporal entre quando a maleta foi
--     criada e quando o pedido desses itens teria sido feito no Bling.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Profile(s) candidatos ──────────────────────────────────────────
with alvo as (
  select id, nome, telefone, is_revendedora, bling_contato_id, created_at
    from public.profiles
   where nome ilike '%leina%'
)
select * from alvo order by created_at;

-- ⚠ Confira o(s) id(s) acima. Se vier mais de uma linha ou nome diferente
-- do esperado, ajuste o filtro `nome ilike` nas queries abaixo.

-- ── 2) Todas as maletas dela (qualquer status) ────────────────────────
select m.id, m.numero, m.status, m.created_at, m.finalizada_at
  from public.maletas m
  join public.profiles p on p.id = m.revendedora_id
 where p.nome ilike '%leina%'
 order by m.created_at;

-- ── 3) Os códigos reportados, SÓ nela, SEM filtro de status/maleta_id ──
-- (testa diretamente se é escopo de maleta — item existe mas está preso
-- numa maleta que não é a ativa dela)
select c.id, c.maleta_id, c.pedido_numero, c.status, c.descricao, c.referencia,
       c.quantidade_enviada, c.quantidade_vendida, c.created_at, c.encerrado_em
  from public.consignados c
  join public.profiles p on p.id = c.revendedora_id
 where p.nome ilike '%leina%'
   and c.referencia in ('20427', '16962')
 order by c.created_at;

-- ── 4) Os mesmos códigos em QUALQUER revendedora ───────────────────────
-- (testa se foram atribuídos à pessoa errada)
select c.id, c.revendedora_id, pr.nome as nome_revendedora, c.maleta_id,
       c.pedido_numero, c.status, c.descricao, c.referencia, c.created_at
  from public.consignados c
  left join public.profiles pr on pr.id = c.revendedora_id
 where c.referencia in ('20427', '16962')
 order by c.created_at;

-- ── 5) Cross-check no catálogo próprio (produtos) ──────────────────────
select id, nome, sku, codigo_barras, estoque_qtd, preco_venda
  from public.produtos
 where sku in ('20427', '16962') or codigo_barras in ('20427', '16962');

-- ── 6) Linha do tempo unificada, filtrada pra ela ──────────────────────
with alvo as (
  select id from public.profiles where nome ilike '%leina%'
)
select 'maleta criada' as evento, m.created_at as quando, m.status::text as detalhe
  from public.maletas m where m.revendedora_id in (select id from alvo)
union all
select 'peça adicionada ao catálogo', c.created_at,
       c.descricao || ' (ref ' || coalesce(c.referencia,'?') || ', pedido #' || coalesce(c.pedido_numero,'?') || ')'
  from public.consignados c where c.revendedora_id in (select id from alvo)
union all
select 'venda registrada', v.data_venda::timestamptz, v.nome_cliente || ' — R$ ' || v.valor_total::text
  from public.vendas v where v.revendedora_id in (select id from alvo)
union all
select 'fechamento de mostruário', f.created_at, 'total vendido R$ ' || coalesce(f.total_vendido_valor,0)::text
  from public.fechamentos_mostruario f where f.revendedora_id in (select id from alvo)
order by quando;
