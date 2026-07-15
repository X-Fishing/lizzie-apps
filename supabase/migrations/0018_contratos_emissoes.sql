-- ═══════════════════════════════════════════════════════════════════
-- 0018 — Emissões do contrato (checklist de conferência ao sair da tela)
-- Um registro por saída da tela do contrato: guarda o que foi conferido
-- (rubricas, assinaturas, vias) e se o processo ficou 'pendente' ou
-- 'concluida'. Reabrir e sair de novo cria NOVO registro (histórico).
-- Adaptações ao app: quem gera contrato é GESTOR (não só admin), então o
-- insert usa is_gestor(); helpers reais: is_staff()/is_gestor()/fn_is_admin().
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.contratos_emissoes (
  id uuid primary key default gen_random_uuid(),
  revendedora_id uuid not null references public.profiles(id) on delete cascade,
  emitido_por uuid not null references public.profiles(id),
  emitido_em timestamptz not null default now(),
  status text not null check (status in ('pendente', 'concluida')),
  tem_fiador boolean not null,
  vias_esperadas smallint not null,
  rubricado boolean not null default false,
  assinado_revendedora boolean not null default false,
  assinado_fiador boolean not null default false,
  vias_impressas boolean not null default false,
  observacao text
);

create index if not exists contratos_emissoes_rev_idx
  on public.contratos_emissoes (revendedora_id, emitido_em desc);

alter table public.contratos_emissoes enable row level security;

drop policy if exists ce_select_staff on public.contratos_emissoes;
drop policy if exists ce_select_own   on public.contratos_emissoes;
drop policy if exists ce_insert_gestor on public.contratos_emissoes;
drop policy if exists ce_update_gestor on public.contratos_emissoes;

-- Staff lê tudo
create policy ce_select_staff on public.contratos_emissoes
  for select to authenticated using ( public.is_staff() );

-- A revendedora lê as próprias emissões
create policy ce_select_own on public.contratos_emissoes
  for select to authenticated using ( revendedora_id = auth.uid() );

-- Só gestor grava (quem gera o contrato); emitido_por = ela mesma
create policy ce_insert_gestor on public.contratos_emissoes
  for insert to authenticated
  with check ( public.is_gestor() and emitido_por = auth.uid() );

create policy ce_update_gestor on public.contratos_emissoes
  for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
