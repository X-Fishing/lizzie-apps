-- ═══════════════════════════════════════════════════════════════════
-- 0026 — Contas a Pagar (redesign): grupos/abas + anexo + bucket privado
-- COMO APLICAR: Supabase → SQL Editor → New query → cole tudo → Run.
-- IDEMPOTENTE: pode rodar mais de uma vez. Sem downtime — o app usa
-- fallback 'variavel' e só deixa de anexar/mover enquanto não roda.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Grupo (aba da tela): fixa | variavel | pessoas | impostos.
--    Default 'variavel' faz o backfill dos títulos legados.
alter table public.contas_a_pagar
  add column if not exists grupo text not null default 'variavel';

do $$ begin
  alter table public.contas_a_pagar
    add constraint cap_grupo_check
    check (grupo in ('fixa','variavel','pessoas','impostos'));
exception when duplicate_object then null; end $$;

create index if not exists idx_cap_grupo on public.contas_a_pagar(grupo);

-- 2) Anexo (boleto/comprovante): gravamos o PATH no bucket privado + o
--    nome original do arquivo (exibição). NUNCA gravar URL assinada (expira).
alter table public.contas_a_pagar
  add column if not exists anexo_path text,
  add column if not exists anexo_nome text;

-- 3) Bucket PRIVADO 'documentos' (mesmo padrão do fotos-revendedoras).
--    staff lê (via URL assinada), gestor grava/remove.
--    Paths deste módulo: contas-a-pagar/{timestamp}_{nome}.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists "documentos_staff_select"  on storage.objects;
drop policy if exists "documentos_gestor_insert" on storage.objects;
drop policy if exists "documentos_gestor_update" on storage.objects;
drop policy if exists "documentos_gestor_delete" on storage.objects;

create policy "documentos_staff_select" on storage.objects
  for select to authenticated
  using ( bucket_id = 'documentos' and public.is_staff() );
create policy "documentos_gestor_insert" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'documentos' and public.is_gestor() );
create policy "documentos_gestor_update" on storage.objects
  for update to authenticated
  using ( bucket_id = 'documentos' and public.is_gestor() )
  with check ( bucket_id = 'documentos' and public.is_gestor() );
create policy "documentos_gestor_delete" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'documentos' and public.is_gestor() );
