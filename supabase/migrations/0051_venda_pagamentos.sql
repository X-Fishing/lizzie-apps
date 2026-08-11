-- ════════════════════════════════════════════════════════════════════
-- 0051 — venda_pagamentos: mais de uma forma de pagamento por venda.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x sem erro e sem duplicar backfill.
--
-- PROBLEMA: vendas.forma_pagamento é uma coluna text ÚNICA. "a cliente pagou
-- R$ 100 no Pix e R$ 50 no cartão" não tinha como ser lançado — a revendedora
-- escolhia uma forma só (dado errado no Financeiro) ou quebrava em duas vendas
-- (bagunçava a cliente, a fidelidade e o certificado de garantia).
--
-- SOLUÇÃO: tabela de rateio venda_pagamentos, alimentada pela RPC. A coluna
-- vendas.forma_pagamento CONTINUA preenchida (nome da forma quando é uma só,
-- 'Misto' quando são 2+), para não quebrar as telas que já a exibem
-- (pagamentos.js, historico.js).
--
-- REGRAS: 'Fiado' é a única forma que NÃO conta como recebida — representa o
-- que a cliente ainda deve. valor_pago = soma das linhas exceto Fiado.
-- ════════════════════════════════════════════════════════════════════

-- ── A) Tabela ───────────────────────────────────────────────────────
create table if not exists public.venda_pagamentos (
  id         uuid primary key default gen_random_uuid(),
  venda_id   uuid not null references public.vendas(id) on delete cascade,
  forma      text not null,
  valor      numeric not null check (valor > 0),
  data       date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists venda_pagamentos_venda_idx on public.venda_pagamentos(venda_id);

-- ── B) RLS — herda da venda (mesmo padrão de venda_itens/recebimentos,
--        ver RLS-policies.sql:157-180) ────────────────────────────────
alter table public.venda_pagamentos enable row level security;
drop policy if exists venda_pagamentos_select on public.venda_pagamentos;
drop policy if exists venda_pagamentos_insert on public.venda_pagamentos;
drop policy if exists venda_pagamentos_delete on public.venda_pagamentos;
create policy venda_pagamentos_select on public.venda_pagamentos for select to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_pagamentos_insert on public.venda_pagamentos for insert to authenticated
  with check ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_pagamentos_delete on public.venda_pagamentos for delete to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );

-- ── C) registrar_venda v5 ───────────────────────────────────────────
-- Ganhou p_pagamentos jsonb (DEFAULT null → retrocompatível: o front antigo
-- não manda o parâmetro e cai no caminho de sempre). Quando vem preenchido,
-- ele MANDA em forma_pagamento e valor_pago, e grava o rateio.
-- Os três drops cobrem todas as assinaturas históricas (evita overload
-- ambíguo no PostgREST — mesmo cuidado da 0032).
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
  v_n          int     := 0;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  -- Quando vierem linhas de pagamento, elas mandam em forma/valor_pago.
  -- Não confia no que o front calculou: soma aqui.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    v_n := jsonb_array_length(p_pagamentos);
    select coalesce(sum((x->>'valor')::numeric), 0) into v_pago
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') <> 'fiado';
    if v_n = 1 then
      select x->>'forma' into v_forma from jsonb_array_elements(p_pagamentos) x;
    else
      v_forma := 'Misto';
    end if;
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,
    p_total, v_pago, p_status, p_obs,
    p_tel, p_nasc, p_combinada, v_cliente_id
  )
  returning id into v_venda_id;

  -- Rateio por forma de pagamento.
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

  -- Recebimentos: um por linha efetivamente paga (antes era um lump só).
  -- Mantém o bloco "Recebimentos" do detalhe da venda coerente com o rateio.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    select v_venda_id,
           (x->>'valor')::numeric,
           coalesce(nullif(x->>'data', '')::date, p_data)
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') <> 'fiado'
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

-- ── D) Backfill ─────────────────────────────────────────────────────
-- Toda venda antiga com valor_pago > 0 ganha uma linha equivalente, para o
-- detalhe da venda nunca aparecer vazio no histórico. O "not exists" torna
-- idempotente (rodar 2x não duplica).
insert into public.venda_pagamentos (venda_id, forma, valor, data)
select v.id, coalesce(nullif(trim(v.forma_pagamento), ''), 'Não informado'),
       v.valor_pago, v.data_venda
  from public.vendas v
 where coalesce(v.valor_pago, 0) > 0
   and not exists (select 1 from public.venda_pagamentos p where p.venda_id = v.id);

-- DIAGNÓSTICO (rodar e conferir):
-- select count(*) from public.venda_pagamentos;
-- select forma, count(*) from public.venda_pagamentos group by forma order by 2 desc;

select pg_notify('pgrst', 'reload schema');
