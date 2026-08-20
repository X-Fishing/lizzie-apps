-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — venda "Luiz DHL" (cliente da Pamela) sem selo. Só leitura.
--
-- CONTEXTO (20/08/2026): ficha da cliente mostra 1 compra (R$227,00, 1
-- selo). Histórico de Vendas mostra 2 compras somando R$550,00. A
-- diferença: Histórico agrupa por vendas.nome_cliente (texto), a ficha
-- da cliente agrupa por vendas.cliente_id (o que a fidelidade usa) — ver
-- comentário no topo de src/cliente-compras.js. Suspeita: a 2ª venda
-- (R$323) tem cliente_id nulo porque o telefone informado não bateu com
-- um telefone brasileiro válido (cliente_upsert_para_venda devolve nulo
-- nesse caso — supabase/migrations/0055_aniversario_dia_mes.sql:108-111).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) A cliente "Luiz DHL" de verdade (pelo telefone certo) ───────────
select id, nome, celular, aniversario_dia, aniversario_mes, telefone_invalido, created_at
  from public.clientes
 where celular = '5519992061283' or nome ilike '%luiz dhl%';

-- ── 2) TODAS as vendas da Pamela pra "Luiz DHL" (pelo nome digitado) ───
-- Mostra cliente_id, telefone gravado NA VENDA e valor — é aqui que
-- aparece qual delas ficou órfã.
select v.id, v.cliente_id, v.nome_cliente, v.telefone_cliente, v.data_venda,
       v.valor_total, v.valor_pago, v.forma_pagamento, v.created_at
  from public.vendas v
  join public.profiles p on p.id = v.revendedora_id
 where p.nome ilike '%pamela%'
   and v.nome_cliente ilike '%luiz dhl%'
 order by v.data_venda;
