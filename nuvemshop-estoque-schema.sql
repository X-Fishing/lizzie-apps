-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Sincronização de estoque App ↔ Site (Nuvemshop)
-- ════════════════════════════════════════════════════════════════════
-- O Bling NÃO participa desta sincronização. A fonte de verdade é
-- produtos.estoque_qtd (e produto_variacoes.estoque_qtd), controlada
-- 100% pelo app.
--
-- Regra central:
--   estoque visível no site = estoque_qtd
--                             − Σ (enviada − vendida − devolvida)
--                               dos consignados ATIVOS daquele produto
--
-- Ou seja: peça que está numa maleta ativa de revendedora nunca aparece
-- disponível no site. Quando volta (devolução ou catálogo encerrado),
-- volta a contar.
--
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- Idempotente: pode rodar várias vezes.
-- Depende de RLS-policies.sql (is_admin/is_staff/is_gestor) e de
-- produtos-schema.sql já aplicados.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- Token da Nuvemshop (linha única, nunca exposta ao cliente)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.nuvemshop_tokens (
  id           integer primary key default 1,
  store_id     bigint,
  access_token text,
  conectado_em timestamptz,
  updated_at   timestamptz not null default now(),
  constraint nuvemshop_tokens_single_row check (id = 1)
);
insert into public.nuvemshop_tokens (id) values (1) on conflict (id) do nothing;

alter table public.nuvemshop_tokens enable row level security;
-- Sem policies para authenticated/anon: só a Service Role (Edge Functions)
-- acessa. RLS habilitada + zero policies = ninguém do client lê nem escreve.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'nuvemshop_tokens'
  loop
    execute format('drop policy if exists %I on public.nuvemshop_tokens', r.policyname);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- Vínculo produto/variação ↔ Nuvemshop + status de sincronização
-- ════════════════════════════════════════════════════════════════════
alter table public.produtos add column if not exists nuvemshop_product_id bigint;
alter table public.produtos add column if not exists nuvemshop_variant_id bigint;
alter table public.produtos add column if not exists nuvemshop_sync_status text not null default 'pendente';
alter table public.produtos add column if not exists nuvemshop_sync_erro text;
alter table public.produtos add column if not exists nuvemshop_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_nuvemshop_status_chk') then
    alter table public.produtos add constraint produtos_nuvemshop_status_chk
      check (nuvemshop_sync_status in ('pendente','ok','erro','sem_par'));
  end if;
end $$;

alter table public.produto_variacoes add column if not exists nuvemshop_product_id bigint;
alter table public.produto_variacoes add column if not exists nuvemshop_variant_id bigint;
alter table public.produto_variacoes add column if not exists nuvemshop_sync_status text not null default 'pendente';
alter table public.produto_variacoes add column if not exists nuvemshop_sync_erro text;
alter table public.produto_variacoes add column if not exists nuvemshop_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_variacoes_nuvemshop_status_chk') then
    alter table public.produto_variacoes add constraint produto_variacoes_nuvemshop_status_chk
      check (nuvemshop_sync_status in ('pendente','ok','erro','sem_par'));
  end if;
end $$;

-- Casamento por SKU das peças sem produto_id (importadas do Bling). O
-- trigger de consignados faz essa busca uma vez por linha, e lançar uma
-- maleta insere dezenas de linhas de uma vez.
create index if not exists consignados_referencia_lower_idx
  on public.consignados (lower(referencia)) where produto_id is null;
create index if not exists produtos_sku_lower_idx
  on public.produtos (lower(sku)) where sku is not null and sku <> '';
create index if not exists prod_var_sku_lower_idx
  on public.produto_variacoes (lower(sku)) where sku is not null and sku <> '';

-- Busca rápida pelo variant_id (o webhook de pedido entra por aqui).
create index if not exists produtos_nuvemshop_variant_idx
  on public.produtos (nuvemshop_variant_id) where nuvemshop_variant_id is not null;
create index if not exists prod_var_nuvemshop_variant_idx
  on public.produto_variacoes (nuvemshop_variant_id) where nuvemshop_variant_id is not null;

