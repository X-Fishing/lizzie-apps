-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — vendas "sumidas" da revendedora Stéfanny Passos
-- NÃO é migração: nada aqui altera dados. Rode no SQL Editor quando quiser.
--
-- Contexto: o card da Stéfanny no admin mostra 88 ATIVAS, Pedido #18690,
-- R$ 0,00 vendido, 0%. O padrão bate com uma maleta recém-recriada do zero.
--
-- Suspeita principal (ver src/consignados.js:excluirMaletaAdmin): existe uma
-- ação admin "Excluir maleta ativa" que APAGA de vez peças + vendas do ciclo
-- + recebimentos + selos de fidelidade (tudo por FK), sem lixeira. Se alguém
-- usou essa ação e depois reimportou o pedido do Bling, é exatamente isto
-- que aparece: catálogo novo, histórico de vendas zerado.
--
-- ACHADO na 1ª rodada: a coluna vendas.maleta_id (migration 0035) NÃO existe
-- em produção — essa migration nunca foi aplicada. Script ajustado para não
-- depender dela. Vale investigar depois: sem essa coluna, o vínculo
-- venda↔ciclo/maleta fica mais fraco (consignados.js:2277 tenta gravar nela
-- e deve estar falhando silenciosamente a cada venda nova).
--
-- Este script:
--   1) acha o(s) profile(s) dela (nome pode variar — Stéfanny/Stefanny);
--   2) lista TODAS as maletas dela (não só a ativa) — pra ver se há um gap
--      temporal estranho ou maleta muito recente;
--   3) lista TODOS os consignados dela (ativo + encerrado) — se o histórico
--      de ciclos anteriores também sumiu, o encerrado ficaria vazio;
--   4) lista as vendas/itens/pagamentos que restaram;
--   5) lista os fechamentos de mostruário — snapshot congelado do que foi
--      vendido em cada fechamento passado (sobrevive mesmo que a origem seja
--      apagada depois, é a melhor pista do valor perdido);
--   6) monta uma linha do tempo unificada pra enxergar o "buraco".
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Profile(s) candidatos ──────────────────────────────────────────
with alvo as (
  select id, nome, telefone, is_revendedora, bling_contato_id, created_at
    from public.profiles
   where nome ilike '%stefanny%' or nome ilike '%stéfanny%' or nome ilike '%stephanny%'
)
select * from alvo order by created_at;

-- ⚠ Confira o(s) id(s) acima. Se vier mais de uma linha, ajuste o filtro
-- `nome ilike` nas queries abaixo (ou troque por `id = '...'::uuid` fixo)
-- antes de rodar o resto.

-- ── 2) Todas as maletas dela (qualquer status) ────────────────────────
select m.id, m.numero, m.status, m.created_at, m.finalizada_at
  from public.maletas m
  join public.profiles p on p.id = m.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by m.created_at;

-- ── 3) Todos os consignados dela (ativo + encerrado) ──────────────────
select c.id, c.maleta_id, c.pedido_numero, c.status, c.descricao, c.referencia,
       c.quantidade_enviada, c.quantidade_vendida, c.preco_venda,
       c.created_at, c.encerrado_em, c.devolvido, c.vendido_por_divergencia
  from public.consignados c
  join public.profiles p on p.id = c.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by c.created_at;

-- ── 4) Vendas + itens + pagamentos que RESTARAM ────────────────────────
select v.id, v.nome_cliente, v.telefone_cliente, v.data_venda,
       v.valor_total, v.valor_pago, v.forma_pagamento, v.status
  from public.vendas v
  join public.profiles p on p.id = v.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by v.data_venda;

select vi.*
  from public.venda_itens vi
  join public.vendas v on v.id = vi.venda_id
  join public.profiles p on p.id = v.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by vi.venda_id;

select vp.*
  from public.venda_pagamentos vp
  join public.vendas v on v.id = vp.venda_id
  join public.profiles p on p.id = v.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by vp.venda_id;

-- ── 5) Fechamentos de mostruário — snapshot congelado (a melhor pista) ─
-- Se houver linha aqui com total_vendido_valor > 0 e created_at ANTERIOR
-- ao created_at da maleta atual (item 2), é prova de que existiu venda
-- registrada que não está mais nas tabelas vivas.
select f.id, f.comissao_percentual, f.comissao_valor, f.valor_a_receber,
       f.total_vendido_valor, f.created_at, f.corrigido_em
  from public.fechamentos_mostruario f
  join public.profiles p on p.id = f.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by f.created_at;

select fd.*
  from public.fechamentos_divergencias fd
  join public.fechamentos_mostruario f on f.id = fd.fechamento_id
  join public.profiles p on p.id = f.revendedora_id
 where p.nome ilike '%stefanny%' or p.nome ilike '%stéfanny%'
 order by f.created_at;

-- ── 6) Linha do tempo unificada (maletas x consignados x vendas x fechamentos) ─
with alvo as (
  select id from public.profiles
   where nome ilike '%stefanny%' or nome ilike '%stéfanny%'
)
select 'maleta criada' as evento, m.created_at as quando, m.status::text as detalhe
  from public.maletas m where m.revendedora_id in (select id from alvo)
union all
select 'peça adicionada ao catálogo', c.created_at, c.descricao || ' (pedido #' || coalesce(c.pedido_numero,'?') || ')'
  from public.consignados c where c.revendedora_id in (select id from alvo)
union all
select 'venda registrada', v.data_venda::timestamptz, v.nome_cliente || ' — R$ ' || v.valor_total::text
  from public.vendas v where v.revendedora_id in (select id from alvo)
union all
select 'fechamento de mostruário', f.created_at, 'total vendido R$ ' || coalesce(f.total_vendido_valor,0)::text
  from public.fechamentos_mostruario f where f.revendedora_id in (select id from alvo)
order by quando;
