-- ═══════════════════════════════════════════════════════════════════
-- 0032 — Garante que registrar_venda RETORNA jsonb (fix do modal pós-venda).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- Sintoma: após a venda não aparecia nada (nem modal de WhatsApp) porque a
-- função no banco ainda retornava uuid (versão antiga). O front espera o jsonb
-- com o resumo da fidelidade. Este arquivo dropa a versão antiga e recria em
-- jsonb (mesma versão da 0030). Os selos/trigger não são tocados aqui.
-- ═══════════════════════════════════════════════════════════════════
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date);
create or replace function public.registrar_venda(
  p_cliente text, p_data date, p_forma text, p_total numeric, p_pago numeric,
  p_status text, p_obs text, p_itens jsonb,
  p_tel text default null, p_nasc date default null, p_combinada date default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_venda_id uuid; v_item jsonb; v_cliente_id uuid; v_fid jsonb;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'venda sem itens'; end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, p_forma, p_total, p_pago, p_status, p_obs,
    p_tel, p_nasc, p_combinada, v_cliente_id
  ) returning id into v_venda_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into venda_itens (venda_id, consignado_id, descricao, referencia, quantidade, preco_unit)
    values (v_venda_id, (v_item->>'consignado_id')::uuid, v_item->>'descricao',
            v_item->>'referencia', (v_item->>'quantidade')::int, (v_item->>'preco_unit')::numeric);
    update consignados
       set quantidade_vendida = coalesce(quantidade_vendida, 0) + (v_item->>'quantidade')::int
     where id = (v_item->>'consignado_id')::uuid;
  end loop;

  if coalesce(p_pago, 0) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento) values (v_venda_id, p_pago, p_data);
  end if;

  select jsonb_build_object(
    'selos_ganhos',         coalesce(sum(s.quantidade), 0),
    'excedente_descartado', 0,
    'cartela_selos',        (select selos from fidelidade_cartelas
                              where cliente_id = v_cliente_id and status = 'aberta'),
    'completou',            exists (select 1 from fidelidade_selos s2
                              join fidelidade_cartelas c on c.id = s2.cartela_id
                              where s2.venda_id = v_venda_id and c.status = 'completa'),
    'premio_pendente',      exists (select 1 from fidelidade_premios p
                              where p.cliente_id = v_cliente_id and p.status = 'pendente')
  ) into v_fid
  from fidelidade_selos s where s.venda_id = v_venda_id;

  return jsonb_build_object('venda_id', v_venda_id, 'cliente_id', v_cliente_id, 'fidelidade', v_fid);
end; $$;
revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) to authenticated;
