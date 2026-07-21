-- ═══════════════════════════════════════════════════════════════════
-- 0031 — Autocomplete da cliente pelo telefone no PDV (finalizar venda).
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- A RLS de clientes só deixa a revendedora ver quem ela já atendeu, mas o
-- autocomplete precisa achar também a cliente que comprou com OUTRA revendedora
-- (senão duplica cadastro). Por isso é uma RPC SECURITY DEFINER que só faz
-- match EXATO do telefone completo e devolve o mínimo (nome + selos). Quem não
-- souber o número inteiro não descobre nada e continua sem conseguir listar a base.
--
-- Chave = clientes.celular (dígitos, SEM DDI 55 — mesmo formato do cadastro).
-- A função normaliza o parâmetro (tira não-dígitos e o 55, se vier).
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, selos integer)
language sql stable security definer set search_path = public as $$
  with alvo as (
    select case
      when length(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')) in (12,13)
           and left(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), 2) = '55'
        then substr(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), 3)
      else regexp_replace(coalesce(p_telefone,''), '\D', '', 'g')
    end as cel
  )
  select c.id, c.nome, coalesce(f.selos, 0)
  from alvo a
  join public.clientes c on c.celular = a.cel
  left join public.fidelidade_cartelas f
    on f.cliente_id = c.id and f.status = 'aberta'
  where length(a.cel) >= 10
  limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public;
grant execute on function public.buscar_cliente_por_telefone(text) to authenticated;
