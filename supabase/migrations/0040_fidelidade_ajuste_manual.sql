-- ═══════════════════════════════════════════════════════════════════
-- 0040 — Ajuste manual de selos (+1/-1), só admin.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
-- Rodar DEPOIS da 0030 (índice (venda_id,cartela_id)).
--
-- POR QUE UMA RPC: fidelidade_cartelas e fidelidade_selos têm SÓ policy de
-- SELECT (0028:75-101). Nem o admin escreve pelo browser — update/delete
-- voltam "0 linhas" em SILÊNCIO. Toda escrita passa por SECURITY DEFINER.
-- E não existe trigger de INSERT em fidelidade_selos: quem insere selo TEM
-- de atualizar fidelidade_cartelas.selos na mão.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Selo pode ser MANUAL (sem venda) e NEGATIVO ───────────────────
alter table public.fidelidade_selos
  alter column venda_id drop not null;

alter table public.fidelidade_selos
  add column if not exists ajuste_manual    boolean not null default false,
  add column if not exists ajustado_por     uuid,
  add column if not exists ajuste_motivo    text,
  add column if not exists premio_cancelado boolean not null default false;

-- quantidade: continua >= 0 para selo de venda; negativo só em ajuste manual.
alter table public.fidelidade_selos drop constraint if exists fidelidade_selos_quantidade_check;
alter table public.fidelidade_selos drop constraint if exists fidelidade_selos_quantidade_chk;
alter table public.fidelidade_selos
  add constraint fidelidade_selos_quantidade_chk
  check (quantidade >= 0 or ajuste_manual);

-- venda_id só pode faltar em ajuste manual (mantém a rastreabilidade).
alter table public.fidelidade_selos drop constraint if exists fidelidade_selos_origem_chk;
alter table public.fidelidade_selos
  add constraint fidelidade_selos_origem_chk
  check (venda_id is not null or ajuste_manual);

create index if not exists idx_fid_selos_ajuste
  on public.fidelidade_selos (cliente_id) where ajuste_manual;

