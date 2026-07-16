-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Funções RPC (Postgres)
-- ════════════════════════════════════════════════════════════════════
-- COMO APLICAR: Supabase → SQL Editor → cole este arquivo → Run.
-- Idempotente (create or replace). Aplique ANTES de publicar a versão do
-- index.html que chama sb.rpc('registrar_venda', ...), senão registrar
-- venda vai falhar.
-- ════════════════════════════════════════════════════════════════════

-- registrar_venda: cria a venda, os itens, o recebimento (se houver) e
-- incrementa quantidade_vendida — tudo numa única transação. Resolve:
--   (a) venda órfã sem itens (se algo falha, ROLLBACK de tudo);
--   (b) race condition no quantidade_vendida (incremento atômico no banco,
--       sem read-modify-write a partir de cache do navegador).
-- SECURITY INVOKER: roda com as permissões do usuário logado, respeitando
-- as policies de RLS (revendedora só mexe nas próprias linhas).
-- 0023: ganhou p_tel/p_nasc/p_combinada (DEFAULT null → retrocompatível).
-- A assinatura mudou; drop antes p/ não virar overload ambíguo no PostgREST.
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);
create or replace function public.registrar_venda(
  p_cliente   text,
  p_data      date,
  p_forma     text,
  p_total     numeric,
  p_pago      numeric,
  p_status    text,
  p_obs       text,
  p_itens     jsonb,
  p_tel       text default null,
  p_nasc      date default null,
  p_combinada date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id uuid;
  v_item     jsonb;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada
  ) values (
    auth.uid(), p_cliente, p_data, p_forma,
    p_total, p_pago, p_status, p_obs,
    p_tel, p_nasc, p_combinada
  )
  returning id into v_venda_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into venda_itens (
      venda_id, consignado_id, descricao, referencia, quantidade, preco_unit
    ) values (
      v_venda_id,
      (v_item->>'consignado_id')::uuid,
      v_item->>'descricao',
      v_item->>'referencia',
      (v_item->>'quantidade')::int,
      (v_item->>'preco_unit')::numeric
    );

    update consignados
       set quantidade_vendida = coalesce(quantidade_vendida, 0) + (v_item->>'quantidade')::int
     where id = (v_item->>'consignado_id')::uuid;
  end loop;

  if coalesce(p_pago, 0) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, p_pago, p_data);
  end if;

  return v_venda_id;
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- handle_new_user: cria o profile automaticamente quando um usuario se
-- cadastra (after insert on auth.users). Resolve o caso em que a confirmacao
-- de e-mail esta ativa: nao ha sessao apos signUp, o insert client-side
-- falharia por RLS e a usuaria ficaria sem profile (preso no splash).
-- SECURITY DEFINER: roda com privilegios do dono, ignorando RLS.
-- Le nome/telefone/cidade de raw_user_meta_data (enviados em options.data).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, nome, telefone, cidade, aprovada)
  values (
    new.id,
    'revendedora',
    coalesce(
      new.raw_user_meta_data->>'nome',       -- cadastro por formulario
      new.raw_user_meta_data->>'full_name',  -- Google
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'telefone',     -- null no Google
    new.raw_user_meta_data->>'cidade',       -- null no Google
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════
-- sincronizar_maleta: ADD-ONLY. Insere no catálogo da revendedora só as
-- unidades NOVAS de cada SKU vindas do pedido do Bling. Calcula o delta no
-- SERVIDOR (não confia no front) e NUNCA faz update/delete em linhas
-- existentes — vendidos/pagos ficam intactos.
--   delta = quantidade_no_Bling − SOMA(quantidade_enviada das linhas ativas do SKU)
--   delta > 0  -> insere 1 linha nova com quantidade_enviada = delta
--   delta <= 0 -> não faz nada (append-only; se < 0, é conferência manual)
-- Idempotente: rodar 2x seguidas, a 2ª calcula delta 0. Só gestor/admin.
-- SECURITY INVOKER: respeita RLS (consignados_insert exige is_gestor p/ outra rev).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.sincronizar_maleta(
  p_revendedora_id uuid,
  p_pedido_numero  text,
  p_itens          jsonb   -- [{referencia, descricao, quantidade, preco}]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item      record;
  v_qtd_app   integer;
  v_delta     integer;
  v_inseridos integer := 0;
begin
  if not public.is_gestor() then
    raise exception 'Sem permissao';
  end if;

  -- Agrupa por SKU (soma linhas repetidas do mesmo código no pedido).
  -- Ignora itens sem referência/código (não dá para reconciliar por contagem).
  for v_item in
    select
      x->>'referencia'                       as referencia,
      max(x->>'descricao')                   as descricao,
      sum( (x->>'quantidade')::numeric )     as quantidade,
      max( nullif(x->>'preco','')::numeric ) as preco
    from jsonb_array_elements(p_itens) as x
    where coalesce(x->>'referencia','') <> ''
    group by x->>'referencia'
  loop
    select coalesce(sum(quantidade_enviada), 0) into v_qtd_app
      from consignados
     where revendedora_id = p_revendedora_id
       and status = 'ativo'
       and referencia = v_item.referencia;

    v_delta := floor(v_item.quantidade)::int - v_qtd_app;

    if v_delta > 0 then
      insert into consignados
        (revendedora_id, descricao, referencia, quantidade_enviada,
         quantidade_vendida, quantidade_devolvida, preco_venda, foto_url, status, pedido_numero)
      values
        (p_revendedora_id, v_item.descricao, v_item.referencia, v_delta,
         0, 0, v_item.preco, null, 'ativo', p_pedido_numero);
      v_inseridos := v_inseridos + v_delta;
    end if;
  end loop;

  return v_inseridos;
end;
$$;

revoke all on function public.sincronizar_maleta(uuid,text,jsonb) from public;
grant execute on function public.sincronizar_maleta(uuid,text,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- MALETA PÚBLICA — link exclusivo por revendedora no site-catálogo
-- (lizzie-catalogo.netlify.app/maleta?t=<share_token>)
-- ════════════════════════════════════════════════════════════════════

-- Token de compartilhamento por profile (link público da maleta).
alter table public.profiles
  add column if not exists share_token uuid unique default gen_random_uuid();
update public.profiles set share_token = gen_random_uuid() where share_token is null;

-- maleta_publica: chamada ANÔNIMA pelo site-catálogo. Retorna SÓ para o
-- profile APROVADO dono do token: primeiro nome, telefone (canal de compra
-- que a própria revendedora divulga) e as peças ATIVAS com disponível > 0.
-- Token inválido/não aprovada -> null (não vaza existência).
-- NUNCA retornar: sobrenome, cidade, e-mail, custos, ids internos, clientes.
create or replace function public.maleta_publica(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nome', split_part(trim(p.nome), ' ', 1),
    'telefone', p.telefone,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referencia', i.referencia,
               'descricao',  i.descricao,
               'preco',      i.preco,
               'disponivel', i.disponivel
             ) order by i.descricao)
      from (
        select c.referencia,
               min(c.descricao)  as descricao,
               max(c.preco_venda) as preco,
               sum( (c.quantidade_enviada - coalesce(c.quantidade_vendida,0)
                     - coalesce(c.quantidade_devolvida,0)) ) as disponivel
        from consignados c
        where c.revendedora_id = p.id
          and c.status = 'ativo'
          -- espelha o app: se existe maleta ATIVA, só as peças dela
          -- (nunca expõe maleta 'aguardando'); sem registro de maleta
          -- (dados legados), vale o status do consignado.
          and (ma.id is null or c.maleta_id = ma.id)
        group by c.referencia, c.descricao
        having sum( (c.quantidade_enviada - coalesce(c.quantidade_vendida,0)
                     - coalesce(c.quantidade_devolvida,0)) ) > 0
      ) i
    ), '[]'::jsonb)
  )
  from profiles p
  left join lateral (
    select m.id from maletas m
    where m.revendedora_id = p.id and m.status = 'ativa'
    limit 1
  ) ma on true
  where p.share_token = p_token
    and p.aprovada = true
    and p.role = 'revendedora';
