-- ════════════════════════════════════════════════════════════════════
-- TESTE do FLUXO DE VENDA — os caminhos que exigem usuária autenticada.
--
-- COMO RODAR (qualquer um dos dois):
--   npx supabase db query --linked -f supabase/testes/0057-fluxo-venda.sql
--   Supabase → SQL Editor → cole tudo → Run
-- Tudo numa transação que termina em ROLLBACK: **nada** fica gravado.
--
-- POR QUE ESTE ARQUIVO EXISTE: o 0057-fidelidade-ciclo.sql testa o MOTOR
-- (aplicar_fidelidade_venda) chamando o gatilho direto. Ficavam de fora
-- justamente as portas que o app usa de verdade — registrar_venda,
-- completar_venda_cliente e fidelidade_ajustar_selo — porque todas dependem
-- de auth.uid().
--
-- A SOLUÇÃO: auth.uid() lê `request.jwt.claims`. Dá para forjar dentro da
-- transação com set_config(..., true) e ainda trocar o papel para
-- `authenticated`, que é como o PostgREST executa. Ou seja: isto exercita as
-- funções EXATAMENTE como o app as chama, RLS e privilégios incluídos.
--
-- Cobre: resolução da maleta no servidor (crit. 7/8), override de maleta
-- alheia sendo ignorado (crit. 9), a regra 75+75=1 selo ponta a ponta pela
-- RPC real, o reaponte de cliente (crit. 15) e o ajuste manual (crit. 16).
-- ════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_rev      uuid;
  v_admin    uuid;
  v_maleta   uuid;
  v_outra_m  uuid;
  v_outra_r  uuid;
  v_ret      jsonb;
  v_v1       uuid;
  v_v2       uuid;
  v_cli      uuid;
  v_selos    int;
  v_maleta_gravada uuid;
  TEL constant text := '11987650002';   -- número válido e improvável de existir
