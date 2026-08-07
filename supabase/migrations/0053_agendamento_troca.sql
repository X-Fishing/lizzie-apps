-- ════════════════════════════════════════════════════════════════════
-- 0053 — Agendamento da troca de mostruário: horário + pedido de remarcação.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x sem erro.
--
-- PROBLEMA: a troca só tinha DATA (maletas.data_troca, 0050) e vivia só no
-- desk — a revendedora nunca via quando seria. Quando precisava mudar, virava
-- conversa solta no WhatsApp, sem registro de quem pediu, quando e se foi
-- aceito. A revendedora também não pode escrever em `maletas`
-- (maletas_update exige is_gestor), então não há como ela "remarcar" sozinha.
--
-- SOLUÇÃO:
--   1) maletas.hora_troca — o horário combinado, ao lado da data.
--   2) solicitacoes_troca — a revendedora PEDE uma nova data/hora pelo app
--      (ela só insere, nunca altera a maleta) e a staff aprova/recusa no desk.
--      Aprovar é o único caminho que grava a nova data/hora na maleta.
--
-- REGRAS: uma solicitação PENDENTE por maleta (índice único parcial). A
-- aprovação é atômica e feita por RPC security definer — o UPDATE em `maletas`
-- exige is_gestor(), e queremos maleta+solicitação mudando juntas ou nenhuma.
-- ════════════════════════════════════════════════════════════════════

-- ── A) Horário da troca ─────────────────────────────────────────────
alter table public.maletas
  add column if not exists hora_troca time;

comment on column public.maletas.hora_troca is
  'Horario combinado da troca. Opcional (a data pode existir sem hora marcada). Definido no desk (lancador) ou por aprovacao de solicitacao_troca.';

-- ── B) Solicitações de remarcação ───────────────────────────────────
create table if not exists public.solicitacoes_troca (
  id               uuid primary key default gen_random_uuid(),
  maleta_id        uuid not null references public.maletas(id)  on delete cascade,
  revendedora_id   uuid not null references public.profiles(id) on delete cascade,
  -- snapshot do que estava combinado quando ela pediu (o desk pode ter mudado
  -- depois; sem isto a staff não sabe de onde para onde foi o pedido).
  data_atual       date,
  hora_atual       time,
  data_solicitada  date not null,
  hora_solicitada  time,
  motivo           text,
  status           text not null default 'pendente'
                     check (status in ('pendente','aprovada','recusada')),
  resposta         text,
  resolvida_em     timestamptz,
  resolvida_por    uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);

-- Uma pendente por maleta: senão a revendedora empilha pedidos e a staff não
-- sabe qual vale. Pedir de novo = cancelar/substituir o anterior no app.
create unique index if not exists solicitacoes_troca_uma_pendente
  on public.solicitacoes_troca (maleta_id) where (status = 'pendente');
create index if not exists solicitacoes_troca_rev_idx
  on public.solicitacoes_troca (revendedora_id, created_at desc);
create index if not exists solicitacoes_troca_pendentes_idx
  on public.solicitacoes_troca (created_at) where (status = 'pendente');

-- ── C) RLS ──────────────────────────────────────────────────────────
-- A revendedora cria e lê as PRÓPRIAS solicitações; só a staff resolve.
alter table public.solicitacoes_troca enable row level security;
drop policy if exists sol_troca_select_own    on public.solicitacoes_troca;
drop policy if exists sol_troca_select_staff  on public.solicitacoes_troca;
drop policy if exists sol_troca_insert_own    on public.solicitacoes_troca;
drop policy if exists sol_troca_delete_own    on public.solicitacoes_troca;
drop policy if exists sol_troca_update_gestor on public.solicitacoes_troca;

create policy sol_troca_select_own on public.solicitacoes_troca
  for select to authenticated using ( revendedora_id = auth.uid() );
create policy sol_troca_select_staff on public.solicitacoes_troca
  for select to authenticated using ( public.is_staff() );

-- Só pode pedir para a PRÓPRIA maleta (senão bastava forjar o maleta_id).
create policy sol_troca_insert_own on public.solicitacoes_troca
  for insert to authenticated
  with check (
    revendedora_id = auth.uid()
    and status = 'pendente'
    and exists (select 1 from public.maletas m
                 where m.id = maleta_id and m.revendedora_id = auth.uid())
  );

-- Ela pode CANCELAR o próprio pedido enquanto ninguém respondeu.
create policy sol_troca_delete_own on public.solicitacoes_troca
  for delete to authenticated
  using ( revendedora_id = auth.uid() and status = 'pendente' );

create policy sol_troca_update_gestor on public.solicitacoes_troca
  for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

-- ── D) Resolver a solicitação (aprovar/recusar) ─────────────────────
-- SECURITY DEFINER: aprovar precisa gravar em `maletas`, cujo update exige
-- is_gestor(). Fazemos a checagem de permissão explicitamente aqui dentro e
-- mudamos maleta + solicitação na MESMA transação.
-- O filtro `status = 'pendente'` no update é a trava contra corrida (duas
-- funcionárias aprovando o mesmo pedido ao mesmo tempo) — mesmo padrão do
-- resgate de prêmio de fidelidade (fidelidade.js).
create or replace function public.resolver_solicitacao_troca(
  p_id       uuid,
  p_aprovar  boolean,
  p_resposta text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sol solicitacoes_troca;
begin
  if not public.is_gestor() then
    raise exception 'Sem permissao para resolver solicitacao de troca';
  end if;

  update solicitacoes_troca
     set status        = case when p_aprovar then 'aprovada' else 'recusada' end,
         resposta      = p_resposta,
         resolvida_em  = now(),
         resolvida_por = auth.uid()
   where id = p_id and status = 'pendente'
  returning * into v_sol;

  if v_sol.id is null then
    raise exception 'Solicitacao nao encontrada ou ja resolvida';
  end if;

  -- Só a aprovação mexe na agenda.
  if p_aprovar then
    update maletas
       set data_troca = v_sol.data_solicitada,
           hora_troca = v_sol.hora_solicitada
     where id = v_sol.maleta_id;
  end if;

  return jsonb_build_object(
    'id', v_sol.id, 'status', v_sol.status,
    'maleta_id', v_sol.maleta_id,
    'data_troca', v_sol.data_solicitada, 'hora_troca', v_sol.hora_solicitada
  );
end;
$$;

revoke all on function public.resolver_solicitacao_troca(uuid, boolean, text) from public;
grant execute on function public.resolver_solicitacao_troca(uuid, boolean, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
