-- ════════════════════════════════════════════════════════════════════
-- MALETAS — agrupamento de consignados por revendedora, com regras.
-- Idempotente: pode rodar várias vezes. Rodar no Supabase (SQL Editor).
-- Status: 'ativa' (com a revendedora) | 'aguardando' (montada, p/ troca) | 'finalizada'.
-- Regras: máx. 2 em aberto (ativa+aguardando) por revendedora; máx. 1 ativa.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.maletas (
  id             uuid primary key default gen_random_uuid(),
  revendedora_id uuid not null references public.profiles(id) on delete cascade,
  numero         integer,
  status         text not null default 'ativa',  -- 'ativa' | 'aguardando' | 'finalizada'
  created_at     timestamptz not null default now(),
  finalizada_at  timestamptz
);
create index if not exists maletas_rev_status_idx on public.maletas (revendedora_id, status);

-- no máximo 1 ativa por revendedora
create unique index if not exists maletas_uma_ativa
  on public.maletas (revendedora_id) where status = 'ativa';

-- vínculo da peça à maleta
alter table public.consignados
  add column if not exists maleta_id uuid references public.maletas(id) on delete set null;

-- limite de 2 em aberto (ativa+aguardando) por revendedora
create or replace function public.guard_max_maletas()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status in ('ativa','aguardando') then
    select count(*) into n from public.maletas
      where revendedora_id = new.revendedora_id
        and status in ('ativa','aguardando')
        and id <> new.id;
    if n >= 2 then
      raise exception 'Revendedora já tem 2 maletas em aberto (limite atingido).';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_max_maletas_trg on public.maletas;
create trigger guard_max_maletas_trg before insert or update on public.maletas
  for each row execute function public.guard_max_maletas();

-- MIGRAÇÃO: envolve os consignados 'ativo' atuais (sem maleta) numa maleta ativa por revendedora
do $$
declare r record; m uuid;
begin
  for r in select distinct revendedora_id from public.consignados
           where status = 'ativo' and maleta_id is null loop
    insert into public.maletas (revendedora_id, status, numero)
      values (r.revendedora_id, 'ativa', 1) returning id into m;
    update public.consignados set maleta_id = m
      where revendedora_id = r.revendedora_id and status = 'ativo' and maleta_id is null;
  end loop;
end $$;

-- RLS
alter table public.maletas enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='maletas' loop
    execute format('drop policy if exists %I on public.maletas', r.policyname);
  end loop; end $$;
create policy maletas_select on public.maletas for select to authenticated
  using ( revendedora_id = auth.uid() or public.is_staff() );
create policy maletas_insert on public.maletas for insert to authenticated
  with check ( public.is_gestor() );
create policy maletas_update on public.maletas for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy maletas_delete on public.maletas for delete to authenticated
  using ( public.is_gestor() );
