-- ════════════════════════════════════════════════════════════════════
-- TESTE da 0057 — a fidelidade soma as vendas dentro do ciclo da maleta.
--
-- COMO RODAR: Supabase → SQL Editor → cole TUDO → Run. Rodar DEPOIS de aplicar
-- a 0055 e a 0057. O script inteiro vive numa transação e termina em ROLLBACK:
-- **nada** fica gravado, nem a cliente nem a maleta de teste.
--
-- Cada asserção estoura com `raise exception` e aborta na hora. Se chegar ao
-- fim imprimindo "TODOS OS TESTES PASSARAM", está tudo certo.
--
-- Ele não usa auth.uid(): chama aplicar_fidelidade_venda diretamente, que é a
-- função que o trigger executa. O caminho de permissão (registrar_venda) não é
-- coberto aqui — teste aquele pelo app, com a conta de teste.
-- ════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_rev     uuid;
  v_cli     uuid;
  v_maleta1 uuid;
  v_maleta2 uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid;
  v_selos  int;
  v_premios int;
  v_acum   numeric;
  v_ret    jsonb;

  procedure_nome text;

  -- helper inline: cria uma venda já com maleta e aplica a fidelidade
  function _ignora() returns void as $x$ begin end $x$ language plpgsql;
begin
  raise notice '--- preparando dados de teste ---';

  -- Uma revendedora qualquer só para ter FK válida em maletas.
  select id into v_rev from public.profiles limit 1;
  if v_rev is null then raise exception 'TESTE ABORTADO: nao existe nenhum profile'; end if;

  insert into public.clientes (nome, celular)
  values ('ZZ Teste Fidelidade Ciclo', '11987650001') returning id into v_cli;

  insert into public.maletas (revendedora_id, status) values (v_rev, 'aguardando')
    returning id into v_maleta1;
  insert into public.maletas (revendedora_id, status) values (v_rev, 'aguardando')
    returning id into v_maleta2;

  -- ══ TESTE 1 — 75 + 75 na MESMA maleta = 1 selo ════════════════════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_maleta1)
  returning id into v_v1;
  v_ret := public.aplicar_fidelidade_venda(v_v1);
  if (v_ret->>'selos_ganhos')::int <> 0 then
    raise exception 'T1a FALHOU: venda de 75 gerou % selo(s), esperado 0', v_ret->>'selos_ganhos';
  end if;

  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_maleta1)
  returning id into v_v2;
  v_ret := public.aplicar_fidelidade_venda(v_v2);
  if (v_ret->>'selos_ganhos')::int <> 1 then
    raise exception 'T1b FALHOU: a 2a venda de 75 gerou % selo(s), esperado 1', v_ret->>'selos_ganhos';
  end if;

  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if coalesce(v_selos, 0) <> 1 then
    raise exception 'T1c FALHOU: cartela com % selo(s), esperado 1', coalesce(v_selos, 0);
  end if;
  raise notice 'T1 OK — 75 + 75 na mesma maleta = 1 selo';

  -- ══ TESTE 2 — idempotência: reaplicar a MESMA venda não credita ═══
  v_ret := public.aplicar_fidelidade_venda(v_v2);
  if (v_ret->>'selos_ganhos')::int <> 0 or (v_ret->>'ja_aplicada') is null then
    raise exception 'T2 FALHOU: reaplicar a venda creditou de novo (%)', v_ret;
  end if;
  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if v_selos <> 1 then raise exception 'T2 FALHOU: cartela foi para % selos', v_selos; end if;
  raise notice 'T2 OK — reaplicar a mesma venda nao credita de novo';

  -- ══ TESTE 3 — 75 em OUTRA maleta não soma com o ciclo anterior ════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_maleta2)
  returning id into v_v3;
  v_ret := public.aplicar_fidelidade_venda(v_v3);
  if (v_ret->>'selos_ganhos')::int <> 0 then
    raise exception 'T3 FALHOU: 75 numa maleta NOVA gerou % selo(s), esperado 0', v_ret->>'selos_ganhos';
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_maleta2;
  if v_acum <> 75 then raise exception 'T3 FALHOU: balde da maleta 2 com %, esperado 75', v_acum; end if;
  raise notice 'T3 OK — maletas diferentes nao somam entre si';

  -- ══ TESTE 4 — venda grande fecha a cartela, gera premio e transborda ══
  --   Cartela está em 1. Uma venda de 1500 vale 10 selos: 9 fecham a cartela
  --   (premio) e 1 abre a proxima.
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 1500, 1500, 'quitado', v_cli, v_maleta1)
  returning id into v_v4;
  v_ret := public.aplicar_fidelidade_venda(v_v4);
  if (v_ret->>'selos_ganhos')::int <> 10 then
    raise exception 'T4a FALHOU: venda de 1500 gerou % selo(s), esperado 10', v_ret->>'selos_ganhos';
  end if;
  select count(*) into v_premios from public.fidelidade_premios
   where cliente_id = v_cli and status = 'pendente';
  if v_premios <> 1 then raise exception 'T4b FALHOU: % premio(s) pendente(s), esperado 1', v_premios; end if;
  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if v_selos <> 1 then
    raise exception 'T4c FALHOU: cartela nova com % selo(s), esperado 1 (excedente)', v_selos;
  end if;
  raise notice 'T4 OK — cartela fecha, premio nasce e o excedente vai para a nova';

  -- ══ TESTE 5 — venda SEM maleta vira balde proprio (regra antiga) ══
  declare v_v5 uuid; begin
    insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                               valor_total, valor_pago, status, cliente_id, maleta_id)
    values (v_rev, 'ZZ Teste', current_date, 'Pix', 100, 100, 'quitado', v_cli, null)
    returning id into v_v5;
    v_ret := public.aplicar_fidelidade_venda(v_v5);
    if (v_ret->>'selos_ganhos')::int <> 0 then
      raise exception 'T5 FALHOU: venda avulsa de 100 gerou % selo(s), esperado 0', v_ret->>'selos_ganhos';
    end if;
    if not exists (select 1 from public.fidelidade_acumulos
                    where cliente_id = v_cli and bucket_id = v_v5) then
      raise exception 'T5 FALHOU: venda sem maleta nao virou balde proprio';
    end if;
  end;
  raise notice 'T5 OK — venda sem maleta vira balde proprio';

  -- ══ TESTE 6 — excluir venda tira o valor do balde ═════════════════
  --   v_v1 (75) sai; o balde da maleta 1 vai de 1650 para 1575, e o selo
  --   creditado sob v_v1 (nenhum) nao muda a cartela.
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_maleta1;
  delete from public.vendas where id = v_v1;
  declare v_depois numeric; begin
    select valor_acumulado into v_depois from public.fidelidade_acumulos
     where cliente_id = v_cli and bucket_id = v_maleta1;
    if v_depois <> v_acum - 75 then
      raise exception 'T6 FALHOU: balde foi de % para %, esperado %', v_acum, v_depois, v_acum - 75;
    end if;
    if exists (select 1 from public.fidelidade_acumulo_vendas where venda_id = v_v1) then
      raise exception 'T6 FALHOU: a venda excluida continua no acumulo';
    end if;
  end;
  raise notice 'T6 OK — excluir venda tira o valor do balde';

  raise notice '';
  raise notice '════════ TODOS OS TESTES PASSARAM ════════';
end $$;

rollback;
