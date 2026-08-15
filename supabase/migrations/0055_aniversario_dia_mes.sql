-- ════════════════════════════════════════════════════════════════════
-- 0055 — Aniversário da cliente vira DIA/MÊS. O ano deixa de existir.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x sem erro e sem perder dado.
--
-- PROBLEMA: `clientes.data_nascimento` é `date`, e o app pedia dd/mm/aaaa —
-- inclusive como campo OBRIGATÓRIO para fechar venda (consignados.js) e abrir
-- garantia (garantias.js). Só que o ano nunca foi usado para nada: o único
-- consumidor é o Bônus de Aniversário (src/bonus.js), que filtra por MÊS. Ou
-- seja: a venda travava por um dado que a cliente costuma não querer dar, e
-- metade do dado era lixo. Pior, o `date` obriga a inventar um ano — e um
-- aniversário 29/02 vira data inválida em ano não-bissexto.
--
-- SOLUÇÃO: duas colunas `aniversario_dia` / `aniversario_mes` em `clientes`,
-- `vendas` e `garantias`; backfill a partir da coluna `date`; e a coluna
-- antiga é DERRUBADA (decisão do dono: descartar o ano).
--
-- ⚠️ NÃO TOCA em `revendedora_docs.data_nascimento` — aquela é a data de
-- nascimento da REVENDEDORA, usada no contrato, e precisa do ano.
--
-- ⚠️ ANTES DE RODAR: faça um dump das três tabelas. O drop da coluna é
-- irreversível e leva o ano junto.
--   pg_dump ... -t public.clientes -t public.vendas -t public.garantias
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Regra de validade (a MESMA de src/utils.js diaMesPartes) ──────
--   Fevereiro aceita 29: sem ano, não há como decidir que é inválido.
create or replace function public.aniversario_valido(p_dia int, p_mes int)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_dia is null and p_mes is null then true          -- sem aniversário: ok
    when p_dia is null or  p_mes is null then false         -- um sem o outro: não
    when p_mes not between 1 and 12      then false
    else p_dia between 1 and (array[31,29,31,30,31,30,31,31,30,31,30,31])[p_mes]
  end;
$$;

-- ── 2) Colunas novas + backfill + drop da antiga ─────────────────────
--   Um bloco por tabela, todos guardados por "if exists" na coluna velha,
--   para o re-run não tentar backfillar de uma coluna que já não existe.
do $$
declare
  t text;
  tabelas text[] := array['clientes', 'vendas', 'garantias'];
  col_velha text;
begin
  foreach t in array tabelas loop
    -- nome da coluna date de origem difere entre as tabelas
    col_velha := case when t = 'clientes' then 'data_nascimento'
                      else 'nascimento_cliente' end;

    execute format('alter table public.%I
                      add column if not exists aniversario_dia smallint,
                      add column if not exists aniversario_mes smallint', t);

    -- Backfill só se a coluna antiga ainda existir (idempotência do re-run).
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t
                  and column_name = col_velha) then
      execute format('update public.%I
                         set aniversario_dia = extract(day   from %I)::smallint,
                             aniversario_mes = extract(month from %I)::smallint
                       where %I is not null and aniversario_mes is null',
                     t, col_velha, col_velha, col_velha);
      execute format('alter table public.%I drop column %I', t, col_velha);
      raise notice '0055: %.% migrada e derrubada', t, col_velha;
    else
      raise notice '0055: %.% ja nao existe (re-run) — nada a fazer', t, col_velha;
    end if;

    execute format('alter table public.%I drop constraint if exists %I',
                   t, t || '_aniversario_chk');
    execute format('alter table public.%I
                      add constraint %I check (public.aniversario_valido(aniversario_dia, aniversario_mes))',
                   t, t || '_aniversario_chk');
  end loop;
end $$;

-- Bônus de Aniversário varre por MÊS; parcial porque a maioria é null.
create index if not exists idx_clientes_aniversario_mes
  on public.clientes (aniversario_mes) where aniversario_mes is not null;

-- ── 3) cliente_upsert_para_venda — dia/mês no lugar do date ──────────
--   Mesma blindagem da 0038: telefone inválido → null (venda segue sem
--   cliente); nome só ENRIQUECE; aniversário só preenche se estava VAZIO.
--   A assinatura muda (date → 2 int) ⇒ drop da antiga, senão o overload
--   ambíguo derruba as chamadas existentes.
drop function if exists public.cliente_upsert_para_venda(text, text, date);

