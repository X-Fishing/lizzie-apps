-- ════════════════════════════════════════════════════════════════════
-- TESTE da 0057 — a fidelidade soma as vendas dentro do ciclo da maleta.
--
-- COMO RODAR: Supabase → SQL Editor → cole TUDO → Run. Rodar DEPOIS de aplicar
-- a 0055 e a 0057. O script inteiro vive numa transação e termina em ROLLBACK:
-- **nada** fica gravado, nem a cliente nem as maletas de teste.
--
-- Cada asserção estoura com `raise exception` e aborta na hora. Se chegar ao
-- fim imprimindo "TODOS OS TESTES PASSARAM", está tudo certo.
--
-- ⚠️ O CRÉDITO VEM DO GATILHO, NÃO DE CHAMADA DIRETA. `aplicar_fidelidade_trg`
-- é AFTER INSERT em `vendas` (0039), então o simples INSERT já aplica os selos.
-- Chamar `aplicar_fidelidade_venda` depois devolveria `ja_aplicada: true` — é
-- justamente o que o teste T2 usa para provar a idempotência.
--
-- NÃO COBERTO AQUI (precisa de auth.uid(), que o SQL Editor não tem):
-- registrar_venda, completar_venda_cliente e fidelidade_ajustar_selo. Teste
-- esses três pelo app, com a conta de teste.
--
-- As maletas de teste nascem 'finalizada' de propósito: `guard_max_maletas`
-- (maletas-schema) recusa a 3ª maleta em aberto, e a revendedora escolhida
-- pode já ter duas.
-- ════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_rev     uuid;
  v_cli     uuid;
  v_m1      uuid;
  v_m2      uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid; v_v5 uuid; v_v6 uuid;
  v_selos   int;
  v_premios int;
  v_acum    numeric;
  v_ja      int;
  v_ret     jsonb;
  v_cartela uuid;