$$;

revoke all on function public.maleta_publica(uuid) from public;
grant execute on function public.maleta_publica(uuid) to anon;
grant execute on function public.maleta_publica(uuid) to authenticated;

-- regenerar_share_token: a própria usuária revoga um link vazado.
-- SECURITY INVOKER: só atualiza a própria linha (RLS profiles_update_own).
create or replace function public.regenerar_share_token()
returns uuid
language sql
security invoker
set search_path = public
as $$
  update profiles set share_token = gen_random_uuid()
  where id = auth.uid()
  returning share_token;
$$;

revoke all on function public.regenerar_share_token() from public;
grant execute on function public.regenerar_share_token() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- DASHBOARD DA REVENDEDORA — foto de perfil, raspadinha e RLS das faixas
-- ════════════════════════════════════════════════════════════════════

-- Foto de perfil (caminho do arquivo no bucket privado fotos-revendedoras).
alter table public.profiles
  add column if not exists foto_url text;

-- Configuração da raspadinha: a cada X reais vendidos, ganha 1 raspadinha.
-- Parametrizável pelo admin em Cadastros (não hardcode no JS).
create table if not exists public.config_raspadinha (
  id uuid primary key default gen_random_uuid(),
  valor_por_raspadinha numeric not null,
  ativo boolean not null default true,
  created_at timestamptz default now()
);

