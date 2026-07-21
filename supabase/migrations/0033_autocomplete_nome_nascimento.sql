-- ═══════════════════════════════════════════════════════════════════
-- 0033 — Autocomplete: traz o nascimento junto e atualiza o nome ao salvar.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- Ajustes pedidos no teste:
--  (1) buscar_cliente_por_telefone passa a devolver a DATA DE NASCIMENTO
--      (o PDV preenche o aniversário sozinho).
--  (2) cliente_upsert_para_venda passa a ATUALIZAR o nome da cliente existente
--      (antes mantinha o nome antigo — por isso vinha só o primeiro nome).
-- ═══════════════════════════════════════════════════════════════════

-- (1) RPC do autocomplete: + coluna nascimento. Muda o "returns table" → drop antes.
drop function if exists public.buscar_cliente_por_telefone(text);
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, nascimento date, selos integer)
language sql stable security definer set search_path = public as $$
  with alvo as (
    select case
      when length(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')) in (12,13)
           and left(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), 2) = '55'
        then substr(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), 3)
      else regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')
    end as cel
  )
  select c.id, c.nome, c.data_nascimento, coalesce(f.selos, 0)
  from alvo a
  join public.clientes c on c.celular = a.cel
  left join public.fidelidade_cartelas f
    on f.cliente_id = c.id and f.status = 'aberta'
  where length(a.cel) >= 10
  limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public;
grant execute on function public.buscar_cliente_por_telefone(text) to authenticated;

-- (2) Upsert: o nome/nascimento digitados na venda passam a valer (o telefone
--     continua sendo a chave — nunca cria cliente nova por nome diferente).
create or replace function public.cliente_upsert_para_venda(
  p_nome text, p_celular text, p_nasc date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cel text; v_id uuid;
begin
  v_cel := regexp_replace(coalesce(p_celular,''), '\D', '', 'g');
  if length(v_cel) in (12,13) and left(v_cel,2) = '55' then v_cel := substr(v_cel,3); end if;
  if length(v_cel) < 10 or coalesce(trim(p_nome),'') = '' then return null; end if;
  insert into clientes (nome, celular, data_nascimento, criado_por)
  values (trim(p_nome), v_cel, p_nasc, auth.uid())
  on conflict (celular) do update
    set nome = excluded.nome,
        data_nascimento = coalesce(excluded.data_nascimento, clientes.data_nascimento)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.cliente_upsert_para_venda(text,text,date) from public;
grant execute on function public.cliente_upsert_para_venda(text,text,date) to authenticated;
