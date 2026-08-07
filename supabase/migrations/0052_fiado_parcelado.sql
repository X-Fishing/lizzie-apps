-- ════════════════════════════════════════════════════════════════════
-- 0052 — Parcelado deixa de ser "recebido". Só cartão de crédito é dinheiro
-- na mão; parcelar DIRETO com a cliente é dívida (fiado).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x.
--
-- PROBLEMA (0051): a regra "só 'Fiado' não conta como recebido" tratava
-- 'Parcelado Nx' como dinheiro garantido, presumindo maquininha. Mas no app
-- da revendedora "Parcelado Nx" é ambíguo — pode ser ela parcelando DIRETO
-- com a cliente, que é dívida igual ao Fiado. A revendedora precisa ver essa
-- venda como pendente para poder cobrar.
--
-- SOLUÇÃO: separar os dois casos no próprio nome da forma.
--   'Cartão crédito Nx'   → maquininha, dinheiro garantido → RECEBIDO.
--   'Fiado parcelado Nx'  → parcelamento direto com a cliente → A RECEBER.
-- Regra única nos dois lados (front e banco): forma que começa com 'Fiado'
-- é dívida. Nada foi publicado com a regra antiga em produção (só uma venda
-- de teste, já excluída) — portanto SEM backfill corretivo aqui.
-- ════════════════════════════════════════════════════════════════════

-- ── registrar_venda v6 ──────────────────────────────────────────────
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb);

create or replace function public.registrar_venda(
  p_cliente    text,
  p_data       date,
  p_forma      text,
  p_total      numeric,
  p_pago       numeric,
  p_status     text,
  p_obs        text,
  p_itens      jsonb,
  p_tel        text  default null,
  p_nasc       date  default null,
  p_combinada  date  default null,
  p_pagamentos jsonb default null   -- [{forma, valor, data}]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id   uuid;
  v_item       jsonb;
  v_pgto       jsonb;
  v_cliente_id uuid;
  v_fid        jsonb;
  v_forma      text    := p_forma;
  v_pago       numeric := coalesce(p_pago, 0);
  v_status     text    := p_status;
  v_n          int     := 0;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  -- Quando vierem linhas de pagamento, elas mandam em forma/valor_pago/status.
  -- Não confia no que o front calculou: soma e deriva aqui.
  -- 'Fiado%' cobre 'Fiado' e 'Fiado parcelado Nx' — a revendedora parcelando
  -- direto com a cliente é dívida, não dinheiro recebido.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    v_n := jsonb_array_length(p_pagamentos);
    select coalesce(sum((x->>'valor')::numeric), 0) into v_pago
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') not like 'fiado%';
    if v_n = 1 then
      select x->>'forma' into v_forma from jsonb_array_elements(p_pagamentos) x;
    else
      v_forma := 'Misto';
    end if;
    v_status := case when v_pago >= p_total then 'quitado'
                     when v_pago > 0        then 'parcial'
                     else 'pendente' end;
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,
    p_total, v_pago, v_status, p_obs,
    p_tel, p_nasc, p_combinada, v_cliente_id
  )
  returning id into v_venda_id;

  -- Rateio por forma de pagamento (0051).
  if p_pagamentos is not null then
    for v_pgto in select * from jsonb_array_elements(p_pagamentos)
    loop
      insert into venda_pagamentos (venda_id, forma, valor, data)
      values (
        v_venda_id,
        v_pgto->>'forma',
        (v_pgto->>'valor')::numeric,
        coalesce(nullif(v_pgto->>'data', '')::date, p_data)
      );
    end loop;
  end if;

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

  -- Recebimentos: um por linha efetivamente paga (0051; antes era um lump só).
  -- Mantém o bloco "Recebimentos" do detalhe da venda coerente com o rateio.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    select v_venda_id,
           (x->>'valor')::numeric,
           coalesce(nullif(x->>'data', '')::date, p_data)
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') not like 'fiado%'
       and (x->>'valor')::numeric > 0;
  elsif v_pago > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, v_pago, p_data);
  end if;

  -- 0030: a venda pode gerar selos em 2 cartelas (excedente acumula) → soma.
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
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
