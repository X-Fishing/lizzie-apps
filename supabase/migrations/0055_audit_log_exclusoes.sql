-- ═══════════════════════════════════════════════════════════════════
-- 0055 — Log de auditoria automático para EXCLUSÕES. COMO APLICAR:
-- Supabase → SQL Editor → cole tudo → Run. Depois:
-- select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x sem erro.
--
-- CONTEXTO: em 12/08/2026 a maleta/vendas da revendedora Stéfanny Passos
-- apareceram zeradas sem explicação recuperável — um hard delete não deixa
-- rastro nas tabelas vivas, só nos logs (que têm retenção curta). Isso não
-- pode se repetir sem deixar prova.
--
-- SOLUÇÃO: gatilho genérico em AFTER DELETE nas tabelas sensíveis. Grava
-- quem (auth.uid()), quando, tabela e o dado INTEIRO da linha apagada
-- (to_jsonb(OLD)) — funciona mesmo que o delete tenha vindo de um botão do
-- app OU de um DELETE manual rodado direto no SQL Editor por um admin.
-- ═══════════════════════════════════════════════════════════════════

-- ── A) Tabela (imutável: sem policy de update/delete pra ninguém) ────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  acao        text not null,
  tabela      text not null,
  registro_id text,
  dados       jsonb not null,
  ator_id     uuid,
  ator_nome   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_tabela on public.audit_log(tabela, created_at desc);
create index if not exists idx_audit_log_ator on public.audit_log(ator_id);

-- ── B) Gatilho genérico (SECURITY DEFINER: quem apaga não precisa ter
--        permissão de insert em audit_log — só o próprio gatilho grava) ─
create or replace function public.fn_audit_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  -- Duas buscas independentes (não um join): revendedora está em profiles,
  -- staff está em funcionarios — a pessoa só existe numa das duas.
  select coalesce(
    (select nome from public.profiles where id = auth.uid()),
    (select nome from public.funcionarios where auth_user_id = auth.uid())
  ) into v_nome;

  -- to_jsonb(OLD)->>'id' (em vez de OLD.id direto): se algum dia uma tabela
  -- anexada aqui não tiver coluna "id", isso vira NULL em vez de quebrar o
  -- DELETE inteiro com "record has no field id".
  insert into public.audit_log (acao, tabela, registro_id, dados, ator_id, ator_nome)
  values ('delete', TG_TABLE_NAME, to_jsonb(OLD)->>'id', to_jsonb(OLD), auth.uid(), v_nome);

  return OLD;
end;
$$;

-- ── C) Anexa o gatilho nas tabelas sensíveis ──────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'maletas','consignados','vendas','venda_itens','venda_pagamentos',
    'recebimentos','produtos','clientes','financeiro_lancamentos',
    'fidelidade_selos','fidelidade_cartelas','fidelidade_premios'
  ]
  loop
    execute format('drop trigger if exists trg_audit_delete on public.%I', t);
    execute format(
      'create trigger trg_audit_delete after delete on public.%I
       for each row execute function public.fn_audit_log_delete()', t);
  end loop;
end $$;

-- ── D) RLS — só admin lê; ninguém escreve direto (só o trigger, via
--        security definer, que ignora RLS) ──────────────────────────
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ( public.is_admin() );
revoke all on public.audit_log from public;
grant select on public.audit_log to authenticated;

select pg_notify('pgrst', 'reload schema');

-- ── TESTE MANUAL (rodar à mão depois, não faz parte da migration) ────
-- delete from public.produtos where id = '<algum id de teste>';
-- select * from public.audit_log order by created_at desc limit 1;
-- (deve aparecer a linha inteira apagada em `dados`, com seu nome em ator_nome)