-- ════════════════════════════════════════════════════════════════════
-- Fila de sincronização — evita chamar a API da Nuvemshop dentro do
-- trigger; um cron processa em lote e respeita o rate limit deles.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.nuvemshop_sync_queue (
  id                   uuid primary key default gen_random_uuid(),
  produto_id           uuid not null references public.produtos(id) on delete cascade,
  produto_variacao_id  uuid references public.produto_variacoes(id) on delete cascade,
  criado_em            timestamptz not null default now(),
  processado           boolean not null default false,
  tentativas           int not null default 0,
  erro                 text
);

-- Índice de apoio para "só um pendente por alvo". Note que NÃO usamos
-- ON CONFLICT contra ele: inferência de índice parcial com expressão
-- coalesce() é frágil (exige casar a expressão e o tipo do literal
-- exatamente). Os inserts passam por nuvemshop_enfileirar(), que faz
-- insert ... where not exists — robusto em qualquer versão do Postgres.
create unique index if not exists nuvemshop_sync_queue_pendente_uniq
  on public.nuvemshop_sync_queue
     (produto_id, coalesce(produto_variacao_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where processado = false;

create index if not exists nuvemshop_sync_queue_pendente_idx
  on public.nuvemshop_sync_queue (criado_em) where processado = false;

alter table public.nuvemshop_sync_queue enable row level security;
-- Mesma regra do token: sem policies, só Service Role mexe aqui.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'nuvemshop_sync_queue'
  loop
    execute format('drop policy if exists %I on public.nuvemshop_sync_queue', r.policyname);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- Log de eventos de pedido — idempotência do webhook (a Nuvemshop
-- reenvia o evento em caso de timeout; não pode descontar duas vezes).
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.nuvemshop_pedidos_log (
  id                 uuid primary key default gen_random_uuid(),
  nuvemshop_order_id bigint not null,
  evento             text not null,          -- ex.: 'order/paid'
  processado_em      timestamptz not null default now(),
  aviso              text                    -- itens sem vínculo no app, p/ conferência
);
create unique index if not exists nuvemshop_pedidos_log_uniq
  on public.nuvemshop_pedidos_log (nuvemshop_order_id, evento);

alter table public.nuvemshop_pedidos_log enable row level security;
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'nuvemshop_pedidos_log'
  loop
    execute format('drop policy if exists %I on public.nuvemshop_pedidos_log', r.policyname);
  end loop;
end $$;
-- Staff pode LER os avisos (para conferir pedido sem vínculo); escrita só Service Role.
create policy nuvemshop_pedidos_log_select on public.nuvemshop_pedidos_log
  for select to authenticated using ( public.is_staff() );

-- ════════════════════════════════════════════════════════════════════
-- RPC: estoque disponível no site
-- ════════════════════════════════════════════════════════════════════
-- Produto simples: saldo central menos o que está em maleta ativa.
--
-- ATENÇÃO ao casamento com `consignados`: produto_id é NULO em toda peça que
-- veio da importação do Bling (src/bling.js grava só `referencia`) e nas
-- adições manuais da conferência. Se olhássemos só produto_id, peça que está
-- na mão da revendedora apareceria disponível no site e poderia ser vendida
-- duas vezes. Por isso repetimos aqui a mesma regra que o app já usa para
-- localizar peça (ver src/consignados.js): casa por produto_id OU, quando
-- ele é nulo, pelo SKU em `referencia`.
create or replace function public.estoque_disponivel_site(p_produto_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0,
    coalesce(p.estoque_qtd, 0)
    - coalesce((
        select sum(c.quantidade_enviada
                   - coalesce(c.quantidade_vendida, 0)
                   - coalesce(c.quantidade_devolvida, 0))
        from public.consignados c
        where c.status = 'ativo'
          and ( c.produto_id = p.id
                or ( c.produto_id is null
                     and p.sku is not null and p.sku <> ''
                     and lower(c.referencia) = lower(p.sku) ) )
      ), 0)
  )
  from public.produtos p
  where p.id = p_produto_id;
$$;
revoke all on function public.estoque_disponivel_site(uuid) from public, anon, authenticated;
-- Sem grant para authenticated: quem chama é a Edge Function (service role,
-- que ignora grants). É SECURITY DEFINER porque precisa enxergar consignados
-- de todas as revendedoras — não pode ficar ao alcance do app da revendedora.

-- Produto com variação: o saldo mora na variação, mas `consignados` só tem
-- produto_id (não tem produto_variacao_id). Para não deixar peça que está
-- em maleta aparecer disponível no site, atribuímos o consignado à variação
-- pelo SKU (consignados.referencia = produto_variacoes.sku), que é como o
-- lançador bipa a peça. Consignado de produto com variação cuja referencia
-- não casa com nenhum SKU de variação fica sem atribuição — nesse caso a
-- variação não é descontada (documentado de propósito: melhor não descontar
-- do que descontar da variação errada).
create or replace function public.estoque_disponivel_site_variacao(p_variacao_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0,
    coalesce((select v.estoque_qtd from public.produto_variacoes v where v.id = p_variacao_id), 0)
    - coalesce((
        select sum(c.quantidade_enviada
                   - coalesce(c.quantidade_vendida, 0)
                   - coalesce(c.quantidade_devolvida, 0))
        from public.consignados c
        join public.produto_variacoes v on v.id = p_variacao_id
        where c.status = 'ativo'
          and v.sku is not null and v.sku <> ''
          and lower(c.referencia) = lower(v.sku)
          and (c.produto_id = v.produto_id or c.produto_id is null)
      ), 0)
  );
$$;
revoke all on function public.estoque_disponivel_site_variacao(uuid) from public, anon, authenticated;
-- Mesma regra da irmã acima: só service role.

-- ════════════════════════════════════════════════════════════════════
-- Enfileirar (usado pelos triggers e pelo botão "Sincronizar tudo")
-- ════════════════════════════════════════════════════════════════════
create or replace function public.nuvemshop_enfileirar(
  p_produto_id uuid,
  p_variacao_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_produto_id is null then return; end if;
  insert into public.nuvemshop_sync_queue (produto_id, produto_variacao_id)
  select p_produto_id, p_variacao_id
  where not exists (
    select 1 from public.nuvemshop_sync_queue q
    where q.processado = false
      and q.produto_id = p_produto_id
      and q.produto_variacao_id is not distinct from p_variacao_id
  );
end; $$;
revoke all on function public.nuvemshop_enfileirar(uuid, uuid) from public, anon, authenticated;
-- Só o service role (Edge Function) e os triggers chamam diretamente.
-- (O `revoke ... from public` sozinho NÃO basta: o bootstrap do Supabase dá
--  execute a anon/authenticated por default privilege. Vale para todas as
--  funções internas deste arquivo.)

-- Resolve o produto de um consignado e enfileira. Peça vinda do Bling tem
-- produto_id NULO — nesse caso achamos o produto (ou a variação) pelo SKU
-- guardado em `referencia`.
create or replace function public.nuvemshop_enfileirar_consignado(
  p_produto_id uuid,
  p_referencia text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod uuid;
  v_var  uuid;
begin
  if p_produto_id is not null then
    perform public.nuvemshop_enfileirar(p_produto_id, null);
    return;
  end if;

  if p_referencia is null or p_referencia = '' then return; end if;

  -- variação com esse SKU?
  select v.id, v.produto_id into v_var, v_prod
    from public.produto_variacoes v
   where v.sku is not null and lower(v.sku) = lower(p_referencia)
   limit 1;
  if v_var is not null then
    perform public.nuvemshop_enfileirar(v_prod, v_var);
    return;
  end if;

  -- senão, produto simples com esse SKU
  select p.id into v_prod
    from public.produtos p
   where p.sku is not null and lower(p.sku) = lower(p_referencia)
   limit 1;
  if v_prod is not null then
    perform public.nuvemshop_enfileirar(v_prod, null);
  end if;
end; $$;
revoke all on function public.nuvemshop_enfileirar_consignado(uuid, text) from public, anon, authenticated;

-- Enfileirar UM produto a partir do app (usado logo após vincular na tela
-- da loja — senão o produto recém-vinculado só iria pro site quando o
-- estoque dele mudasse por acaso).
create or replace function public.nuvemshop_enfileirar_produto(
  p_produto_id uuid,
  p_variacao_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_gestor() then
    raise exception 'sem permissão para sincronizar';
  end if;
  perform public.nuvemshop_enfileirar(p_produto_id, p_variacao_id);
end; $$;
revoke all on function public.nuvemshop_enfileirar_produto(uuid, uuid) from public, anon;
grant execute on function public.nuvemshop_enfileirar_produto(uuid, uuid) to authenticated;

-- Botão "Sincronizar tudo" do painel: enfileira todo produto ativo já
-- vinculado (e cada variação vinculada). Só gestor/admin.
create or replace function public.nuvemshop_enfileirar_tudo()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  if not public.is_gestor() then
    raise exception 'sem permissão para sincronizar';
  end if;

  perform public.nuvemshop_enfileirar(p.id, null)
    from public.produtos p
   where p.ativo = true
     and p.formato <> 'variacao'
     and p.nuvemshop_variant_id is not null;

  perform public.nuvemshop_enfileirar(v.produto_id, v.id)
    from public.produto_variacoes v
    join public.produtos p on p.id = v.produto_id
   where p.ativo = true
     and v.nuvemshop_variant_id is not null;

  select count(*) into n from public.nuvemshop_sync_queue where processado = false;
  return n;
end; $$;
revoke all on function public.nuvemshop_enfileirar_tudo() from public, anon;
grant execute on function public.nuvemshop_enfileirar_tudo() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Baixa de estoque por venda no site (chamada pelo webhook order/paid)
-- ════════════════════════════════════════════════════════════════════
-- Acha o produto (ou a variação) pelo nuvemshop_variant_id e desconta a
-- quantidade vendida do saldo central. Nunca deixa negativo. O UPDATE
-- dispara o trigger de fila, então o site se ressincroniza sozinho.
-- Retorna true se achou o vínculo; false se o item vendido no site não
-- corresponde a nada no app (o webhook registra isso como aviso).
-- Versão antiga (item a item) — removida. Se uma versão anterior deste
-- arquivo já rodou no SQL Editor, a função continuaria no banco com o grant
-- padrão do Supabase para authenticated, ou seja: qualquer usuário logado
-- podia zerar o estoque de qualquer produto vinculado. O drop abaixo fecha
-- isso mesmo num banco que já recebeu a versão antiga.
drop function if exists public.nuvemshop_baixar_estoque(bigint, integer);

-- Processa o pedido INTEIRO numa transação só: reivindica o evento e desconta
-- todos os itens junto. Precisa ser atômico — na versão anterior, uma falha
-- no item 3 de 5 devolvia a reivindicação depois de os itens 1 e 2 já terem
-- sido descontados e commitados, e o reenvio da Nuvemshop descontava os dois
-- de novo. Aqui, ou tudo entra, ou nada entra e a Nuvemshop pode reenviar.
--
-- p_itens: jsonb array de { variant_id: bigint, qtd: int, nome: text }
-- Retorna: { ja_processado, baixados, sem_vinculo: [...] }
create or replace function public.nuvemshop_processar_pedido(
  p_order_id bigint,
  p_evento text,
  p_itens jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it           jsonb;
  v_variant    bigint;
  v_qtd        integer;
  v_id         uuid;
  v_baixados   int := 0;
  v_sem        text[] := '{}';
  v_aviso      text;
begin
  -- Reivindica o evento. Se já existe, é reenvio: sai sem tocar em estoque.
  begin
    insert into public.nuvemshop_pedidos_log (nuvemshop_order_id, evento)
    values (p_order_id, p_evento);
  exception when unique_violation then
    return jsonb_build_object('ja_processado', true, 'baixados', 0, 'sem_vinculo', '[]'::jsonb);
  end;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    v_variant := nullif(it->>'variant_id', '')::bigint;
    v_qtd     := coalesce(nullif(it->>'qtd', '')::int, 0);

    -- Sem variante utilizável (produto apagado na loja, item personalizado):
    -- não dá pra baixar, mas TEM que aparecer no aviso — senão a diferença de
    -- estoque fica sem rastro nenhum para a gestão.
    if v_variant is null then
      v_sem := v_sem || format('%s (sem variante, qtd %s)',
                               coalesce(it->>'nome', 'item'), v_qtd);
      continue;
    end if;
    if v_qtd <= 0 then continue; end if;

    -- 1) variação
    select id into v_id from public.produto_variacoes
     where nuvemshop_variant_id = v_variant limit 1;
    if v_id is not null then
      update public.produto_variacoes
         set estoque_qtd = greatest(0, estoque_qtd - v_qtd)
       where id = v_id;
      v_baixados := v_baixados + 1;
      continue;
    end if;

    -- 2) produto simples
    select id into v_id from public.produtos
     where nuvemshop_variant_id = v_variant limit 1;
    if v_id is not null then
      update public.produtos
         set estoque_qtd = greatest(0, estoque_qtd - v_qtd)
       where id = v_id;
      v_baixados := v_baixados + 1;
      continue;
    end if;

    -- 3) vendido no site sem vínculo no app — registra para conferência
    v_sem := v_sem || format('%s (variant %s, qtd %s)',
                             coalesce(it->>'nome', 'item'), v_variant, v_qtd);
  end loop;

  if array_length(v_sem, 1) > 0 then
    v_aviso := 'Itens sem vínculo no app: ' || array_to_string(v_sem, '; ');
    update public.nuvemshop_pedidos_log set aviso = v_aviso
     where nuvemshop_order_id = p_order_id and evento = p_evento;
  end if;

  return jsonb_build_object(
    'ja_processado', false,
    'baixados', v_baixados,
    'sem_vinculo', to_jsonb(v_sem)
  );
end; $$;
revoke all on function public.nuvemshop_processar_pedido(bigint, text, jsonb) from public, anon, authenticated;
-- Só a Service Role (webhook) chama.

-- Status da conexão para a tela do admin — devolve SÓ se está conectado e
-- desde quando. Nunca o token, nem para admin.
create or replace function public.nuvemshop_status()
returns table (conectado boolean, conectado_em timestamptz, store_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (t.access_token is not null and t.access_token <> '') as conectado,
         t.conectado_em,
         t.store_id
  from public.nuvemshop_tokens t
  where t.id = 1 and public.is_gestor();
$$;
revoke all on function public.nuvemshop_status() from public, anon;
grant execute on function public.nuvemshop_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Triggers: qualquer coisa que mude a disponibilidade enfileira o
-- produto para ressincronizar.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.enfileirar_sync_nuvemshop_consignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cada ramo toca só o registro que existe naquela operação: referenciar
  -- OLD num INSERT (ou NEW num DELETE) levanta "record is not assigned yet".
  if tg_op = 'DELETE' then
    perform public.nuvemshop_enfileirar_consignado(old.produto_id, old.referencia);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.nuvemshop_enfileirar_consignado(new.produto_id, new.referencia);
    return new;
  end if;

  -- UPDATE: se o alvo mudou, os DOIS produtos mudaram de disponibilidade.
  if new.produto_id is distinct from old.produto_id
     or new.referencia is distinct from old.referencia then
    perform public.nuvemshop_enfileirar_consignado(old.produto_id, old.referencia);
  end if;
  perform public.nuvemshop_enfileirar_consignado(new.produto_id, new.referencia);
  return new;
end; $$;

drop trigger if exists consignados_enfileira_nuvemshop on public.consignados;
create trigger consignados_enfileira_nuvemshop
  after insert or delete or update of
    quantidade_enviada, quantidade_vendida, quantidade_devolvida, status,
    produto_id, maleta_id, referencia
  on public.consignados
  for each row execute function public.enfileirar_sync_nuvemshop_consignado();

create or replace function public.enfileirar_sync_nuvemshop_produto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estoque_qtd is distinct from old.estoque_qtd then
    perform public.nuvemshop_enfileirar(new.id, null);
  end if;
  return new;
end; $$;

drop trigger if exists produtos_enfileira_nuvemshop on public.produtos;
create trigger produtos_enfileira_nuvemshop
  after update of estoque_qtd on public.produtos
  for each row execute function public.enfileirar_sync_nuvemshop_produto();

create or replace function public.enfileirar_sync_nuvemshop_variacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estoque_qtd is distinct from old.estoque_qtd then
    perform public.nuvemshop_enfileirar(new.produto_id, new.id);
  end if;
  return new;
end; $$;

drop trigger if exists produto_variacoes_enfileira_nuvemshop on public.produto_variacoes;
create trigger produto_variacoes_enfileira_nuvemshop
  after update of estoque_qtd on public.produto_variacoes
  for each row execute function public.enfileirar_sync_nuvemshop_variacao();

-- Consignado de produto com variação: o trigger acima enfileira o produto.
-- A Edge Function, ao processar um item de produto formato='variacao',
-- ressincroniza TODAS as variações vinculadas daquele produto.

-- ════════════════════════════════════════════════════════════════════
-- AGENDAMENTO (rodar SEPARADO — precisa da service role key)
-- ════════════════════════════════════════════════════════════════════
-- Este bloco fica comentado de propósito: ele embute a service_role key,
-- que NÃO pode ser commitada. Rode à mão no SQL Editor trocando a chave,
-- uma vez só. Para conferir depois: select * from cron.job;
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- remove o agendamento anterior (idempotência)
-- select cron.unschedule('nuvemshop-sync-estoque')
--   where exists (select 1 from cron.job where jobname = 'nuvemshop-sync-estoque');
--
-- select cron.schedule(
--   'nuvemshop-sync-estoque',
--   '*/2 * * * *',                        -- a cada 2 minutos
--   $cron$
--   select net.http_post(
--     url     := 'https://qoouzjntyfzcxnwjksiu.supabase.co/functions/v1/nuvemshop-sync-estoque',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'Authorization', 'Bearer COLE_AQUI_A_SERVICE_ROLE_KEY'),
--     body    := '{}'::jsonb
--   );
--   $cron$
-- );
--
-- A função exige exatamente a service role key no modo cron (sem
-- ?produto_id). Com qualquer outra credencial ela responde 403.

-- ════════════════════════════════════════════════════════════════════
-- Resumo pré-sincronização em massa — trava contra zerar a loja
-- ════════════════════════════════════════════════════════════════════
-- Enquanto o catálogo legado (importado do Bling) não passa por um
-- inventário físico, boa parte dos produtos vinculados pode estar com
-- estoque_qtd = 0 sem ser real. "Sincronizar tudo" mandaria 0 pra todos
-- eles de uma vez — tirando peça de venda no site sem necessidade. Esta
-- RPC dá pro app decidir se pede confirmação antes de enfileirar tudo.
create or replace function public.nuvemshop_resumo_vinculados()
returns table (total_vinculados integer, zerados integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int as total_vinculados,
         count(*) filter (where estoque_qtd = 0)::int as zerados
  from (
    select estoque_qtd from public.produtos
     where ativo = true and formato <> 'variacao' and nuvemshop_variant_id is not null
    union all
    select v.estoque_qtd from public.produto_variacoes v
      join public.produtos p on p.id = v.produto_id
     where p.ativo = true and v.nuvemshop_variant_id is not null
  ) alvo
  where public.is_gestor();
$$;
revoke all on function public.nuvemshop_resumo_vinculados() from public, anon;
grant execute on function public.nuvemshop_resumo_vinculados() to authenticated;

-- FIM
