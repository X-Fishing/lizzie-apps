-- ═══════════════════════════════════════════════════════════════════
-- 0061 — Kit / peça montada na hora (Produtos). COMO APLICAR: Supabase
-- → SQL Editor → cole tudo → Run. Idempotente.
--
-- PEDIDO (WhatsApp da equipe): "corrente + pingente de filho + pingente
-- de cachorro + separador" montados na hora e vendidos como uma peça só
-- — igual à aba "Estrutura" do Bling. produtos.formato ganha o valor
-- 'kit' (já era text livre 'simples'|'variacao', sem enum de banco).
--
-- SEM decremento automático de estoque: produtos.estoque_qtd hoje não é
-- debitado em NENHUMA venda (ver comentário em src/lancador.js sobre o
-- "débito central" ainda não existir) — um kit não deve fingir ser mais
-- "ao vivo" que um produto comum. O app calcula um estoque "disponível"
-- só pra exibição (mínimo entre os componentes), sem gravar nada aqui.
--
-- SEM aninhamento: um componente não pode ser, ele mesmo, um kit — nem
-- direto (auto-referência: produto sendo componente de si mesmo — o
-- select da UI já filtra isso, mas o check abaixo garante no banco
-- também) nem indireto (um produto que hoje é 'simples' e está sendo
-- usado como componente não pode virar 'kit' depois — 2º trigger, senão
-- bastaria montar o kit ANTES de converter o componente pra furar a
-- checagem do 1º trigger, que só olha o formato NO MOMENTO do insert).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.produto_componentes (
  id                     uuid primary key default gen_random_uuid(),
  produto_id             uuid not null references public.produtos(id) on delete cascade,
  componente_produto_id  uuid not null references public.produtos(id) on delete restrict,
  quantidade             numeric(12,3) not null default 1 check (quantidade > 0),
  created_at             timestamptz not null default now(),
  check (produto_id <> componente_produto_id),
  unique (produto_id, componente_produto_id)
);
create index if not exists prod_comp_produto_idx    on public.produto_componentes (produto_id);
create index if not exists prod_comp_componente_idx on public.produto_componentes (componente_produto_id);

-- ── Guarda 1: ao vincular um componente, ele não pode SER um kit ─────
create or replace function public.guard_produto_componente_nao_kit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_formato text;
begin
  select formato into v_formato from public.produtos where id = new.componente_produto_id;
  if v_formato = 'kit' then
    raise exception 'Um kit não pode ter outro kit como componente.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_produto_componente on public.produto_componentes;
create trigger trg_guard_produto_componente
  before insert or update on public.produto_componentes
  for each row execute function public.guard_produto_componente_nao_kit();

-- ── Guarda 2: um produto JÁ usado como componente não pode virar kit ─
-- (fecha o caminho inverso do aninhamento: montar o kit primeiro, com um
-- componente 'simples', e só depois converter esse componente pra 'kit'
-- — o guard 1 não pega esse caso porque só olha o momento do insert/update
-- em produto_componentes, não uma alteração posterior em produtos).
create or replace function public.guard_produto_vira_kit_em_uso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.formato = 'kit' and coalesce(old.formato, '') <> 'kit'
     and exists (select 1 from public.produto_componentes where componente_produto_id = new.id) then
    raise exception 'Este produto é componente de um kit — remova-o do(s) kit(s) antes de torná-lo um kit.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_produto_vira_kit on public.produtos;
create trigger trg_guard_produto_vira_kit
  before update on public.produtos
  for each row execute function public.guard_produto_vira_kit_em_uso();

-- ── RLS — mesmo padrão de produto_variacoes: staff lê, gestor
--        cadastra/edita, só admin exclui ─────────────────────────────
alter table public.produto_componentes enable row level security;
drop policy if exists produto_componentes_select on public.produto_componentes;
drop policy if exists produto_componentes_insert on public.produto_componentes;
drop policy if exists produto_componentes_update on public.produto_componentes;
drop policy if exists produto_componentes_delete on public.produto_componentes;
create policy produto_componentes_select on public.produto_componentes
  for select to authenticated using ( public.is_staff() );
create policy produto_componentes_insert on public.produto_componentes
  for insert to authenticated with check ( public.is_gestor() );
create policy produto_componentes_update on public.produto_componentes
  for update to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy produto_componentes_delete on public.produto_componentes
  for delete to authenticated using ( public.is_admin() );

select pg_notify('pgrst', 'reload schema');