begin
  raise notice '--- preparando ---';

  select id into v_rev from public.profiles limit 1;
  if v_rev is null then raise exception 'TESTE ABORTADO: nao existe nenhum profile'; end if;

  insert into public.clientes (nome, celular)
  values ('ZZ Teste Fidelidade Ciclo', '11987650001') returning id into v_cli;

  insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m1;
  insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m2;

  -- ══ T1 — 75 + 75 na MESMA maleta = 1 selo ═════════════════════════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_m1)
  returning id into v_v1;

  select coalesce(selos, 0) into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if coalesce(v_selos, 0) <> 0 then
    raise exception 'T1a FALHOU: apos 1 venda de 75 a cartela tem % selo(s), esperado 0', coalesce(v_selos,0);
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m1;
  if v_acum <> 75 then raise exception 'T1b FALHOU: balde com %, esperado 75', v_acum; end if;

  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_m1)
  returning id into v_v2;

  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if coalesce(v_selos, 0) <> 1 then
    raise exception 'T1c FALHOU: 75+75 na mesma maleta deu % selo(s), esperado 1', coalesce(v_selos,0);
  end if;
  raise notice 'T1 OK — 75 + 75 na mesma maleta = 1 selo';

  -- ══ T2 — idempotência no caso DISCRIMINANTE ═══════════════════════
  --   Reaplica a venda v1, que gerou ZERO selos. A guarda ANTIGA da 0039 era
  --   "esta venda ja tem linha em fidelidade_selos?" — v1 não tem, então a
  --   guarda velha deixaria passar e o balde iria de 150 para 225. Só a guarda
  --   nova (fidelidade_acumulo_vendas) segura este caso.
  v_ret := public.aplicar_fidelidade_venda(v_v1);
  if coalesce((v_ret->>'ja_aplicada')::boolean, false) is not true then
    raise exception 'T2a FALHOU: reaplicar venda de 0 selos nao foi barrada (%)', v_ret;
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m1;
  if v_acum <> 150 then
    raise exception 'T2b FALHOU: balde foi para % apos reaplicar, esperado 150', v_acum;
  end if;
  raise notice 'T2 OK — reaplicar venda de 0 selos nao recontabiliza';

  -- ══ T3 — outra maleta NÃO soma com o ciclo anterior ═══════════════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_m2)
  returning id into v_v3;
  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if v_selos <> 1 then
    raise exception 'T3a FALHOU: 75 numa maleta NOVA levou a cartela a %, esperado continuar 1', v_selos;
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m2;
  if v_acum <> 75 then raise exception 'T3b FALHOU: balde da maleta 2 com %, esperado 75', v_acum; end if;
  raise notice 'T3 OK — maletas diferentes nao somam entre si';

  -- ══ T4 — venda grande fecha cartela, gera premio e transborda ═════
  --   Balde da maleta 1 está em 150 (1 selo). +1500 → 1650 → floor = 11 → +10.
  --   Cartela está em 1: 9 fecham (premio) e 1 abre a proxima.
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 1500, 1500, 'quitado', v_cli, v_m1)
  returning id into v_v4;

  select count(*) into v_premios from public.fidelidade_premios
   where cliente_id = v_cli and status = 'pendente';
  if v_premios <> 1 then raise exception 'T4a FALHOU: % premio(s) pendente(s), esperado 1', v_premios; end if;
  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if v_selos <> 1 then
    raise exception 'T4b FALHOU: cartela nova com % selo(s), esperado 1 (excedente)', v_selos;
  end if;
  select selos_gerados into v_ja from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m1;
  if v_ja <> 11 then raise exception 'T4c FALHOU: selos_gerados do balde = %, esperado 11', v_ja; end if;
  raise notice 'T4 OK — cartela fecha, premio nasce e o excedente vai para a nova';

  -- ══ T5 — venda SEM maleta vira balde proprio (regra antiga) ═══════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 100, 100, 'quitado', v_cli, null)
  returning id into v_v5;
  if not exists (select 1 from public.fidelidade_acumulos
                  where cliente_id = v_cli and bucket_id = v_v5) then
    raise exception 'T5a FALHOU: venda sem maleta nao virou balde proprio';
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_v5;
  if v_acum <> 100 then raise exception 'T5b FALHOU: balde avulso com %, esperado 100', v_acum; end if;
  raise notice 'T5 OK — venda sem maleta vira balde proprio';

  -- ══ T6 — valor 0 e valor null nao quebram nem creditam ════════════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 0, 0, 'quitado', v_cli, v_m2);
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', null, 0, 'pendente', v_cli, v_m2);
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m2;
  if v_acum <> 75 then raise exception 'T6 FALHOU: balde da maleta 2 foi para %, esperado seguir 75', v_acum; end if;
  raise notice 'T6 OK — venda de valor 0/null nao mexe no balde';

  -- ══ T7 — excluir venda cujo selo esta em cartela ABERTA ═══════════
  --   Balde novo: 150 numa maleta nova → 1 selo na cartela aberta (que hoje
  --   tem 1, vai a 2). Excluir devolve o selo E limpa o balde.
  declare v_m3 uuid; v_antes int; begin
    insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m3;
    select selos into v_antes from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';

    insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                               valor_total, valor_pago, status, cliente_id, maleta_id)
    values (v_rev, 'ZZ Teste', current_date, 'Pix', 150, 150, 'quitado', v_cli, v_m3)
    returning id into v_v6;

    select selos into v_selos from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if v_selos <> v_antes + 1 then
      raise exception 'T7a FALHOU: cartela foi de % para %, esperado +1', v_antes, v_selos;
    end if;

    delete from public.vendas where id = v_v6;

    select selos into v_selos from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if v_selos <> v_antes then
      raise exception 'T7b FALHOU: apos excluir, cartela ficou em %, esperado voltar a %', v_selos, v_antes;
    end if;
    select valor_acumulado, selos_gerados into v_acum, v_ja from public.fidelidade_acumulos
     where cliente_id = v_cli and bucket_id = v_m3;
    if coalesce(v_acum, 0) <> 0 or coalesce(v_ja, 0) <> 0 then
      raise exception 'T7c FALHOU: balde ficou em valor=% selos=%, esperado 0/0', v_acum, v_ja;
    end if;
    if exists (select 1 from public.fidelidade_acumulo_vendas where venda_id = v_v6) then
      raise exception 'T7d FALHOU: a venda excluida continua no acumulo';
    end if;
  end;
  raise notice 'T7 OK — excluir venda devolve o selo da cartela aberta e zera o balde';

  -- ══ T8 — ajuste manual nao e comido pelo balde ════════════════════
  --   Insere um selo MANUAL direto (a RPC fidelidade_ajustar_selo exige
  --   auth.uid(), que nao existe no SQL Editor) e confere que ele sobrevive a
  --   uma venda nova no mesmo balde e a uma exclusao de venda.
  declare v_m4 uuid; v_v7 uuid; v_antes int; begin
    insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m4;
    select id, selos into v_cartela, v_antes from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';

    insert into public.fidelidade_selos (cartela_id, cliente_id, venda_id, quantidade,
                                         excedente_descartado, ajuste_manual)
    values (v_cartela, v_cli, null, 1, 0, true);
    update public.fidelidade_cartelas set selos = v_antes + 1 where id = v_cartela;

    insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                               valor_total, valor_pago, status, cliente_id, maleta_id)
    values (v_rev, 'ZZ Teste', current_date, 'Pix', 150, 150, 'quitado', v_cli, v_m4)
    returning id into v_v7;

    if not exists (select 1 from public.fidelidade_selos
                    where cliente_id = v_cli and ajuste_manual and quantidade = 1) then
      raise exception 'T8a FALHOU: a venda apagou o selo manual';
    end if;

    delete from public.vendas where id = v_v7;
    if not exists (select 1 from public.fidelidade_selos
                    where cliente_id = v_cli and ajuste_manual and quantidade = 1) then
      raise exception 'T8b FALHOU: excluir a venda levou o selo manual junto';
    end if;
    select selos_gerados into v_ja from public.fidelidade_acumulos
     where cliente_id = v_cli and bucket_id = v_m4;
    if coalesce(v_ja, 0) <> 0 then
      raise exception 'T8c FALHOU: o balde descontou o selo manual (selos_gerados = %)', v_ja;
    end if;
  end;
  raise notice 'T8 OK — ajuste manual sobrevive ao balde';

  -- ══ T9 — as tabelas do balde nao sao expostas ao PostgREST ════════
  if has_table_privilege('authenticated', 'public.fidelidade_acumulos', 'SELECT')
     or has_table_privilege('authenticated', 'public.fidelidade_acumulo_vendas', 'SELECT') then
    raise exception 'T9 FALHOU: authenticated tem SELECT nas tabelas do balde';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('fidelidade_acumulos','fidelidade_acumulo_vendas')) then
    raise exception 'T9 FALHOU: existe policy nas tabelas do balde (deveriam ter zero)';
  end if;
  raise notice 'T9 OK — tabelas do balde fechadas para authenticated';

  raise notice '';
  raise notice '════════ TODOS OS TESTES PASSARAM ════════';
end $$;

rollback;
