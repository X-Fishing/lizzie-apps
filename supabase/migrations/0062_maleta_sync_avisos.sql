-- ═══════════════════════════════════════════════════════════════════
-- 0062 — Avisos persistentes de sincronização Bling→maleta. COMO
-- APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- CONTEXTO: itens "sumidos" da relação de uma revendedora (caso Leina,
-- ver diagnostico-leina-maleta.sql) podem ter passado por um destes dois
-- pontos silenciosos da sincronização Bling→app: item SEM CÓDIGO no
-- Bling (nunca sincronizado) ou SKU com "delta negativo" (Bling mostra
-- menos unidades do que a maleta já tem — vale conferir manualmente).
-- Hoje isso vira só um banner que some quando o admin fecha o modal —
-- mesmo problema de fundo do incidente da Stéfanny: aviso que ninguém
-- vê de novo. Esta tabela persiste até alguém marcar como resolvido.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.maleta_sync_avisos (
  id             uuid primary key default gen_random_uuid(),
  revendedora_id uuid not null references public.profiles(id) on delete cascade,
  pedido_numero  text,
  tipo           text not null check (tipo in ('sem_codigo','delta_negativo')),
  descricao      text,
  quantidade     numeric,
  resolvido      boolean not null default false,
  resolvido_em   timestamptz,
  resolvido_por  uuid,
  created_at     timestamptz not null default now()
);
create index if not exists maleta_sync_avisos_rev_idx
  on public.maleta_sync_avisos (revendedora_id) where resolvido = false;

-- Roda a sincronização de novo enquanto o mesmo problema persiste NÃO deve
-- empilhar avisos repetidos — índice único parcial (só entre os ainda não
-- resolvidos) usado como alvo do upsert em src/bling.js (confirmarMaleta).
create unique index if not exists maleta_sync_avisos_dedup_idx
  on public.maleta_sync_avisos (revendedora_id, pedido_numero, tipo, descricao)
  where resolvido = false;

alter table public.maleta_sync_avisos enable row level security;
drop policy if exists maleta_sync_avisos_select on public.maleta_sync_avisos;
drop policy if exists maleta_sync_avisos_insert on public.maleta_sync_avisos;
drop policy if exists maleta_sync_avisos_update on public.maleta_sync_avisos;
create policy maleta_sync_avisos_select on public.maleta_sync_avisos
  for select to authenticated using ( public.is_staff() );
create policy maleta_sync_avisos_insert on public.maleta_sync_avisos
  for insert to authenticated with check ( public.is_gestor() );
create policy maleta_sync_avisos_update on public.maleta_sync_avisos
  for update to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() );

select pg_notify('pgrst', 'reload schema');
