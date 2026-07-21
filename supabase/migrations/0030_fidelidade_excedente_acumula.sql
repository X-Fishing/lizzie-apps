-- ═══════════════════════════════════════════════════════════════════
-- 0030 — Fidelidade: o EXCEDENTE de selos ACUMULA na próxima cartela.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Rodar DEPOIS da 0029.
--
-- Mudança de regra (dono): ao completar 10 selos, o que passar NÃO é mais
-- descartado — vira o começo da cartela nova. Ex.: 9 selos + compra de R$450
-- (3 selos) → completa (bônus) e a cartela nova já começa com 2 selos.
-- Uma venda pode encostar em mais de uma cartela, então o extrato passa a ter
-- 1 linha por (venda, cartela): troca o índice único de venda_id para
-- (venda_id, cartela_id).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Índice único agora por (venda_id, cartela_id) — permite a mesma venda
--    gerar selos em duas cartelas (a que fechou + a nova).
drop index if exists public.selos_venda_uniq;
create unique index if not exists selos_venda_cartela_uniq
  on public.fidelidade_selos (venda_id, cartela_id);

-- 2) Trigger com EXCEDENTE_ACUMULA = true e distribuição em laço.
create or replace function public.aplicar_fidelidade()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  EXCEDENTE_ACUMULA constant boolean := true;   -- excedente vai p/ a cartela nova
  SELOS_POR_CARTELA constant int     := 10;
  VALOR_POR_SELO    constant numeric := 150;
  v_restante int; v_cartela uuid; v_selos int; v_aplicados int; v_total int;
begin
  v_restante := floor(coalesce(new.valor_total, 0) / VALOR_POR_SELO)::int;
  if new.cliente_id is null or v_restante <= 0 then
    return new;
  end if;

  -- Distribui os selos ganhos, abrindo cartela nova a cada 10 (com prêmio).
  loop
    -- get-or-create + lock da cartela aberta (serializa vendas simultâneas)
    loop
      select id, selos into v_cartela, v_selos from fidelidade_cartelas
       where cliente_id = new.cliente_id and status = 'aberta' for update;
      exit when found;
      insert into fidelidade_cartelas (cliente_id) values (new.cliente_id)
        on conflict (cliente_id) where (status = 'aberta') do nothing;
    end loop;

    v_aplicados := least(v_restante, SELOS_POR_CARTELA - v_selos);
    insert into fidelidade_selos (cartela_id, cliente_id, venda_id, revendedora_id,
                                  quantidade, excedente_descartado, valor_venda)
    values (v_cartela, new.cliente_id, new.id, new.revendedora_id,
            v_aplicados, 0, new.valor_total)
    on conflict (venda_id, cartela_id) do nothing;
    if not found then
      exit;   -- esta venda já foi aplicada nesta cartela (idempotência)
    end if;

    v_total := v_selos + v_aplicados;
    update fidelidade_cartelas
       set selos = v_total,
           status = case when v_total >= SELOS_POR_CARTELA then 'completa' else status end,
           completada_em = case when v_total >= SELOS_POR_CARTELA then now() else completada_em end
     where id = v_cartela;
    v_restante := v_restante - v_aplicados;

    if v_total >= SELOS_POR_CARTELA then
      insert into fidelidade_premios (cartela_id, cliente_id)
        values (v_cartela, new.cliente_id) on conflict (cartela_id) do nothing;
      exit when not EXCEDENTE_ACUMULA;   -- regra antiga: pararia aqui (descarta)
      exit when v_restante <= 0;          -- não sobrou excedente
      insert into fidelidade_cartelas (cliente_id, selos) values (new.cliente_id, 0)
        on conflict (cliente_id) where (status = 'aberta') do nothing;  -- cartela nova
      -- volta ao topo do laço p/ colocar o excedente na cartela nova
    else
      exit;   -- cartela não fechou, todos os selos já entraram
    end if;
  end loop;
  return new;
exception when others then
  raise warning 'aplicar_fidelidade falhou (venda %): %', new.id, sqlerrm;
  return new;   -- fidelidade NUNCA falha a venda
end; $$;

-- 3) registrar_venda: o resumo agora SOMA os selos da venda (pode ter 2 cartelas).
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
