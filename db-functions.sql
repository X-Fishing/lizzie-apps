-- ════════════════════════════════════════════════════════════════════
-- Lizzie Semijoias — Funções RPC (Postgres)
-- ════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ ARQUIVO HISTÓRICO — **NÃO RODE ESTE ARQUIVO HOJE.** ⚠️⚠️
-- A `registrar_venda` aqui está na assinatura ANTIGA. Rodá-lo depois das
-- migrações recria um overload velho, e o PostgREST passa a recusar a chamada
-- por ambiguidade — TODA venda quebra em campo. A versão que vale é sempre a
-- da migração de maior número em supabase/migrations/ (hoje: 0057).
-- Mantido só como registro de como a função nasceu.
--
-- COMO APLICAR (só em banco NOVO, antes das migrações): Supabase → SQL Editor
-- → cole este arquivo → Run. Idempotente (create or replace).
--
-- 19/08/2026: esse aviso já não foi suficiente uma vez — alguém (inclusive
-- o Cowork) rodou o arquivo inteiro achando que era só pra atualizar UMA
-- função, recriou o overload antigo de registrar_venda, e quase quebrou
-- toda venda em produção. O bloco abaixo trava a execução na primeira
-- linha (e não pode ser rodado sem querer, se o SQL Editor executar
-- STATEMENT por STATEMENT em vez de misturar) — se você chegou até aqui de
-- propósito porque precisa mesmo recriar um banco do zero, apague este
-- bloco antes de rodar o resto.
-- ════════════════════════════════════════════════════════════════════
do $$ begin
  raise exception 'db-functions.sql é histórico — NÃO rode em banco existente. Correções de função viram migration numerada em supabase/migrations/. Leia o aviso no topo do arquivo antes de prosseguir.';
end $$;

