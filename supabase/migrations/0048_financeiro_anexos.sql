-- 0048 — Comprovantes de pagamento em Contas a Receber (vários por lançamento).
--
-- Contas a Pagar guarda UM anexo em colunas na própria linha (anexo_path/
-- anexo_nome, migração 0026). Aqui não dá: um acerto de maleta costuma ser
-- pago em mais de um PIX, e cada um tem seu comprovante. Então é tabela
-- filha, não coluna.
--
-- Reaproveita o bucket privado 'documentos' criado em 0026 (staff lê, gestor
-- grava/apaga) — nada de bucket novo nem de policy nova de storage.

create table if not exists public.financeiro_anexos (
  id            uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.financeiro_lancamentos(id) on delete cascade,
  path          text not null,          -- caminho no bucket 'documentos'
  nome          text not null,          -- nome original, pra exibir
  tamanho       bigint,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

-- A tela sempre busca por lançamento.
create index if not exists financeiro_anexos_lanc_idx
  on public.financeiro_anexos (lancamento_id, created_at);

alter table public.financeiro_anexos enable row level security;

drop policy if exists financeiro_anexos_select on public.financeiro_anexos;
drop policy if exists financeiro_anexos_insert on public.financeiro_anexos;
drop policy if exists financeiro_anexos_delete on public.financeiro_anexos;

-- Mesmo recorte do bucket: staff enxerga, gestor mexe.
create policy financeiro_anexos_select on public.financeiro_anexos
  for select to authenticated using ( public.is_staff() );
create policy financeiro_anexos_insert on public.financeiro_anexos
  for insert to authenticated with check ( public.is_gestor() );
create policy financeiro_anexos_delete on public.financeiro_anexos
  for delete to authenticated using ( public.is_gestor() );

-- ATENÇÃO: o "on delete cascade" apaga a LINHA quando o lançamento some, mas
-- não apaga o arquivo no storage — o app remove o objeto antes de excluir o
-- lançamento. Se um dia sobrar arquivo órfão, dá pra varrer o bucket
-- comparando com esta tabela.

select pg_notify('pgrst', 'reload schema');
