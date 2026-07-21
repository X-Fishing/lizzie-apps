-- ═══════════════════════════════════════════════════════════════════
-- 0028 — Programa de Fidelidade (cartela de selos da CLIENTE FINAL)
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- Regra do dono: 1 selo a cada R$150 cheios da venda (floor(valor_total/150)).
-- Cartela de 10 selos POR CLIENTE (chave = clientes.celular, dígitos crus
-- SEM DDI 55 — mesmo formato do cadastro 0021, NÃO migrar). Ao completar 10:
-- prêmio R$300 (retirada na loja) e a cartela zera. Os selos SOMAM entre
-- revendedoras (a mesma cliente comprando com várias revendedoras acumula
-- numa única cartela).
--
-- Esta fase cria só a ESTRUTURA + RLS + a função de leitura. A lógica de
-- aplicar selos (trigger na venda) vem na 0029.
--
-- Acesso: staff vê tudo; a REVENDEDORA só enxerga a fidelidade das clientes
-- para quem ela já vendeu. Escrita nas tabelas de selos/cartelas é feita só
-- pelo trigger SECURITY DEFINER (0029) — nenhuma policy de escrita direta.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Vínculo da venda com a cliente final. Sem backfill: vendas antigas
--    ficam com cliente_id null (decisão do dono: sem selos retroativos).
alter table public.vendas
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
create index if not exists idx_vendas_cliente     on public.vendas (cliente_id);
create index if not exists idx_vendas_rev_cliente on public.vendas (revendedora_id, cliente_id);

-- 2) Cartela da cliente (1 aberta por cliente).
create table if not exists public.fidelidade_cartelas (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  selos         int  not null default 0 check (selos between 0 and 10),
  status        text not null default 'aberta' check (status in ('aberta','completa')),
  completada_em timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists cartela_uma_aberta
  on public.fidelidade_cartelas (cliente_id) where (status = 'aberta');
create index if not exists idx_fid_cartelas_cliente on public.fidelidade_cartelas (cliente_id);

-- 3) Extrato de selos (1 linha por venda — idempotência do trigger).
--    quantidade = selos APLICADOS; excedente_descartado = auditoria (regra atual
--    descarta o que passa de 10). Se um dia EXCEDENTE_ACUMULA=true, trocar o
--    índice único para (venda_id, cartela_id).
create table if not exists public.fidelidade_selos (
  id                   uuid primary key default gen_random_uuid(),
  cartela_id           uuid not null references public.fidelidade_cartelas(id) on delete cascade,
  cliente_id           uuid not null references public.clientes(id) on delete cascade,
  venda_id             uuid not null references public.vendas(id) on delete cascade,
  revendedora_id       uuid,
  quantidade           int  not null check (quantidade >= 0),
  excedente_descartado int  not null default 0,
  valor_venda          numeric,
  created_at           timestamptz not null default now()
);
create unique index if not exists selos_venda_uniq   on public.fidelidade_selos (venda_id);
create index        if not exists idx_fid_selos_cartela on public.fidelidade_selos (cartela_id);
create index        if not exists idx_fid_selos_cliente on public.fidelidade_selos (cliente_id);

-- 4) Prêmio R$300 por cartela completa (resgate só gestor).
create table if not exists public.fidelidade_premios (
  id            uuid primary key default gen_random_uuid(),
  cartela_id    uuid not null unique references public.fidelidade_cartelas(id) on delete cascade,
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  valor         numeric not null default 300,
  status        text not null default 'pendente' check (status in ('pendente','resgatado')),
  resgatado_em  timestamptz,
  resgatado_por uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fid_premios_cliente on public.fidelidade_premios (cliente_id, status);

-- 5) RLS. Leitura: staff OU revendedora que já vendeu p/ a cliente.
--    Escrita nas tabelas de selos/cartelas: NENHUMA policy p/ authenticated
--    (só o trigger SECURITY DEFINER escreve, ignorando RLS como dono da tabela).
alter table public.fidelidade_cartelas enable row level security;
drop policy if exists fid_cartelas_select on public.fidelidade_cartelas;
create policy fid_cartelas_select on public.fidelidade_cartelas
  for select to authenticated
  using ( public.is_staff() or exists (
    select 1 from public.vendas v
    where v.cliente_id = fidelidade_cartelas.cliente_id and v.revendedora_id = auth.uid()) );

