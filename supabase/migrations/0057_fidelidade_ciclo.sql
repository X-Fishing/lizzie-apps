-- ════════════════════════════════════════════════════════════════════
-- 0057 — Fidelidade: as vendas SOMAM dentro do ciclo da revendedora.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente. Rodar DEPOIS da 0055 (registrar_venda v7 / aniversário).
--
-- ── A MUDANÇA DE REGRA ──────────────────────────────────────────────
-- ANTES: 1 selo a cada R$150 CHEIOS de CADA venda — floor(valor_total/150)
--        por venda isolada (0039:137). O troco de cada venda era jogado fora:
--        duas compras de R$75 da mesma cliente = ZERO selos.
-- AGORA: os valores SOMAM dentro do mesmo ciclo da revendedora. Duas compras
--        de R$75 na mesma maleta = 1 selo. Múltiplos de 150 geram mais selos.
--
-- O "ciclo" é a MALETA (vendas.maleta_id, 0035) — é o ciclo de mostruário que
-- a revendedora já vive. O que não fechar R$150 até o fim do ciclo é perdido:
-- o balde morre com a maleta.
--
-- NÃO MUDA: R$150 por selo, 10 selos por cartela, prêmio de R$300, o excedente
-- de SELOS transbordando para a cartela nova (0030), o ajuste manual ±1 (0040).
--
-- ── O BUG QUE BLOQUEAVA ISSO ────────────────────────────────────────
-- A venda era inserida SEM maleta_id: registrar_venda não recebia a maleta e o
-- front gravava num UPDATE separado, fire-and-forget, DEPOIS do insert
-- (consignados.js). O trigger aplicar_fidelidade é AFTER INSERT — ele nunca
-- via o ciclo. Aqui registrar_venda passa a RESOLVER a maleta ativa no próprio
-- servidor; o UPDATE do front sai no mesmo deploy.
--
-- ── SEM RETROATIVIDADE ──────────────────────────────────────────────
-- As tabelas novas nascem VAZIAS e a linha do balde só surge na primeira venda
-- depois desta migração. Nenhuma cliente ganha ou perde selo agora, e nada do
-- passado é recalculado. Confira rodando o diagnóstico do fim do arquivo antes
-- e depois: sum(selos) e count(premios) têm de ficar idênticos.
--
-- ── LIMITE CONHECIDO (decisão registrada) ───────────────────────────
-- Excluir uma venda NÃO devolve o "troco". Cliente com 2×R$75 = 1 selo; se uma
-- das vendas for excluída, o selo volta apenas se ainda estiver numa cartela
-- ABERTA (mesmo comportamento de sempre — 0029:104-117 nunca desfez cartela
-- completa). A válvula é o ajuste manual ±1 do admin, que já existe.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) O balde: quanto já foi somado e quantos selos já saíram dele ──
--   bucket_id = maleta_id da venda, ou o próprio id da venda quando ela não
--   tem maleta (venda avulsa/legada vira balde de uma venda só = a regra
--   antiga, sem regressão).
--   `regra` fica gravada para o dia em que a política mudar de novo: dá para
--   distinguir balde velho de balde novo sem adivinhar por data.
create table if not exists public.fidelidade_acumulos (
  cliente_id      uuid    not null references public.clientes(id) on delete cascade,
  bucket_id       uuid    not null,
  valor_acumulado numeric not null default 0,
  selos_gerados   int     not null default 0,
  regra           text    not null default 'bucket' check (regra in ('venda','bucket')),
  atualizado_em   timestamptz not null default now(),
  primary key (cliente_id, bucket_id)
);

