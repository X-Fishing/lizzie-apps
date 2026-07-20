-- ═══════════════════════════════════════════════════════════════════
-- 0029 — Fidelidade na VENDA: vincula a cliente e aplica os selos.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Rodar DEPOIS da
-- 0028 (depende das tabelas fidelidade_*). Idempotente.
--
-- - cliente_upsert_para_venda: cria/atualiza a cliente pelo celular (chave).
-- - aplicar_fidelidade: trigger AFTER INSERT em vendas que credita selos.
--   NUNCA derruba a venda (qualquer erro vira warning). Idempotente por venda.
-- - registrar_venda v3: agora upserta a cliente, grava cliente_id e RETORNA
--   jsonb com o resumo de fidelidade (o front antigo descarta o retorno).
-- ═══════════════════════════════════════════════════════════════════

-- A) Upsert do cliente. SECURITY DEFINER: a RLS de clientes é staff-only para
--    escrita (0021), então a revendedora precisa desta função confiável para
--    registrar/atualizar a cliente ao vender. Normaliza server-side (dígitos;
--    tira DDI 55 se vier com 12-13 díg.). Nome existente VENCE (o CRUD staff é
--    a fonte da verdade); nascimento preenche só se estava vazio.
create or replace function public.cliente_upsert_para_venda(
  p_nome text, p_celular text, p_nasc date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cel text; v_id uuid;
begin
  v_cel := regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  if length(v_cel) in (12, 13) and left(v_cel, 2) = '55' then
    v_cel := substr(v_cel, 3);
  end if;
  if length(v_cel) < 10 or coalesce(trim(p_nome), '') = '' then
    return null;   -- sem telefone válido/nome → venda segue sem cliente vinculada
  end if;
  insert into clientes (nome, celular, data_nascimento, criado_por)
  values (trim(p_nome), v_cel, p_nasc, auth.uid())
  on conflict (celular) do update
    set data_nascimento = coalesce(clientes.data_nascimento, excluded.data_nascimento)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.cliente_upsert_para_venda(text,text,date) from public;
-- registrar_venda é SECURITY INVOKER → chama esta como a própria usuária → precisa grant.
grant execute on function public.cliente_upsert_para_venda(text,text,date) to authenticated;

-- B) Trigger de selos. SECURITY DEFINER (dono da tabela → ignora RLS de escrita).
create or replace function public.aplicar_fidelidade()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  EXCEDENTE_ACUMULA constant boolean := false;  -- regra do dono: excedente DESCARTADO.
    -- Para acumular no futuro: mudar p/ true, distribuir o excedente na cartela
    -- nova e trocar selos_venda_uniq (0028) para (venda_id, cartela_id).
  SELOS_POR_CARTELA constant int     := 10;
  VALOR_POR_SELO    constant numeric := 150;
  v_ganhos int; v_cartela uuid; v_selos int; v_aplicados int; v_total int;
begin
  v_ganhos := floor(coalesce(new.valor_total, 0) / VALOR_POR_SELO)::int;
  if new.cliente_id is null or v_ganhos <= 0 then
    return new;
  end if;

  -- get-or-create + lock da cartela aberta (serializa vendas simultâneas da cliente)
  loop
    select id, selos into v_cartela, v_selos from fidelidade_cartelas
     where cliente_id = new.cliente_id and status = 'aberta' for update;
    exit when found;
    insert into fidelidade_cartelas (cliente_id) values (new.cliente_id)
      on conflict (cliente_id) where (status = 'aberta') do nothing;
  end loop;

  v_aplicados := least(v_ganhos, SELOS_POR_CARTELA - v_selos);
  insert into fidelidade_selos (cartela_id, cliente_id, venda_id, revendedora_id,
                                quantidade, excedente_descartado, valor_venda)
  values (v_cartela, new.cliente_id, new.id, new.revendedora_id,
          v_aplicados, v_ganhos - v_aplicados, new.valor_total)
  on conflict (venda_id) do nothing;
  if not found then
    return new;   -- selo desta venda já aplicado (idempotência)
  end if;

  v_total := v_selos + v_aplicados;
  update fidelidade_cartelas
     set selos = v_total,
         status = case when v_total >= SELOS_POR_CARTELA then 'completa' else status end,
         completada_em = case when v_total >= SELOS_POR_CARTELA then now() else completada_em end
   where id = v_cartela;

  if v_total >= SELOS_POR_CARTELA then
    insert into fidelidade_premios (cartela_id, cliente_id)
      values (v_cartela, new.cliente_id) on conflict (cartela_id) do nothing;
    insert into fidelidade_cartelas (cliente_id, selos) values (new.cliente_id, 0)
      on conflict (cliente_id) where (status = 'aberta') do nothing;  -- nova cartela zera
  end if;
  return new;
exception when others then
  raise warning 'aplicar_fidelidade falhou (venda %): %', new.id, sqlerrm;
  return new;   -- fidelidade NUNCA falha a venda
end; $$;

drop trigger if exists aplicar_fidelidade_trg on public.vendas;
create trigger aplicar_fidelidade_trg
  after insert on public.vendas
  for each row execute function public.aplicar_fidelidade();

-- C) Exclusão de venda devolve o selo (o app permite excluir venda).
--    Só decrementa cartela ABERTA; cartela completa/prêmio emitido não é
--    desfeito automaticamente (caso raro — ajuste manual do gestor).
create or replace function public.fidelidade_selo_removido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update fidelidade_cartelas set selos = greatest(0, selos - old.quantidade)
   where id = old.cartela_id and status = 'aberta';
  return old;
exception when others then
  raise warning 'fidelidade_selo_removido falhou: %', sqlerrm;
  return old;
end; $$;
drop trigger if exists fidelidade_selo_removido_trg on public.fidelidade_selos;
create trigger fidelidade_selo_removido_trg
  after delete on public.fidelidade_selos
  for each row execute function public.fidelidade_selo_removido();

-- D) registrar_venda v3: mesmos 11 params; upserta a cliente, grava cliente_id
--    e retorna jsonb. Mudou o TIPO DE RETORNO (uuid → jsonb) → drop obrigatório.
--    Continua SECURITY INVOKER (preserva a RLS de consignados/vendas).
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
    auth.uid(), p_cliente, p_data, p_forma,
    p_total, p_pago, p_status, p_obs,
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

  -- Resumo de fidelidade (o trigger AFTER INSERT já rodou nesta transação).
  select jsonb_build_object(
    'selos_ganhos',         s.quantidade,
    'excedente_descartado', s.excedente_descartado,
    'cartela_selos',        (select selos from fidelidade_cartelas
                              where cliente_id = v_cliente_id and status = 'aberta'),
    'completou',            exists (select 1 from fidelidade_cartelas c
                              where c.id = s.cartela_id and c.status = 'completa'),
    'premio_pendente',      exists (select 1 from fidelidade_premios p
                              where p.cliente_id = v_cliente_id and p.status = 'pendente')
  ) into v_fid
  from fidelidade_selos s where s.venda_id = v_venda_id;

  return jsonb_build_object('venda_id', v_venda_id, 'cliente_id', v_cliente_id, 'fidelidade', v_fid);
end; $$;
revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) to authenticated;