create or replace function public.cliente_upsert_para_venda(
  p_nome text, p_celular text, p_dia int default null, p_mes int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cel text; v_id uuid; v_dia int := p_dia; v_mes int := p_mes;
begin
  v_cel := public.tel_normalizado(p_celular);
  if not public.tel_br_valido(v_cel) or coalesce(btrim(p_nome), '') = '' then
    return null;
  end if;
  -- Aniversário inválido não derruba a venda: entra como "sem aniversário".
  if not public.aniversario_valido(v_dia, v_mes) then
    v_dia := null; v_mes := null;
  end if;

  insert into clientes (nome, celular, aniversario_dia, aniversario_mes, criado_por)
  values (btrim(p_nome), v_cel, v_dia, v_mes, auth.uid())
  on conflict (celular) do update
    set nome = case
                 when public.nome_norm(excluded.nome)
                      like public.nome_norm(clientes.nome) || '%'
                  and length(public.nome_norm(excluded.nome))
                      > length(public.nome_norm(clientes.nome))
                   then btrim(excluded.nome)
                 else clientes.nome
               end,
        -- Só enriquece: nunca sobrescreve um aniversário já gravado. Os dois
        -- campos andam juntos, senão a constraint aniversario_chk quebra.
        aniversario_dia = case when clientes.aniversario_mes is null
                               then excluded.aniversario_dia else clientes.aniversario_dia end,
        aniversario_mes = case when clientes.aniversario_mes is null
                               then excluded.aniversario_mes else clientes.aniversario_mes end,
        telefone_invalido = false
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.cliente_upsert_para_venda(text,text,int,int) from public, anon;
grant  execute on function public.cliente_upsert_para_venda(text,text,int,int) to authenticated;

-- ── 4) buscar_cliente_por_telefone — devolve dia/mês ─────────────────
--   ⚠️ MANTÉM o escopo por revendedora da 0042 (a 0041 reescreveu esta função
--   SEM o escopo e reabriu o vazamento: qualquer revendedora que adivinhasse
--   um celular obtinha o nome da cliente de outra). Muda o "returns table"
--   ⇒ drop obrigatório.
drop function if exists public.buscar_cliente_por_telefone(text);
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, nasc_dia smallint, nasc_mes smallint, selos integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.aniversario_dia, c.aniversario_mes, coalesce(f.selos, 0)
    from public.clientes c
    left join public.fidelidade_cartelas f
      on f.cliente_id = c.id and f.status = 'aberta'
   where public.tel_br_valido(p_telefone)
     and c.celular = public.tel_normalizado(p_telefone)
     and (
       public.is_staff()
       or exists (select 1 from public.vendas v
                  where v.cliente_id = c.id and v.revendedora_id = auth.uid())
     )
   limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public, anon;
grant  execute on function public.buscar_cliente_por_telefone(text) to authenticated;

-- ── 5) registrar_venda v7 — p_nasc (date) vira p_nasc_dia/p_nasc_mes ─
--   Corpo idêntico ao da 0052 (v6), trocando só o aniversário. Os drops
--   cobrem TODAS as assinaturas históricas: overload ambíguo faz o PostgREST
--   recusar a chamada (mesmo cuidado de 0032/0051/0052).
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
  p_nasc_dia   int   default null,
  p_nasc_mes   int   default null,
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
  -- direto com a cliente é dívida, não dinheiro recebido. (0051/0052)
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

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc_dia, p_nasc_mes);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, aniversario_dia, aniversario_mes, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,
    p_total, v_pago, v_status, p_obs,
    p_tel, p_nasc_dia, p_nasc_mes, p_combinada, v_cliente_id
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

  -- Recebimentos: um por linha efetivamente paga.
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
revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,int,int,date,jsonb) from public, anon;
grant  execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,int,int,date,jsonb) to authenticated;

-- ── 6) completar_venda_cliente — dia/mês (corpo da 0041 preservado) ──
drop function if exists public.completar_venda_cliente(uuid, text, text, date, text);

create or replace function public.completar_venda_cliente(
  p_venda_id uuid, p_nome text, p_tel text,
  p_dia int default null, p_mes int default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_venda record; v_cliente_id uuid; v_pode boolean; v_cel text; v_fid jsonb;
        v_antigo uuid; v_realocou boolean := false;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;

  select id, revendedora_id, cliente_id into v_venda
    from vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda nao encontrada'; end if;

  -- Permissão no SERVIDOR (a UI é só conveniência):
  --   admin  OU  staff com a ação  OU  a DONA da venda com o flag.
  v_pode := public.is_admin()
         or (public.is_staff() and public.fn_tem_acao('acao_completar_venda_antiga'))
         or (v_venda.revendedora_id = auth.uid()
             and coalesce((select pode_completar_vendas from profiles
                            where id = auth.uid()), false));
  if not v_pode then
    raise exception 'Sem permissao para completar os dados desta venda';
  end if;

  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome da cliente';
  end if;
  v_cel := public.tel_normalizado(p_tel);
  if not public.tel_br_valido(v_cel) then
    raise exception 'Telefone invalido — informe um numero real com DDD';
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_nome, v_cel, p_dia, p_mes);
  if v_cliente_id is null then
    raise exception 'Nao foi possivel registrar a cliente';
  end if;

  -- REAPONTAR: se a venda já estava em outra cliente, tira os selos dela antes.
  v_antigo := v_venda.cliente_id;
  if v_antigo is not null and v_antigo <> v_cliente_id then
    delete from fidelidade_selos where venda_id = p_venda_id;
    v_realocou := true;
  end if;

  -- APENAS estas colunas. Valores, peças, datas e status NUNCA mudam aqui.
  update vendas
     set nome_cliente     = btrim(p_nome),
         telefone_cliente = v_cel,
         aniversario_dia  = coalesce(p_dia, aniversario_dia),
         aniversario_mes  = coalesce(p_mes, aniversario_mes),
         cliente_id       = v_cliente_id,
         atualizado_por   = auth.uid(),
         atualizado_em    = now(),
         atualizacao_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = p_venda_id;

  -- Selos: automáticos e em silêncio. Erro NÃO é engolido (rollback).
  v_fid := public.aplicar_fidelidade_venda(p_venda_id);

  return jsonb_build_object(
    'cliente_id',       v_cliente_id,
    'realocou',         v_realocou,
    'cliente_anterior', v_antigo,
    'fidelidade',       v_fid);
end; $$;
revoke all on function public.completar_venda_cliente(uuid,text,text,int,int,text) from public, anon;
grant  execute on function public.completar_venda_cliente(uuid,text,text,int,int,text) to authenticated;

-- DIAGNÓSTICO (rodar e conferir):
-- select count(*) filter (where aniversario_mes is not null) as com_aniversario,
--        count(*) as total from public.clientes;
-- select aniversario_mes, count(*) from public.clientes
--  where aniversario_mes is not null group by 1 order by 1;

select pg_notify('pgrst', 'reload schema');
