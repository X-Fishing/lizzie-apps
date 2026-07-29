-- ═══════════════════════════════════════════════════════════════════
-- 0041 — Fecha o vazamento do autocomplete e permite CORRIGIR a cliente
--        de uma venda que já está vinculada.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
-- Rodar DEPOIS da 0039.
--
-- 1) buscar_cliente_por_telefone ainda casava com telefone INVÁLIDO: quem
--    digitasse 00000000000 no PDV via "Cliente já cadastrada · 2/10 selos"
--    e tinha o nome da cliente-lixo preenchido sozinho — inclusive nome de
--    cliente de OUTRA revendedora (vazamento). Agora exige telefone válido.
--
-- 2) completar_venda_cliente recusava venda com cliente_id preenchido. Sem
--    isso não há como consertar as vendas já contaminadas (caso Patrícia:
--    5 pessoas num cadastro só). Agora ela REAPONTA a venda: apaga os selos
--    daquela venda (o trigger devolve à cartela antiga), revincula na
--    cliente certa e recredita. Continua sem tocar em valores/peças.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Autocomplete só acha telefone VÁLIDO ──────────────────────────
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, nascimento date, selos integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.data_nascimento, coalesce(f.selos, 0)
    from public.clientes c
    left join public.fidelidade_cartelas f
      on f.cliente_id = c.id and f.status = 'aberta'
   where public.tel_br_valido(p_telefone)          -- ← número falso não acha nada
     and c.celular = public.tel_normalizado(p_telefone)
   limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public, anon;
grant  execute on function public.buscar_cliente_por_telefone(text) to authenticated;

-- ── 2) completar_venda_cliente agora também CORRIGE (reaponta) ───────
create or replace function public.completar_venda_cliente(
  p_venda_id uuid, p_nome text, p_tel text,
  p_nasc date default null, p_motivo text default null
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

  v_cliente_id := public.cliente_upsert_para_venda(p_nome, v_cel, p_nasc);
  if v_cliente_id is null then
    raise exception 'Nao foi possivel registrar a cliente';
  end if;

  -- REAPONTAR: se a venda já estava em outra cliente, tira os selos dela
  -- antes. O trigger fidelidade_selo_removido devolve à cartela ABERTA de
  -- origem (cartela já completa não é desfeita — use o ajuste manual).
  v_antigo := v_venda.cliente_id;
  if v_antigo is not null and v_antigo <> v_cliente_id then
    delete from fidelidade_selos where venda_id = p_venda_id;
    v_realocou := true;
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

  -- Selos: automáticos e em silêncio. Erro NÃO é engolido (rollback).
  v_fid := public.aplicar_fidelidade_venda(p_venda_id);

  return jsonb_build_object(
    'cliente_id',      v_cliente_id,
    'realocou',        v_realocou,
    'cliente_anterior', v_antigo,
    'fidelidade',      v_fid);
end; $$;
revoke all on function public.completar_venda_cliente(uuid,text,text,date,text) from public, anon;
grant  execute on function public.completar_venda_cliente(uuid,text,text,date,text) to authenticated;