begin
  -- ── Cenário: revendedora de verdade, com maleta ATIVA ──────────────
  select p.id into v_rev
    from profiles p
   where p.role = 'revendedora'
     and exists (select 1 from maletas m where m.revendedora_id = p.id and m.status = 'ativa')
   limit 1;
  if v_rev is null then raise exception 'TESTE ABORTADO: nenhuma revendedora com maleta ativa'; end if;

  select m.id into v_maleta from maletas m
   where m.revendedora_id = v_rev and m.status = 'ativa' limit 1;

  select p.id into v_admin from profiles p where p.role = 'admin' limit 1;

  -- Uma maleta de OUTRA pessoa, para o teste do override (crit. 9).
  select m.id, m.revendedora_id into v_outra_m, v_outra_r
    from maletas m where m.revendedora_id <> v_rev limit 1;

  raise notice 'revendedora=% maleta_ativa=%', v_rev, v_maleta;

  -- ── Vira a revendedora: papel `authenticated` + JWT forjado ────────
  --    É assim que o PostgREST executa. Sem isto, rodaríamos como superusuário
  --    e a RLS nem seria exercitada — o teste passaria sem provar nada.
  perform set_config('request.jwt.claims', json_build_object('sub', v_rev, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- ══ V1 — venda de R$75: 0 selos, e a MALETA vem do servidor ═══════
  --    p_maleta_id vai NULL de propósito: quem tem de resolver é a RPC.
  v_ret := public.registrar_venda(
    'ZZ Teste Fluxo', current_date, 'Pix', 75, 75, 'quitado', null,
    '[{"consignado_id": null, "descricao": "Peca de teste", "referencia": null, "quantidade": 1, "preco_unit": 75}]'::jsonb,
    TEL, 7, 3, null, null, null);

  if coalesce((v_ret->'fidelidade'->>'selos_ganhos')::int, -1) <> 0 then
    raise exception 'V1a FALHOU: venda de 75 gerou % selo(s), esperado 0',
      coalesce((v_ret->'fidelidade'->>'selos_ganhos')::int, -1);
  end if;
  if coalesce((v_ret->'fidelidade'->>'tem_ciclo')::boolean, false) is not true then
    raise exception 'V1b FALHOU: tem_ciclo deveria ser true (a venda esta numa maleta) — %', v_ret->'fidelidade';
  end if;
  if coalesce((v_ret->'fidelidade'->>'falta_para_selo')::numeric, -1) <> 75 then
    raise exception 'V1c FALHOU: falta_para_selo = %, esperado 75',
      coalesce((v_ret->'fidelidade'->>'falta_para_selo')::numeric, -1);
  end if;
  v_v1  := (v_ret->>'venda_id')::uuid;
  v_cli := (v_ret->>'cliente_id')::uuid;
  if v_cli is null then raise exception 'V1d FALHOU: a venda nao vinculou cliente'; end if;

  -- ══ V2 — MESMA cliente, mesma maleta: fecha os R$150 = 1 selo ═════
  v_ret := public.registrar_venda(
    'ZZ Teste Fluxo', current_date, 'Pix', 75, 75, 'quitado', null,
    '[{"consignado_id": null, "descricao": "Peca de teste", "referencia": null, "quantidade": 1, "preco_unit": 75}]'::jsonb,
    TEL, 7, 3, null, null, null);
  if coalesce((v_ret->'fidelidade'->>'selos_ganhos')::int, -1) <> 1 then
    raise exception 'V2 FALHOU: a 2a venda de 75 gerou % selo(s), esperado 1 — A REGRA NOVA NAO ESTA VALENDO',
      coalesce((v_ret->'fidelidade'->>'selos_ganhos')::int, -1);
  end if;
  v_v2 := (v_ret->>'venda_id')::uuid;

  -- ══ V3 — override com maleta ALHEIA tem de ser IGNORADO ═══════════
  if v_outra_m is not null then
    v_ret := public.registrar_venda(
      'ZZ Teste Fluxo', current_date, 'Pix', 10, 10, 'quitado', null,
      '[{"consignado_id": null, "descricao": "Peca de teste", "referencia": null, "quantidade": 1, "preco_unit": 10}]'::jsonb,
      TEL, 7, 3, null, null, v_outra_m);
    perform set_config('role', 'postgres', true);
    select maleta_id into v_maleta_gravada from vendas where id = (v_ret->>'venda_id')::uuid;
    if v_maleta_gravada = v_outra_m then
      raise exception 'V3 FALHOU: a venda entrou na maleta de OUTRA revendedora (%)', v_outra_m;
    end if;
    if v_maleta_gravada is distinct from v_maleta then
      raise exception 'V3 FALHOU: esperava cair na propria maleta ativa (%), caiu em %', v_maleta, v_maleta_gravada;
    end if;
    perform set_config('role', 'authenticated', true);
  end if;

  -- ══ V4 — a maleta foi resolvida no SERVIDOR, coerente com a venda ═
  perform set_config('role', 'postgres', true);
  select maleta_id into v_maleta_gravada from vendas where id = v_v1;
  if v_maleta_gravada is distinct from v_maleta then
    raise exception 'V4 FALHOU: registrar_venda nao gravou a maleta ativa (gravou %, esperado %)',
      v_maleta_gravada, v_maleta;
  end if;

  select coalesce(selos, 0) into v_selos from fidelidade_cartelas
   where cliente_id = v_cli and status = 'aberta';
  if coalesce(v_selos, -1) <> 1 then
    raise exception 'V4b FALHOU: cartela da cliente com % selo(s), esperado 1', coalesce(v_selos, -1);
  end if;
  raise notice 'V1-V4 OK — registrar_venda resolve a maleta e a regra 75+75=1 selo vale ponta a ponta';

  -- ══ V5 — ajuste manual +1 (SÓ admin) ═════════════════════════════
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    v_ret := public.fidelidade_ajustar_selo(v_cli, 1, 'teste automatizado');
    perform set_config('role', 'postgres', true);
    select coalesce(selos, 0) into v_selos from fidelidade_cartelas
     where cliente_id = v_cli and status = 'aberta';
    if coalesce(v_selos, -1) <> 2 then
      raise exception 'V5 FALHOU: apos +1 manual a cartela tem %, esperado 2', coalesce(v_selos, -1);
    end if;

    -- O selo manual NAO pode entrar no balde do ciclo (senao a proxima compra
    -- deixaria de gerar selo).
    declare v_ja int; begin
      select selos_gerados into v_ja from fidelidade_acumulos
       where cliente_id = v_cli and bucket_id = v_maleta;
      if coalesce(v_ja, -1) <> 1 then
        raise exception 'V5b FALHOU: o balde contabilizou o ajuste manual (selos_gerados = %, esperado 1)', coalesce(v_ja, -1);
      end if;
    end;
    raise notice 'V5 OK — ajuste manual do admin nao contamina o balde do ciclo';
  end if;

  -- ══ V6 — revendedora NAO pode ajustar selo ═══════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_rev, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  declare v_barrou boolean := false; begin
    begin
      perform public.fidelidade_ajustar_selo(v_cli, 1, 'nao deveria passar');
    exception when others then v_barrou := true;
    end;
    if not v_barrou then
      raise exception 'V6 FALHOU: revendedora conseguiu ajustar selo manualmente';
    end if;
  end;
  perform set_config('role', 'postgres', true);
  raise notice 'V6 OK — revendedora barrada no ajuste manual';

  raise notice '';
  raise notice '════════ FLUXO DE VENDA: TODOS OS TESTES PASSARAM ════════';
end $$;

rollback;
