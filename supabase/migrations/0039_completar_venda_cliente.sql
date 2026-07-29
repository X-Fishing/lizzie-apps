-- ═══════════════════════════════════════════════════════════════════
-- 0039 — Completar os dados da cliente numa venda ANTIGA (retroativo).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
-- Rodar DEPOIS da 0038 (usa tel_br_valido/tel_normalizado).
--
-- CASO DE USO: a revendedora lançou vendas antes das melhorias de garantia/
-- fidelidade e não cadastrou a cliente. Ela precisa completar o WhatsApp/nome
-- para gerar a garantia e creditar os selos — SEM poder mexer em valores,
-- peças ou datas da venda fechada.
--
-- O QUE ENTRA:
--  1) profiles.pode_completar_vendas (libera UMA revendedora) + BLINDAGEM:
--     sem ela, qualquer revendedora se auto-concede a permissão via REST
--     (profiles_update_own só congelava role/aprovada/is_revendedora).
--  2) Auditoria em vendas (padrão do projeto: colunas <verbo>_em/_por).
--  3) aplicar_fidelidade_venda(uuid): a lógica de selos EXTRAÍDA do trigger,
--     para trigger e RPC compartilharem — com guarda de idempotência REAL.
--  4) completar_venda_cliente(...): valida permissão e telefone no SERVIDOR.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Coluna de permissão ───────────────────────────────────────────
alter table public.profiles
  add column if not exists pode_completar_vendas boolean not null default false;

-- ── 2) Guard MESCLADO ────────────────────────────────────────────────
--   A 0012 honrava o selo app.allow_role_change mas não protegia
--   is_revendedora; o RLS-policies.sql protegia is_revendedora mas ignorava
--   o selo (e assim fn_vincular_funcionario não conseguia promover ninguém).
--   Esta versão faz as duas coisas + protege a flag nova.
--   ⚠ O MESMO texto está em RLS-policies.sql — mantenha os dois iguais.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- role: admin OU selo de transação (0012 — fn_vincular_funcionario)
  if new.role is distinct from old.role
     and not public.is_admin()
     and current_setting('app.allow_role_change', true) is distinct from 'on' then
    raise exception 'Apenas admin pode alterar o nivel de acesso';
  end if;
  -- Flags de PODER: só admin, sem exceção. profiles_update_staff deixa
  -- qualquer staff dar update na linha, e profiles_update_own deixa a dona.
  if (new.is_revendedora        is distinct from old.is_revendedora
   or new.pode_completar_vendas is distinct from old.pode_completar_vendas)
     and not public.is_admin() then
    raise exception 'Apenas admin altera a flag de revendedora ou a permissao de completar vendas';
  end if;
  return new;
end; $$;

drop trigger if exists guard_profile_role_trg on public.profiles;
create trigger guard_profile_role_trg before update on public.profiles
  for each row execute function public.guard_profile_role();

-- Cinto e suspensório na policy da própria dona.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role                  = (select role                  from public.profiles where id = auth.uid())
    and aprovada              = (select aprovada              from public.profiles where id = auth.uid())
    and is_revendedora        = (select is_revendedora        from public.profiles where id = auth.uid())
    and pode_completar_vendas = (select pode_completar_vendas from public.profiles where id = auth.uid())
  );

-- ── 3) Auditoria na venda ────────────────────────────────────────────
alter table public.vendas
  add column if not exists atualizado_por     uuid,
  add column if not exists atualizado_em      timestamptz,
  add column if not exists atualizacao_motivo text;