alter table public.fidelidade_selos enable row level security;
drop policy if exists fid_selos_select on public.fidelidade_selos;
create policy fid_selos_select on public.fidelidade_selos
  for select to authenticated
  using ( public.is_staff() or exists (
    select 1 from public.vendas v
    where v.cliente_id = fidelidade_selos.cliente_id and v.revendedora_id = auth.uid()) );

alter table public.fidelidade_premios enable row level security;
drop policy if exists fid_premios_select  on public.fidelidade_premios;
drop policy if exists fid_premios_resgate on public.fidelidade_premios;
create policy fid_premios_select on public.fidelidade_premios
  for select to authenticated
  using ( public.is_staff() or exists (
    select 1 from public.vendas v
    where v.cliente_id = fidelidade_premios.cliente_id and v.revendedora_id = auth.uid()) );
create policy fid_premios_resgate on public.fidelidade_premios
  for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );

-- 6) clientes: policy ADICIONAL de leitura (as policies staff da 0021 ficam
--    intactas — policies são OR). Revendedora vê a cliente p/ quem vendeu.
drop policy if exists clientes_select_revendedora_vendeu on public.clientes;
create policy clientes_select_revendedora_vendeu on public.clientes
  for select to authenticated
  using ( exists (select 1 from public.vendas v
                  where v.cliente_id = clientes.id and v.revendedora_id = auth.uid()) );

-- 7) Consulta consolidada p/ a tela e o detalhe da cliente.
--    SECURITY INVOKER de propósito: a RLS acima faz o filtro (revendedora sem
--    vínculo com a cliente recebe cartela/extrato vazios).
create or replace function public.fidelidade_status(p_cliente_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'cliente_id', p_cliente_id,
    'cartela', (select jsonb_build_object('id', id, 'selos', selos, 'criada_em', created_at)
                  from fidelidade_cartelas where cliente_id = p_cliente_id and status = 'aberta'),
    'premios_pendentes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'valor', valor, 'criado_em', created_at) order by created_at)
                  from fidelidade_premios where cliente_id = p_cliente_id and status = 'pendente'), '[]'::jsonb),
    'cartelas_completas', (select count(*) from fidelidade_cartelas where cliente_id = p_cliente_id and status = 'completa'),
    'extrato', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('venda_id', venda_id, 'quantidade', quantidade,
                                  'valor_venda', valor_venda, 'em', created_at) as x
        from fidelidade_selos where cliente_id = p_cliente_id
        order by created_at desc limit 20) s), '[]'::jsonb)
  );
$$;
revoke all on function public.fidelidade_status(uuid) from public;
grant execute on function public.fidelidade_status(uuid) to authenticated;

-- 8) Storage: permite a revendedora subir o certificado de garantia no prefixo
--    'garantias-certificado/' do bucket público lizzie-fotos (aditivo/escopado).
drop policy if exists "lizzie_fotos_garantia_cert_insert" on storage.objects;
drop policy if exists "lizzie_fotos_garantia_cert_update" on storage.objects;
create policy "lizzie_fotos_garantia_cert_insert" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'lizzie-fotos' and (storage.foldername(name))[1] = 'garantias-certificado' );
create policy "lizzie_fotos_garantia_cert_update" on storage.objects
  for update to authenticated
  using ( bucket_id = 'lizzie-fotos' and (storage.foldername(name))[1] = 'garantias-certificado' )
  with check ( bucket_id = 'lizzie-fotos' and (storage.foldername(name))[1] = 'garantias-certificado' );
