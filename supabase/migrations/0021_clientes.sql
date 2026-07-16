-- 0021 - Clientes finais (Fase 1 redesign)
-- Rodar no SQL Editor do Supabase (uma vez). Idempotente.
-- Chave de dedup = CELULAR (so digitos). LGPD: leitura/escrita so STAFF; delete gestor.

create table if not exists public.clientes (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  celular         text unique,
  email           text,
  cidade          text,
  data_nascimento date,
  observacao      text,
  criado_por      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_clientes_nome on public.clientes (lower(nome));

alter table public.clientes enable row level security;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated using ( public.is_staff() );
create policy clientes_insert on public.clientes
  for insert to authenticated with check ( public.is_staff() );
create policy clientes_update on public.clientes
  for update to authenticated using ( public.is_staff() ) with check ( public.is_staff() );
create policy clientes_delete on public.clientes
  for delete to authenticated using ( public.is_gestor() );