-- Quais vendas já entraram no balde. É a guarda de idempotência REAL: com
-- acúmulo, uma venda pode legitimamente gerar ZERO selos e ainda assim já ter
-- sido contada — a guarda antiga (0039:133, "existe selo desta venda?")
-- travaria todo crédito posterior no mesmo balde.
create table if not exists public.fidelidade_acumulo_vendas (
  venda_id   uuid primary key references public.vendas(id) on delete cascade,
  cliente_id uuid    not null,
  bucket_id  uuid    not null,
  valor      numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_fid_acum_vendas_bucket
  on public.fidelidade_acumulo_vendas (cliente_id, bucket_id);

-- RLS ligada e NENHUMA policy, de propósito: só SECURITY DEFINER escreve e lê.
-- Mesmo padrão de fidelidade_cartelas/_selos (0028:73-74, 0040:5-10). Sem o
-- revoke, o PostgREST exporia as tabelas ao token de qualquer autenticado.
alter table public.fidelidade_acumulos       enable row level security;
alter table public.fidelidade_acumulo_vendas enable row level security;
revoke all on public.fidelidade_acumulos       from anon, authenticated;
revoke all on public.fidelidade_acumulo_vendas from anon, authenticated;

-- ── 2) Crédito de selos: soma o balde e credita só o DELTA ───────────
--   Assinatura preservada — completar_venda_cliente (0041:94) chama esta.
create or replace function public.aplicar_fidelidade_venda(p_venda_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  SELOS_POR_CARTELA constant int     := 10;
  VALOR_POR_SELO    constant numeric := 150;
  v_venda    record;
  v_bucket   uuid;
  v_acum     numeric;
  v_ja       int;
  v_restante int; v_cartela uuid; v_selos int; v_aplicados int; v_total int;
  v_ganhos   int := 0; v_completou boolean := false;
begin
  select id, cliente_id, revendedora_id, valor_total, maleta_id
    into v_venda from vendas where id = p_venda_id;
  if not found or v_venda.cliente_id is null then
    return jsonb_build_object('selos_ganhos', 0);
  end if;

  v_bucket := coalesce(v_venda.maleta_id, v_venda.id);

  -- Lock ANTES de qualquer leitura do balde. A 0039 pegava o lock só depois
  -- dos early-returns; aqui não serve: duas vendas simultâneas da mesma
  -- cliente leriam o MESMO valor_acumulado/selos_gerados e creditariam o
  -- mesmo delta duas vezes (read-modify-write). Mesma chave da 0040:64, então
  -- o ajuste manual também é serializado contra isto.
  perform pg_advisory_xact_lock(hashtextextended(v_venda.cliente_id::text, 0));

  -- Idempotência: esta venda já foi somada neste balde?
  insert into fidelidade_acumulo_vendas (venda_id, cliente_id, bucket_id, valor)
  values (p_venda_id, v_venda.cliente_id, v_bucket, coalesce(v_venda.valor_total, 0))
  on conflict (venda_id) do nothing;
  if not found then
    return jsonb_build_object('selos_ganhos', 0, 'ja_aplicada', true);
  end if;

  insert into fidelidade_acumulos (cliente_id, bucket_id, valor_acumulado, selos_gerados)
  values (v_venda.cliente_id, v_bucket, coalesce(v_venda.valor_total, 0), 0)
  on conflict (cliente_id, bucket_id) do update
    set valor_acumulado = fidelidade_acumulos.valor_acumulado + excluded.valor_acumulado,
        atualizado_em   = now()
  returning valor_acumulado, selos_gerados into v_acum, v_ja;

  v_restante := floor(v_acum / VALOR_POR_SELO)::int - v_ja;
  if v_restante <= 0 then
    return jsonb_build_object(
      'selos_ganhos',  0,
      'cartela_selos', (select selos from fidelidade_cartelas
                         where cliente_id = v_venda.cliente_id and status = 'aberta'),
      'falta_para_selo', (v_ja + 1) * VALOR_POR_SELO - v_acum);
  end if;

  -- Distribuição idêntica à 0039/0030: enche a cartela aberta, e ao fechar 10
  -- emite o prêmio e abre a próxima com o EXCEDENTE.
  loop
    loop   -- get-or-create + lock da cartela aberta
      select id, selos into v_cartela, v_selos from fidelidade_cartelas
       where cliente_id = v_venda.cliente_id and status = 'aberta' for update;
      exit when found;
      insert into fidelidade_cartelas (cliente_id) values (v_venda.cliente_id)
        on conflict (cliente_id) where (status = 'aberta') do nothing;
    end loop;

    v_aplicados := least(v_restante, SELOS_POR_CARTELA - v_selos);
    insert into fidelidade_selos (cartela_id, cliente_id, venda_id, revendedora_id,
                                  quantidade, excedente_descartado, valor_venda)
    values (v_cartela, v_venda.cliente_id, v_venda.id, v_venda.revendedora_id,
            v_aplicados, 0, v_venda.valor_total)
    on conflict (venda_id, cartela_id) do nothing;
    if not found then exit; end if;

    v_ganhos := v_ganhos + v_aplicados;
    v_total  := v_selos + v_aplicados;
    update fidelidade_cartelas
       set selos = v_total,
           status = case when v_total >= SELOS_POR_CARTELA then 'completa' else status end,
           completada_em = case when v_total >= SELOS_POR_CARTELA then now() else completada_em end
     where id = v_cartela;
    v_restante := v_restante - v_aplicados;

    if v_total >= SELOS_POR_CARTELA then
      v_completou := true;
      insert into fidelidade_premios (cartela_id, cliente_id)
        values (v_cartela, v_venda.cliente_id) on conflict (cartela_id) do nothing;
      exit when v_restante <= 0;
      insert into fidelidade_cartelas (cliente_id, selos) values (v_venda.cliente_id, 0)
        on conflict (cliente_id) where (status = 'aberta') do nothing;
    else
      exit;
    end if;
  end loop;

  -- selos_gerados guarda o que foi APLICADO, nunca o que era devido: se o laço
  -- parar antes (idempotência da cartela), o que sobrou continua a creditar na
  -- próxima venda em vez de sumir.
  update fidelidade_acumulos
     set selos_gerados = v_ja + v_ganhos, atualizado_em = now()
   where cliente_id = v_venda.cliente_id and bucket_id = v_bucket;

  return jsonb_build_object(
    'selos_ganhos',    v_ganhos,
    'completou',       v_completou,
    'cartela_selos',   (select selos from fidelidade_cartelas
                         where cliente_id = v_venda.cliente_id and status = 'aberta'),
    'premio_pendente', exists (select 1 from fidelidade_premios p
                         where p.cliente_id = v_venda.cliente_id and p.status = 'pendente'));
end; $$;
revoke all on function public.aplicar_fidelidade_venda(uuid) from public, anon, authenticated;

-- ── 3) Tirar uma venda do balde ──────────────────────────────────────
--   Usada na EXCLUSÃO da venda e no REAPONTE de cliente (0041). Subtrai só os
--   selos que de fato voltarão para a cartela: os que estão em cartela ABERTA.
--   Cartela completa/premiada nunca é desfeita automaticamente (regra de
--   sempre — 0029:102-103), então descontá-los aqui faria o balde recreditar
--   um selo que continua fisicamente lá.
--   PRECISA rodar ANTES de apagar as linhas de fidelidade_selos da venda.
create or replace function public.fidelidade_remover_venda_do_acumulo(p_venda_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_reg record; v_selos int;
begin
  select * into v_reg from fidelidade_acumulo_vendas where venda_id = p_venda_id;
  if not found then return; end if;

  select coalesce(sum(s.quantidade), 0) into v_selos
    from fidelidade_selos s
    join fidelidade_cartelas c on c.id = s.cartela_id
   where s.venda_id = p_venda_id and not s.ajuste_manual and c.status = 'aberta';

  update fidelidade_acumulos
     set valor_acumulado = greatest(0, valor_acumulado - v_reg.valor),
         selos_gerados   = greatest(0, selos_gerados - v_selos),
         atualizado_em   = now()
   where cliente_id = v_reg.cliente_id and bucket_id = v_reg.bucket_id;

  delete from fidelidade_acumulo_vendas where venda_id = p_venda_id;
end; $$;
revoke all on function public.fidelidade_remover_venda_do_acumulo(uuid) from public, anon, authenticated;

-- BEFORE DELETE (e não AFTER): aqui as linhas de fidelidade_selos e o status
-- da cartela ainda existem, então dá para saber quanto vai voltar. Depois do
-- cascade não daria. Erro vira warning — excluir venda nunca pode falhar por
-- causa de fidelidade.
create or replace function public.fidelidade_venda_removida()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fidelidade_remover_venda_do_acumulo(old.id);
  return old;
exception when others then
  raise warning 'fidelidade_venda_removida falhou (venda %): %', old.id, sqlerrm;
  return old;
end; $$;
drop trigger if exists fidelidade_venda_removida_trg on public.vendas;
create trigger fidelidade_venda_removida_trg
  before delete on public.vendas
  for each row execute function public.fidelidade_venda_removida();

-- ── 4) registrar_venda v8: resolve a MALETA no servidor ──────────────
--   Corpo da v7 (0055) + p_maleta_id e a resolução do ciclo. O parâmetro é só
--   override e SÓ vale se a maleta for da própria pessoa — senão a venda
--   entraria no ciclo de outra revendedora.
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,int,int,date,jsonb);

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
  p_pagamentos jsonb default null,   -- [{forma, valor, data}]
  p_maleta_id  uuid  default null    -- override; ignorado se não for da pessoa
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
  v_maleta     uuid;
  v_fid        jsonb;
  v_forma      text    := p_forma;
  v_pago       numeric := coalesce(p_pago, 0);
  v_status     text    := p_status;
  v_n          int     := 0;
  v_dia        int     := p_nasc_dia;
  v_mes        int     := p_nasc_mes;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  -- Aniversario e dado de MARKETING: par invalido (31/02, dia sem mes) vira
  -- 'sem aniversario' em vez de estourar vendas_aniversario_chk e derrubar a
  -- venda inteira.
  if not public.aniversario_valido(v_dia, v_mes) then
    v_dia := null; v_mes := null;
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

  -- CICLO da venda. Sem isto a fidelidade por ciclo (0057) não funciona: o
  -- trigger é AFTER INSERT e o front só gravava a maleta num UPDATE posterior.
  -- maletas_uma_ativa (maletas-schema) garante no máximo uma ativa por pessoa.
  select m.id into v_maleta from maletas m
   where m.id = p_maleta_id and m.revendedora_id = auth.uid();
  if v_maleta is null then
    select m.id into v_maleta from maletas m
     where m.revendedora_id = auth.uid() and m.status = 'ativa'
     limit 1;
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, v_dia, v_mes);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, aniversario_dia, aniversario_mes, data_combinada,
    cliente_id, maleta_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,
    p_total, v_pago, v_status, p_obs,
    p_tel, v_dia, v_mes, p_combinada,
    v_cliente_id, v_maleta
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

  -- Recebimentos: um por linha efetivamente paga (0051).
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

  -- A venda pode gerar selos em 2 cartelas (excedente acumula) → soma. Com a
  -- regra nova a venda pode legitimamente gerar 0 (o valor ficou guardado no
  -- balde do ciclo) — por isso vai junto 'falta_para_selo': sem esse número o
  -- "+0 selos" na tela da revendedora parece bug, e ela desconfia da regra.
  select jsonb_build_object(
    'selos_ganhos',         coalesce(sum(s.quantidade), 0),
    'excedente_descartado', 0,
    'cartela_selos',        (select selos from fidelidade_cartelas
                              where cliente_id = v_cliente_id and status = 'aberta'),
    'completou',            exists (select 1 from fidelidade_selos s2
                              join fidelidade_cartelas c on c.id = s2.cartela_id
                              where s2.venda_id = v_venda_id and c.status = 'completa'),
    'premio_pendente',      exists (select 1 from fidelidade_premios p
                              where p.cliente_id = v_cliente_id and p.status = 'pendente'),
    'ciclo_acumulado',      (select a.valor_acumulado from fidelidade_acumulos a
                              where a.cliente_id = v_cliente_id and a.bucket_id = coalesce(v_maleta, v_venda_id)),
    'falta_para_selo',      (select (a.selos_gerados + 1) * 150 - a.valor_acumulado
                               from fidelidade_acumulos a
                              where a.cliente_id = v_cliente_id and a.bucket_id = coalesce(v_maleta, v_venda_id))
  ) into v_fid
  from fidelidade_selos s where s.venda_id = v_venda_id;

  return jsonb_build_object('venda_id', v_venda_id, 'cliente_id', v_cliente_id, 'fidelidade', v_fid);