-- RLS: leitura para qualquer autenticado (a revendedora precisa das faixas
-- e da raspadinha para a régua); escrita só gestor/admin.
alter table public.faixas_comissao enable row level security;
drop policy if exists faixas_comissao_select on public.faixas_comissao;
drop policy if exists faixas_comissao_write  on public.faixas_comissao;
create policy faixas_comissao_select on public.faixas_comissao
  for select to authenticated using ( true );
create policy faixas_comissao_write on public.faixas_comissao
  for all to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() );

alter table public.config_raspadinha enable row level security;
drop policy if exists config_raspadinha_select on public.config_raspadinha;
drop policy if exists config_raspadinha_write  on public.config_raspadinha;
create policy config_raspadinha_select on public.config_raspadinha
  for select to authenticated using ( true );
create policy config_raspadinha_write on public.config_raspadinha
  for all to authenticated using ( public.is_gestor() ) with check ( public.is_gestor() );

-- ── Storage: bucket PRIVADO para fotos de perfil ─────────────────────
-- Path: {revendedora_id}/perfil.jpg — cada usuária só mexe na própria pasta;
-- staff pode ler todas (exibir avatar no painel). Exibição via URL assinada.
insert into storage.buckets (id, name, public)
values ('fotos-revendedoras', 'fotos-revendedoras', false)
on conflict (id) do nothing;

drop policy if exists "fotos_rev_own_select" on storage.objects;
drop policy if exists "fotos_rev_own_insert" on storage.objects;
drop policy if exists "fotos_rev_own_update" on storage.objects;
drop policy if exists "fotos_rev_staff_select" on storage.objects;
create policy "fotos_rev_own_select" on storage.objects
  for select to authenticated
  using ( bucket_id = 'fotos-revendedoras' and (storage.foldername(name))[1] = auth.uid()::text );
create policy "fotos_rev_own_insert" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'fotos-revendedoras' and (storage.foldername(name))[1] = auth.uid()::text );
create policy "fotos_rev_own_update" on storage.objects
  for update to authenticated
  using ( bucket_id = 'fotos-revendedoras' and (storage.foldername(name))[1] = auth.uid()::text )
  with check ( bucket_id = 'fotos-revendedoras' and (storage.foldername(name))[1] = auth.uid()::text );
create policy "fotos_rev_staff_select" on storage.objects
  for select to authenticated
  using ( bucket_id = 'fotos-revendedoras' and public.is_staff() );
