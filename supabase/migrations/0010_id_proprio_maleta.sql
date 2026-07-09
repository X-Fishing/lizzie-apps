-- ═══════════════════════════════════════════════════════════════════
-- 0010 — ID próprio da maleta (independente do Bling) + referência do
-- fechamento nos lançamentos financeiros.
-- O ID oficial passa a ser "Mostruário #<numero_interno>" (sequência
-- global). O número do pedido Bling vira referência secundária/legado.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

create sequence if not exists public.maleta_num_seq start 1;

-- Maletas: número interno global (o campo "numero" existente é o
-- sequencial POR revendedora e continua como está).
alter table public.maletas add column if not exists numero_interno bigint;
update public.maletas set numero_interno = nextval('public.maleta_num_seq')
  where numero_interno is null;
alter table public.maletas alter column numero_interno set default nextval('public.maleta_num_seq');

-- Fechamentos: carimba o número interno da maleta fechada (legados ficam
-- null e o app cai no pedido Bling como referência).
alter table public.fechamentos_mostruario
  add column if not exists numero_interno bigint;

-- Lançamentos: referência denormalizada (evita join na listagem)
alter table public.financeiro_lancamentos
  add column if not exists numero_interno bigint,
  add column if not exists fechamento_data date;