end;
$$;
revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,int,int,date,jsonb,uuid) from public, anon;
grant  execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,int,int,date,jsonb,uuid) to authenticated;

-- ── 5) completar_venda_cliente: o reaponte tira a venda do balde ────
--   Corpo da 0055 + a chamada de fidelidade_remover_venda_do_acumulo ANTES do
--   delete dos selos. Sem isso o balde do cliente ANTIGO continuaria contando
--   o valor e os selos da venda realocada, e a guarda de idempotência faria a
--   cliente NOVA não receber nada.
create or replace function public.completar_venda_cliente(
  p_venda_id uuid, p_nome text, p_tel text,
  p_dia int default null, p_mes int default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_venda record; v_cliente_id uuid; v_pode boolean; v_cel text; v_fid jsonb;
        v_antigo uuid; v_realocou boolean := false;
        v_dia int := p_dia; v_mes int := p_mes;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;
  -- Par invalido vira "sem aniversario" (nao derruba a correcao da venda).
  if not public.aniversario_valido(v_dia, v_mes) then v_dia := null; v_mes := null; end if;

  select id, revendedora_id, cliente_id into v_venda
    from vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda nao encontrada'; end if;

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

  v_cliente_id := public.cliente_upsert_para_venda(p_nome, v_cel, v_dia, v_mes);
  if v_cliente_id is null then
    raise exception 'Nao foi possivel registrar a cliente';
  end if;

  -- REAPONTAR: tira a venda do balde da cliente ANTIGA (na ordem certa — o
  -- acúmulo precisa ler os selos antes de eles serem apagados) e depois apaga
  -- os selos. O trigger fidelidade_selo_removido devolve os selos à cartela
  -- ABERTA de origem; cartela já completa não é desfeita (use o ajuste manual).
  v_antigo := v_venda.cliente_id;
  if v_antigo is not null and v_antigo <> v_cliente_id then
    perform public.fidelidade_remover_venda_do_acumulo(p_venda_id);
    delete from fidelidade_selos where venda_id = p_venda_id;
    v_realocou := true;
  end if;

  -- APENAS estas colunas. Valores, peças, datas e status NUNCA mudam aqui.
  update vendas
     set nome_cliente     = btrim(p_nome),
         telefone_cliente = v_cel,
         -- Par ATOMICO: coalesce campo a campo poderia montar dia-sem-mes.
         aniversario_dia  = case when v_mes is null then aniversario_dia else v_dia end,
         aniversario_mes  = case when v_mes is null then aniversario_mes else v_mes end,
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

-- ── 6) fidelidade_status v3: mostra quanto falta para o próximo selo ─
--   Continua SECURITY INVOKER (a RLS 0028 filtra por papel). O bloco novo
--   'ciclo' é o que explica para a revendedora por que a venda de R$75 não
--   gerou selo — sem ele a regra nova parece um bug.
create or replace function public.fidelidade_status(p_cliente_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'cliente_id', p_cliente_id,
    'cartela', (select jsonb_build_object('id', id, 'selos', selos, 'criada_em', created_at)
                  from fidelidade_cartelas where cliente_id = p_cliente_id and status = 'aberta'),
    'premios_pendentes', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', id, 'valor', valor, 'criado_em', created_at) order by created_at)
                  from fidelidade_premios where cliente_id = p_cliente_id and status = 'pendente'), '[]'::jsonb),
    'cartelas_completas', (select count(*) from fidelidade_cartelas
                            where cliente_id = p_cliente_id and status = 'completa'),
    'selos_total', coalesce((select sum(quantidade) from fidelidade_selos
                              where cliente_id = p_cliente_id), 0),
    'extrato', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
                 'venda_id',         s.venda_id,
                 'quantidade',       s.quantidade,
                 'valor_venda',      s.valor_venda,
                 'em',               s.created_at,
                 'ajuste_manual',    s.ajuste_manual,
                 'premio_cancelado', s.premio_cancelado,
                 'motivo', case when public.is_staff() then s.ajuste_motivo end,
                 'autor',  case when public.is_staff()
                                then (select pr.nome from profiles pr where pr.id = s.ajustado_por) end
               ) as x
          from fidelidade_selos s
         where s.cliente_id = p_cliente_id
         order by s.created_at desc limit 20) t), '[]'::jsonb)
  );
