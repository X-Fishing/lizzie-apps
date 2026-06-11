-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Funções RPC (Postgres)
-- ════════════════════════════════════════════════════════════════════
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo → Run.
-- Idempotente (create or replace). Aplique ANTES de publicar a versão do
-- index.html que chama sb.rpc('registrar_venda', ...), senão registrar
-- venda vai falhar.
-- ════════════════════════════════════════════════════════════════════

-- registrar_venda: cria a venda, os itens, o recebimento (se houver) e
-- incrementa quantidade_vendida — tudo numa única transação. Resolve:
--   (a) venda órfã sem itens (se algo falha, ROLLBACK de tudo);
--   (b) race condition no quantidade_vendida (incremento atômico no banco,
--       sem read-modify-write a partir de cache do navegador).
-- SECURITY INVOKER: roda com as permissões do usuário logado, respeitando
-- as policies de RLS (revendedora só mexe nas próprias linhas).
create or replace function public.registrar_venda(
  p_cliente text,
  p_data    date,
  p_forma   text,
  p_total   numeric,
  p_pago    numeric,
  p_status  text,
  p_obs     text,
  p_itens   jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_item     jsonb;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao
  ) values (
    auth.uid(), p_cliente, p_data, p_forma,
    p_total, p_pago, p_status, p_obs
  )
  returning id into v_venda_id;

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

  if coalesce(p_pago, 0) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, p_pago, p_data);
  end if;

  return v_venda_id;
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- handle_new_user: cria o profile automaticamente quando um usuario se
-- cadastra (after insert on auth.users). Resolve o caso em que a confirmacao
-- de e-mail esta ativa: nao ha sessao apos signUp, o insert client-side
-- falharia por RLS e a usuaria ficaria sem profile (preso no splash).
-- SECURITY DEFINER: roda com privilegios do dono, ignorando RLS.
-- Le nome/telefone/cidade de raw_user_meta_data (enviados em options.data).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, nome, telefone, cidade, aprovada)
  values (
    new.id,
    'revendedora',
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'cidade',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