-- ── 2) A RPC ─────────────────────────────────────────────────────────
create or replace function public.fidelidade_ajustar_selo(
  p_cliente_id uuid, p_delta int, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  SELOS_POR_CARTELA constant int := 10;
  v_cartela uuid; v_selos int; v_aberta_vazia uuid;
  v_premio_id uuid; v_premio_status text; v_premio_em timestamptz;
  v_motivo text; v_completou boolean := false; v_reabriu boolean := false;
  v_cancelou boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador ajusta selos manualmente';
  end if;
  if p_delta is null or p_delta not in (1, -1) then
    raise exception 'Ajuste invalido: use +1 ou -1';
  end if;
  if not exists (select 1 from clientes where id = p_cliente_id) then
    raise exception 'Cliente nao encontrada';
  end if;
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  -- Serializa contra vendas simultâneas da MESMA cliente (mesmo lock da
  -- aplicar_fidelidade_venda, 0039).
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text, 0));

  if p_delta > 0 then
    -- ══ +1 ═══════════════════════════════════════════════════════════
    loop   -- get-or-create + lock (mesmo padrão da 0030)
      select id, selos into v_cartela, v_selos from fidelidade_cartelas
       where cliente_id = p_cliente_id and status = 'aberta' for update;
      exit when found;
      insert into fidelidade_cartelas (cliente_id) values (p_cliente_id)
        on conflict (cliente_id) where (status = 'aberta') do nothing;
    end loop;

    insert into fidelidade_selos (cartela_id, cliente_id, venda_id, revendedora_id,
                                  quantidade, excedente_descartado, valor_venda,
                                  ajuste_manual, ajustado_por, ajuste_motivo)
    values (v_cartela, p_cliente_id, null, null, 1, 0, null,
            true, auth.uid(), v_motivo);

    v_selos := v_selos + 1;   -- cartela aberta tem no máx. 9 ⇒ nunca passa de 10
    update fidelidade_cartelas
       set selos = v_selos,
           status = case when v_selos >= SELOS_POR_CARTELA then 'completa' else status end,
           completada_em = case when v_selos >= SELOS_POR_CARTELA then now() else completada_em end
     where id = v_cartela;

    if v_selos >= SELOS_POR_CARTELA then
      v_completou := true;
      insert into fidelidade_premios (cartela_id, cliente_id)
        values (v_cartela, p_cliente_id) on conflict (cartela_id) do nothing;
      -- Ajuste manual não tem EXCEDENTE ⇒ não abre cartela nova aqui.
    end if;

  else
    -- ══ -1 ═══════════════════════════════════════════════════════════
    -- Tira primeiro da cartela ABERTA; só volta na COMPLETA se a aberta
    -- não existir ou estiver zerada.
    select id, selos into v_cartela, v_selos from fidelidade_cartelas
     where cliente_id = p_cliente_id and status = 'aberta' for update;

    if found and v_selos > 0 then
      v_selos := v_selos - 1;
      update fidelidade_cartelas set selos = v_selos where id = v_cartela;
    else
      v_aberta_vazia := v_cartela;   -- pode ser null

      select id, selos into v_cartela, v_selos
        from fidelidade_cartelas
       where cliente_id = p_cliente_id and status = 'completa'
       order by coalesce(completada_em, created_at) desc
       limit 1 for update;
      if not found then
        raise exception 'Esta cliente nao tem selos para remover';
      end if;

      select id, status, resgatado_em into v_premio_id, v_premio_status, v_premio_em
        from fidelidade_premios where cartela_id = v_cartela;
      if v_premio_id is not null and v_premio_status = 'resgatado' then
        raise exception 'Nao da para remover: o premio desta cartela ja foi RESGATADO%',
          coalesce(' em ' || to_char(v_premio_em, 'DD/MM/YYYY'), '');
      end if;
      if v_premio_id is not null then
        -- Prêmio PENDENTE é APAGADO (não marcado como cancelado):
        -- fidelidade_premios.cartela_id é UNIQUE e o crédito usa
        -- "on conflict (cartela_id) do nothing" — uma linha cancelada
        -- impediria o prêmio de nascer de novo quando a cartela refechasse.
        -- A auditoria fica na linha de ajuste (premio_cancelado = true).
        delete from fidelidade_premios where id = v_premio_id;
        v_cancelou := true;
      end if;

      -- cartela_uma_aberta é índice único parcial: some com a aberta ZERADA
      -- antes de reabrir a completa.
      if v_aberta_vazia is not null then
        delete from fidelidade_cartelas c
         where c.id = v_aberta_vazia
           and not exists (select 1 from fidelidade_selos s where s.cartela_id = c.id);
        if not found then
          raise exception 'A cliente ja tem uma cartela em andamento com historico — nao da para reabrir a cartela completa';
        end if;
      end if;

      v_selos := greatest(0, v_selos - 1);
      update fidelidade_cartelas
         set selos = v_selos, status = 'aberta', completada_em = null
       where id = v_cartela;
      v_reabriu := true;
    end if;

    insert into fidelidade_selos (cartela_id, cliente_id, venda_id, revendedora_id,
                                  quantidade, excedente_descartado, valor_venda,
                                  ajuste_manual, ajustado_por, ajuste_motivo, premio_cancelado)
    values (v_cartela, p_cliente_id, null, null, -1, 0, null,
            true, auth.uid(), v_motivo, v_cancelou);
  end if;

  return jsonb_build_object(
    'cartela_selos',    v_selos,
    'completou',        v_completou,
    'reabriu_cartela',  v_reabriu,
    'premio_cancelado', v_cancelou);
end; $$;
revoke all on function public.fidelidade_ajustar_selo(uuid,int,text) from public, anon;
grant  execute on function public.fidelidade_ajustar_selo(uuid,int,text) to authenticated;

-- ── 3) fidelidade_status v2: o extrato marca o ajuste manual ─────────
--   Continua SECURITY INVOKER (a RLS 0028 faz o filtro por papel).
--   motivo/autor só para STAFF — anotação interna não vaza para a
--   revendedora (que enxerga o extrato das clientes dela).
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
