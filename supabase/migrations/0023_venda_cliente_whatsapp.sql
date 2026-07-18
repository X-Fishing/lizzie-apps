-- ════════════════════════════════════════════════════════════════════
-- 0023 — Dados da cliente na venda (WhatsApp, aniversário, data combinada
--        do fiado) + aniversário na garantia. COMO APLICAR: Supabase →
--        SQL Editor → Run. Rode ANTES de publicar a versão do app que
--        envia p_tel/p_nasc/p_combinada para registrar_venda.
-- ════════════════════════════════════════════════════════════════════

alter table public.vendas
  add column if not exists telefone_cliente   text,
  add column if not exists nascimento_cliente date,
  add column if not exists data_combinada     date;

alter table public.garantias
  add column if not exists nascimento_cliente date;

-- registrar_venda ganha 3 params com DEFAULT (retrocompatível: o app antigo
-- que chama só os 8 primeiros continua funcionando). A assinatura muda, então
-- é preciso DROP antes — senão vira overload e o PostgREST fica ambíguo.
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);

create or replace function public.registrar_venda(
  p_cliente   text,
  p_data      date,
  p_forma     text,
  p_total     numeric,
  p_pago      numeric,
  p_status    text,
  p_obs       text,
  p_itens     jsonb,
  p_tel       text default null,
  p_nasc      date default null,
  p_combinada date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_item     jsonb;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada
  ) values (
    auth.uid(), p_cliente, p_data, p_forma,
    p_total, p_pago, p_status, p_obs,
    p_tel, p_nasc, p_combinada
  )
  returning id into v_venda_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into venda_itens (
      venda_id, consignado_id, descricao, referencia, quantidade, preco_unit
    ) values (
      v_venda_id,
      (v_item->>'consignado_id')::uuid,
      v_item->>'descricao',
      v_item->>'referencia',
      (v_item->>'quantidade')::int,
      (v_item->>'preco_unit')::numeric
    );

    update consignados
       set quantidade_vendida = coalesce(quantidade_vendida, 0) + (v_item->>'quantidade')::int
     where id = (v_item->>'consignado_id')::uuid;
  end loop;

  if coalesce(p_pago, 0) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, p_pago, p_data);
  end if;

  return v_venda_id;
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) to authenticated;