-- registrar_venda: cria a venda, os itens, o recebimento (se houver) e
-- incrementa quantidade_vendida — tudo numa única transação. Resolve:
--   (a) venda órfã sem itens (se algo falha, ROLLBACK de tudo);
--   (b) race condition no quantidade_vendida (incremento atômico no banco,
--       sem read-modify-write a partir de cache do navegador).
-- SECURITY INVOKER: roda com as permissões do usuário logado, respeitando
-- as policies de RLS (revendedora só mexe nas próprias linhas).
-- 0023: ganhou p_tel/p_nasc/p_combinada (DEFAULT null → retrocompatível).
-- 0029: upserta a cliente (fidelidade), grava vendas.cliente_id e passou a
--   RETORNAR jsonb {venda_id, cliente_id, fidelidade}. O front antigo descarta
--   o retorno, então é retrocompatível. Mudança de tipo de retorno → drop antes.
--   O trigger aplicar_fidelidade (0029) credita os selos após o insert.
-- 0051: ganhou p_pagamentos jsonb (DEFAULT null → retrocompatível). Quando vem
--   preenchido, ele MANDA em forma_pagamento ('Misto' se 2+ formas) e em
--   valor_pago, e grava o rateio em venda_pagamentos. Mudança de assinatura →
--   drop antes.
-- 0052: formas que começam com 'Fiado' (Fiado, Fiado parcelado Nx) NÃO contam
--   como recebidas — são a revendedora parcelando DIRETO com a cliente, ou
--   seja, dívida. 'Cartão crédito Nx' é maquininha: dinheiro garantido, conta
--   como recebido. Também passou a derivar STATUS no banco quando vêm
--   pagamentos (antes confiava no p_status calculado pelo front).
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb);
create or replace function public.registrar_venda(
  p_cliente    text,
  p_data       date,
  p_forma      text,
  p_total      numeric,
  p_pago       numeric,
  p_status     text,
  p_obs        text,
  p_itens      jsonb,
  p_tel        text  default null,
  p_nasc       date  default null,
  p_combinada  date  default null,
  p_pagamentos jsonb default null   -- [{forma, valor, data}]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id   uuid;
  v_item       jsonb;
  v_pgto       jsonb;
  v_cliente_id uuid;
  v_fid        jsonb;
  v_forma      text    := p_forma;
  v_pago       numeric := coalesce(p_pago, 0);
  v_status     text    := p_status;
  v_n          int     := 0;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'venda sem itens';
  end if;

  -- Quando vierem linhas de pagamento, elas mandam em forma/valor_pago/status.
  -- Não confia no que o front calculou: soma e deriva aqui.
  -- 'Fiado%' cobre 'Fiado' e 'Fiado parcelado Nx' — a revendedora parcelando
  -- direto com a cliente é dívida, não dinheiro recebido.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    v_n := jsonb_array_length(p_pagamentos);
    select coalesce(sum((x->>'valor')::numeric), 0) into v_pago
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') not like 'fiado%';
    if v_n = 1 then
      select x->>'forma' into v_forma from jsonb_array_elements(p_pagamentos) x;
    else
      v_forma := 'Misto';
    end if;
    v_status := case when v_pago >= p_total then 'quitado'
                     when v_pago > 0        then 'parcial'
                     else 'pendente' end;
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,
    p_total, v_pago, v_status, p_obs,
    p_tel, p_nasc, p_combinada, v_cliente_id
  )
  returning id into v_venda_id;

  -- Rateio por forma de pagamento (0051).
  if p_pagamentos is not null then
    for v_pgto in select * from jsonb_array_elements(p_pagamentos)
    loop
      insert into venda_pagamentos (venda_id, forma, valor, data)
      values (
        v_venda_id,
        v_pgto->>'forma',
        (v_pgto->>'valor')::numeric,
        coalesce(nullif(v_pgto->>'data', '')::date, p_data)
      );
    end loop;
  end if;

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

  -- Recebimentos: um por linha efetivamente paga (0051; antes era um lump só).
  -- Mantém o bloco "Recebimentos" do detalhe da venda coerente com o rateio.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    select v_venda_id,
           (x->>'valor')::numeric,
           coalesce(nullif(x->>'data', '')::date, p_data)
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') not like 'fiado%'
       and (x->>'valor')::numeric > 0;
  elsif v_pago > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, v_pago, p_data);
  end if;

  -- 0030: a venda pode gerar selos em 2 cartelas (excedente acumula) → soma.
  select jsonb_build_object(
    'selos_ganhos',         coalesce(sum(s.quantidade), 0),
    'excedente_descartado', 0,
    'cartela_selos',        (select selos from fidelidade_cartelas
                              where cliente_id = v_cliente_id and status = 'aberta'),
    'completou',            exists (select 1 from fidelidade_selos s2
                              join fidelidade_cartelas c on c.id = s2.cartela_id
                              where s2.venda_id = v_venda_id and c.status = 'completa'),
    'premio_pendente',      exists (select 1 from fidelidade_premios p
                              where p.cliente_id = v_cliente_id and p.status = 'pendente')
  ) into v_fid
  from fidelidade_selos s where s.venda_id = v_venda_id;

  return jsonb_build_object('venda_id', v_venda_id, 'cliente_id', v_cliente_id, 'fidelidade', v_fid);
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- handle_new_user: NÃO MORA MAIS AQUI.  ⚠ NÃO REINTRODUZIR NESTE ARQUIVO.
--
-- A versão que existia aqui era ANTIGA (inseria o profile sem
-- is_revendedora e sem adotar o pré-cadastro pelo e-mail). Como o cabeçalho
-- deste arquivo manda "colar inteiro e Run", rodá-lo REVERTIA o trigger e
-- quebrava TODOS os cadastros novos: o insert sem is_revendedora viola o
-- check profiles_revendedora_flag_chk (0019/0025) e o signUp morre com
-- "Database error saving new user".
--
-- A versão VÁLIDA é a da migração mais recente que a redefine:
--   supabase/migrations/0037_corrige_adocao_pre_cadastro.sql
-- (0016 criou a adoção por e-mail, 0025 acrescentou is_revendedora,
--  0037 corrigiu a ordem da adoção + FKs on update cascade + e-mail).
-- ════════════════════════════════════════════════════════════════════

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
  v_maleta    uuid;
begin
  if not public.is_gestor() then
    raise exception 'Sem permissao';
  end if;

  -- Resolve (ou cria) a maleta ATIVA da revendedora para vincular as peças novas.
  select id into v_maleta from maletas
    where revendedora_id = p_revendedora_id and status = 'ativa' limit 1;
  if v_maleta is null then
    insert into maletas (revendedora_id, status, numero)
      values (p_revendedora_id, 'ativa', 1) returning id into v_maleta;
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
        (revendedora_id, maleta_id, descricao, referencia, quantidade_enviada,
         quantidade_vendida, quantidade_devolvida, preco_venda, foto_url, status, pedido_numero)
      values
        (p_revendedora_id, v_maleta, v_item.descricao, v_item.referencia, v_delta,
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
-- (catalogo.lizzie.com.br/maleta?t=<share_token>)
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
