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
-- ⚠️ TODA comparação usa coalesce(x, -1). `SELECT ... INTO` sem linha atribui
-- NULL, e `NULL <> 1` é NULL — o `if` não dispara e a asserção passa EM
-- SILÊNCIO. Sem isso, um teste como o T4b (que existe para provar que a
-- cartela nova foi aberta) daria verde justamente quando ela NÃO fosse aberta.
-- Ao adicionar asserção nova, mantenha o padrão.
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
  if coalesce(v_acum, -1) <> 75 then raise exception 'T1b FALHOU: balde com %, esperado 75', coalesce(v_acum, -1); end if;

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
  if coalesce(v_acum, -1) <> 150 then
    raise exception 'T2b FALHOU: balde foi para % apos reaplicar, esperado 150', coalesce(v_acum, -1);
  end if;
  raise notice 'T2 OK — reaplicar venda de 0 selos nao recontabiliza';

  -- ══ T3 — outra maleta NÃO soma com o ciclo anterior ═══════════════
  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 75, 75, 'quitado', v_cli, v_m2)
  returning id into v_v3;
  select selos into v_selos from public.fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if coalesce(v_selos, -1) <> 1 then
    raise exception 'T3a FALHOU: 75 numa maleta NOVA levou a cartela a % (NULL vira -1), esperado continuar 1', coalesce(v_selos, -1);
  end if;
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m2;
  if coalesce(v_acum, -1) <> 75 then raise exception 'T3b FALHOU: balde da maleta 2 com %, esperado 75', coalesce(v_acum, -1); end if;
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
  if coalesce(v_selos, -1) <> 1 then
    raise exception 'T4b FALHOU: cartela nova com % selo(s) (NULL vira -1 = a cartela nova nem foi aberta), esperado 1', coalesce(v_selos, -1);
  end if;
  select selos_gerados into v_ja from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m1;
  if coalesce(v_ja, -1) <> 11 then raise exception 'T4c FALHOU: selos_gerados do balde = %, esperado 11', coalesce(v_ja, -1); end if;
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
  if coalesce(v_acum, -1) <> 100 then raise exception 'T5b FALHOU: balde avulso com %, esperado 100', coalesce(v_acum, -1); end if;
  raise notice 'T5 OK — venda sem maleta vira balde proprio';

  -- ══ T6 — venda de valor 0 nao mexe no balde ═══════════════════════
  --   O caso valor_total NULL nao existe: a coluna e NOT NULL no banco (a
  --   tabela `vendas` nao esta versionada no repo, entao isto foi verificado
  --   contra o banco real). O coalesce(valor_total, 0) da 0057 e defensivo e
  --   inalcancavel — a asserção abaixo trava a premissa: se um dia alguem
  --   tornar a coluna nullable, este teste avisa que o caso passa a existir.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='vendas'
                and column_name='valor_total' and is_nullable='YES') then
    raise exception 'T6 FALHOU: vendas.valor_total virou NULLABLE — cubra o caso NULL no teste e reveja o coalesce da 0057';
  end if;

  insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                             valor_total, valor_pago, status, cliente_id, maleta_id)
  values (v_rev, 'ZZ Teste', current_date, 'Pix', 0, 0, 'quitado', v_cli, v_m2);
  select valor_acumulado into v_acum from public.fidelidade_acumulos
   where cliente_id = v_cli and bucket_id = v_m2;
  if coalesce(v_acum, -1) <> 75 then raise exception 'T6 FALHOU: balde da maleta 2 foi para % (NULL vira -1), esperado seguir 75', coalesce(v_acum, -1); end if;
  raise notice 'T6 OK — venda de valor 0 nao mexe no balde (NULL e impossivel: coluna NOT NULL)';

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
    if coalesce(v_selos, -1) <> coalesce(v_antes, 0) + 1 then
      raise exception 'T7a FALHOU: cartela foi de % para % (NULL vira -1), esperado +1', v_antes, coalesce(v_selos, -1);
    end if;

    delete from public.vendas where id = v_v6;

    select selos into v_selos from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if coalesce(v_selos, -1) <> coalesce(v_antes, 0) then
      raise exception 'T7b FALHOU: apos excluir, cartela ficou em % (NULL vira -1), esperado voltar a %', coalesce(v_selos, -1), v_antes;
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
  if has_function_privilege('authenticated', 'public.aplicar_fidelidade_venda(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fidelidade_remover_venda_do_acumulo(uuid)', 'EXECUTE') then
    raise exception 'T9 FALHOU: authenticated pode EXECUTAR funcao interna de fidelidade';
  end if;
  raise notice 'T9 OK — tabelas e funcoes internas do balde fechadas para authenticated';

  -- ══ T10 — VENDA LEGADA nao pode ser creditada duas vezes ══════════
  --   Simula o estado do dia do deploy: a venda ja tem selos (regra antiga)
  --   mas NAO esta em fidelidade_acumulo_vendas, porque a tabela nasceu vazia.
  --   Sem tratamento, reprocessar (o botao "Corrigir dados da cliente" faz
  --   isso) creditaria os selos DE NOVO numa cartela nova.
  --   E o caso que MAIS importa: a cartela de ORIGEM ja FECHOU. Ai o indice
  --   unico (venda_id, cartela_id) nao segura nada — a 2a passagem cai numa
  --   cartela NOVA e o par e inedito. Por isso o teste primeiro leva a cartela
  --   aberta a 9, para os 3 selos da venda de R$450 fecharem uma e transbordar
  --   para outra.
  declare v_m5 uuid; v_v8 uuid; v_topo uuid; v_antes int; v_depois int; v_falta int; begin
    insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m5;

    select coalesce(selos, 0) into v_antes from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    v_falta := 9 - coalesce(v_antes, 0);
    if v_falta > 0 then
      insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                                 valor_total, valor_pago, status, cliente_id, maleta_id)
      values (v_rev, 'ZZ Teste', current_date, 'Pix', v_falta * 150, v_falta * 150, 'quitado', v_cli, v_m5)
      returning id into v_topo;
    end if;
    select coalesce(selos, 0) into v_antes from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if coalesce(v_antes, -1) <> 9 then
      raise exception 'T10 PREPARO FALHOU: cartela deveria estar em 9, esta em %', coalesce(v_antes, -1);
    end if;

    -- 3 selos: 1 FECHA a cartela (premio) e 2 vao para a nova.
    insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                               valor_total, valor_pago, status, cliente_id, maleta_id)
    values (v_rev, 'ZZ Teste', current_date, 'Pix', 450, 450, 'quitado', v_cli, v_m5)
    returning id into v_v8;

    select coalesce(selos, 0) into v_antes from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if coalesce(v_antes, -1) <> 2 then
      raise exception 'T10 PREPARO FALHOU: cartela nova deveria ter 2 selos, tem %', coalesce(v_antes, -1);
    end if;
    if not exists (select 1 from public.fidelidade_selos s
                     join public.fidelidade_cartelas c on c.id = s.cartela_id
                    where s.venda_id = v_v8 and c.status = 'completa') then
      raise exception 'T10 PREPARO FALHOU: a venda deveria ter selo numa cartela COMPLETA';
    end if;

    -- "envelhece" a venda: some do controle novo, mantendo os selos ja dados
    delete from public.fidelidade_acumulo_vendas where venda_id = v_v8;
    delete from public.fidelidade_acumulos where cliente_id = v_cli and bucket_id = v_m5;

    v_ret := public.aplicar_fidelidade_venda(v_v8);
    if coalesce((v_ret->>'selos_ganhos')::int, -1) <> 0 then
      raise exception 'T10a FALHOU: venda legada gerou % selo(s) a mais (NULL vira -1), esperado 0', coalesce((v_ret->>'selos_ganhos')::int, -1);
    end if;
    select selos into v_depois from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if coalesce(v_depois, -1) <> coalesce(v_antes, -2) then
      raise exception 'T10b FALHOU: cartela foi de % para % (NULL vira -1) ao reprocessar venda legada', v_antes, coalesce(v_depois, -1);
    end if;
    select selos_gerados into v_ja from public.fidelidade_acumulos
     where cliente_id = v_cli and bucket_id = v_m5;
    if coalesce(v_ja, -1) <> 3 then
      raise exception 'T10c FALHOU: o balde legado ficou com selos_gerados = %, esperado 3', coalesce(v_ja, -1);
    end if;
  end;
  raise notice 'T10 OK — venda legada com cartela ja fechada nao e creditada de novo';

  -- ══ T11 — venda legada, caso PURO: TODOS os selos na cartela fechada
  --   e NENHUMA cartela aberta depois. Este e o unico cenario em que o indice
  --   unico (venda_id, cartela_id) nao protege NADA: sem cartela aberta, a 2a
  --   passagem CRIA uma e o par (venda, cartela nova) e inedito.
  --   O T10 nao cobre isto — la a venda tambem tem selo na cartela aberta, e o
  --   proprio indice ja barraria. Ou seja: T10 passa mesmo sem a correcao de
  --   venda legada; T11 e o que de fato a exercita.
  declare v_m6 uuid; v_v9 uuid; v_falta2 int; v_antes2 int; v_abertas int; begin
    insert into public.maletas (revendedora_id, status) values (v_rev, 'finalizada') returning id into v_m6;

    -- leva a cartela aberta a 9
    select coalesce(selos, 0) into v_antes2 from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    v_falta2 := 9 - coalesce(v_antes2, 0);
    if v_falta2 > 0 then
      insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                                 valor_total, valor_pago, status, cliente_id, maleta_id)
      values (v_rev, 'ZZ Teste', current_date, 'Pix', v_falta2 * 150, v_falta2 * 150, 'quitado', v_cli, v_m6);
    end if;

    -- R$150 exatos: 1 selo fecha a cartela e o laco sai SEM abrir a proxima
    insert into public.vendas (revendedora_id, nome_cliente, data_venda, forma_pagamento,
                               valor_total, valor_pago, status, cliente_id, maleta_id)
    values (v_rev, 'ZZ Teste', current_date, 'Pix', 150, 150, 'quitado', v_cli, v_m6)
    returning id into v_v9;

    select count(*) into v_abertas from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if v_abertas <> 0 then
      raise exception 'T11 PREPARO FALHOU: deveria ter 0 cartela aberta, tem %', v_abertas;
    end if;

    -- envelhece a venda (estado do dia do deploy)
    delete from public.fidelidade_acumulo_vendas where venda_id = v_v9;
    delete from public.fidelidade_acumulos where cliente_id = v_cli and bucket_id = v_m6;

    v_ret := public.aplicar_fidelidade_venda(v_v9);
    if coalesce((v_ret->>'selos_ganhos')::int, -1) <> 0 then
      raise exception 'T11a FALHOU: venda legada (cartela fechada, sem aberta) gerou % selo(s), esperado 0',
        coalesce((v_ret->>'selos_ganhos')::int, -1);
    end if;
    select count(*) into v_abertas from public.fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if v_abertas <> 0 then
      raise exception 'T11b FALHOU: reprocessar a venda legada ABRIU uma cartela nova (% aberta(s))', v_abertas;
    end if;
  end;
  raise notice 'T11 OK — venda legada sem cartela aberta nao recredita (caso puro)';

  raise notice '';
  raise notice '════════ TODOS OS TESTES PASSARAM ════════';
end $$;

rollback;