-- ── 4) Permissão de AÇÃO no servidor (espelha o podeVer do menu.js) ──
create or replace function public.fn_tem_acao(p_chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.fn_is_admin() or exists (
    select 1 from public.funcionarios f
      join public.perfil_permissoes pp on pp.perfil_id = f.perfil_id
     where f.auth_user_id = auth.uid() and f.ativo = true
       and pp.chave_menu = p_chave);
$$;
revoke all on function public.fn_tem_acao(text) from public, anon;
grant  execute on function public.fn_tem_acao(text) to authenticated;

-- Admin recebe a chave nova no pacote fixo (lista atualizada vs. 0014).
create or replace function public.fn_minhas_permissoes()
returns table(chave_menu text) language sql stable security definer set search_path = public as $$
  select pp.chave_menu from public.funcionarios f
    join public.perfil_permissoes pp on pp.perfil_id = f.perfil_id
    where f.auth_user_id = auth.uid() and f.ativo = true
  union
  select unnest(array[
    'dashboard','vendas_controle','vendas_produtos','vendas_entrada_mercadoria',
    'vendas_lancar','vendas_troca',
    'financeiro','financeiro_contas_pagar','calculadora','marketing',
    'marketing_fidelidade','marketing_bonus',
    'cad_categorias','cad_colecoes','cad_fornecedores','cad_clientes',
    'cad_revendedoras','cad_garantias','cad_funcionarios','cad_perfis',
    'cad_formas_pagamento','cad_categorias_fin','cad_faixas_comissao',
    'cad_precificacao','cad_raspadinha',
    'acao_editar_maleta_finalizada','acao_estornar_recebimento',
    'acao_completar_venda_antiga'])
  where public.fn_is_admin();
$$;
revoke all on function public.fn_minhas_permissoes() from public;
grant  execute on function public.fn_minhas_permissoes() to authenticated;

-- ── 5) LÓGICA DE SELOS EXTRAÍDA (trigger e RPC compartilham) ─────────
--   Corpo da 0030, com 3 diferenças:
--     (a) lê a venda por id em vez de NEW;
--     (b) GUARDA DE IDEMPOTÊNCIA REAL no topo. O índice (venda_id, cartela_id)
--         sozinho NÃO basta: se a cartela original já fechou, uma 2ª chamada
--         cairia numa cartela NOVA e creditaria os selos de novo;
--     (c) NÃO engole erro — numa correção manual o erro precisa estourar e
--         dar rollback (quem engole é o wrapper do trigger).
create or replace function public.aplicar_fidelidade_venda(p_venda_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  EXCEDENTE_ACUMULA constant boolean := true;
  SELOS_POR_CARTELA constant int     := 10;
  VALOR_POR_SELO    constant numeric := 150;
  v_venda    record;
  v_restante int; v_cartela uuid; v_selos int; v_aplicados int; v_total int;
  v_ganhos   int := 0; v_completou boolean := false;
begin
  select id, cliente_id, revendedora_id, valor_total
    into v_venda from vendas where id = p_venda_id;
  if not found or v_venda.cliente_id is null then
    return jsonb_build_object('selos_ganhos', 0);
  end if;

  if exists (select 1 from fidelidade_selos where venda_id = p_venda_id) then
    return jsonb_build_object('selos_ganhos', 0, 'ja_aplicada', true);
  end if;

  v_restante := floor(coalesce(v_venda.valor_total, 0) / VALOR_POR_SELO)::int;
  if v_restante <= 0 then return jsonb_build_object('selos_ganhos', 0); end if;

  -- Serializa contra vendas simultâneas E contra o ajuste manual (0040).
  perform pg_advisory_xact_lock(hashtextextended(v_venda.cliente_id::text, 0));

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
      exit when not EXCEDENTE_ACUMULA;
      exit when v_restante <= 0;
      insert into fidelidade_cartelas (cliente_id, selos) values (v_venda.cliente_id, 0)
        on conflict (cliente_id) where (status = 'aberta') do nothing;
    else
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'selos_ganhos',    v_ganhos,
    'completou',       v_completou,
    'cartela_selos',   (select selos from fidelidade_cartelas
                         where cliente_id = v_venda.cliente_id and status = 'aberta'),
    'premio_pendente', exists (select 1 from fidelidade_premios p
                         where p.cliente_id = v_venda.cliente_id and p.status = 'pendente'));
end; $$;
-- Sem grant: só o trigger e a RPC (ambos SECURITY DEFINER) chamam.
revoke all on function public.aplicar_fidelidade_venda(uuid) from public, anon, authenticated;

-- Trigger vira wrapper fino, preservando "fidelidade NUNCA derruba a venda".
create or replace function public.aplicar_fidelidade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.aplicar_fidelidade_venda(new.id);
  return new;
exception when others then
  raise warning 'aplicar_fidelidade falhou (venda %): %', new.id, sqlerrm;
  return new;
end; $$;

drop trigger if exists aplicar_fidelidade_trg on public.vendas;
create trigger aplicar_fidelidade_trg after insert on public.vendas
  for each row execute function public.aplicar_fidelidade();

-- ── 6) A RPC ─────────────────────────────────────────────────────────
create or replace function public.completar_venda_cliente(
  p_venda_id uuid, p_nome text, p_tel text,
  p_nasc date default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_venda record; v_cliente_id uuid; v_pode boolean; v_cel text; v_fid jsonb;
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

  -- Só vendas SEM cliente. Repontar uma venda já vinculada seria desmembrar
  -- cadastro (fora de escopo) e exigiria mover selos de cartela.
  if v_venda.cliente_id is not null then
    raise exception 'Esta venda ja esta vinculada a uma cliente — fale com a administracao';
  end if;

  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome da cliente';
  end if;
  v_cel := public.tel_normalizado(p_tel);
  if not public.tel_br_valido(v_cel) then
    raise exception 'Telefone invalido — informe um numero real com DDD';
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_nome, v_cel, p_nasc);
  if v_cliente_id is null then
    raise exception 'Nao foi possivel registrar a cliente';
  end if;

  -- APENAS estas colunas. Valores, peças, datas e status NUNCA mudam aqui.
  update vendas
     set nome_cliente       = btrim(p_nome),
         telefone_cliente   = v_cel,
         nascimento_cliente = coalesce(p_nasc, nascimento_cliente),
         cliente_id         = v_cliente_id,
         atualizado_por     = auth.uid(),
         atualizado_em      = now(),
         atualizacao_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = p_venda_id;

  -- Selos retroativos: automáticos e em silêncio (decisão do dono). Erro aqui
  -- NÃO é engolido: dá rollback em tudo, não fica meio-feito.
  v_fid := public.aplicar_fidelidade_venda(p_venda_id);

  return jsonb_build_object('cliente_id', v_cliente_id, 'fidelidade', v_fid);
end; $$;
revoke all on function public.completar_venda_cliente(uuid,text,text,date,text) from public, anon;
grant  execute on function public.completar_venda_cliente(uuid,text,text,date,text) to authenticated;