$$;
revoke all on function public.fidelidade_status(uuid) from public;
grant  execute on function public.fidelidade_status(uuid) to authenticated;

-- ── 7) Quanto falta para o próximo selo, no ciclo ATUAL ──────────────
--   Consulta separada porque depende de um balde específico (a maleta ativa)
--   e fidelidade_status é por cliente, sem noção de ciclo. SECURITY DEFINER
--   com escopo manual: fidelidade_acumulos não tem policy nenhuma.
create or replace function public.fidelidade_ciclo_cliente(p_cliente_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  VALOR_POR_SELO constant numeric := 150;
  v_bucket uuid; v_acum numeric := 0; v_ja int := 0;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;
  -- Mesmo escopo da RLS de clientes (0021/0028): staff vê todas; a revendedora
  -- só quem já comprou com ela.
  if not (public.is_staff()
          or exists (select 1 from vendas v
                      where v.cliente_id = p_cliente_id and v.revendedora_id = auth.uid())) then
    return jsonb_build_object('tem_ciclo', false);
  end if;

  select m.id into v_bucket from maletas m
   where m.revendedora_id = auth.uid() and m.status = 'ativa' limit 1;
  if v_bucket is null then return jsonb_build_object('tem_ciclo', false); end if;

  select valor_acumulado, selos_gerados into v_acum, v_ja
    from fidelidade_acumulos
   where cliente_id = p_cliente_id and bucket_id = v_bucket;

  return jsonb_build_object(
    'tem_ciclo',       true,
    'acumulado',       coalesce(v_acum, 0),
    'selos_do_ciclo',  coalesce(v_ja, 0),
    'falta_para_selo', (coalesce(v_ja, 0) + 1) * VALOR_POR_SELO - coalesce(v_acum, 0));
end; $$;
revoke all on function public.fidelidade_ciclo_cliente(uuid) from public, anon;
grant  execute on function public.fidelidade_ciclo_cliente(uuid) to authenticated;

-- DIAGNÓSTICO — rodar ANTES e DEPOIS; os dois números têm de ficar iguais:
--   select (select coalesce(sum(selos),0) from public.fidelidade_cartelas) as selos,
--          (select count(*) from public.fidelidade_premios)                as premios;
-- Depois das primeiras vendas, para conferir a regra nova:
--   select c.nome, a.valor_acumulado, a.selos_gerados
--     from public.fidelidade_acumulos a join public.clientes c on c.id = a.cliente_id
--    order by a.atualizado_em desc limit 20;

select pg_notify('pgrst', 'reload schema');
