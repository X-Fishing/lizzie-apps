-- 0050 — Data de troca da maleta (coluna que o app já usava sem existir)
--
-- COMO APLICAR: Supabase → SQL Editor → cole e Run. Idempotente: pode rodar
-- mais de uma vez sem efeito colateral.
--
-- Contexto: o app já lê e grava `maletas.data_troca` (lancador.js, trocas.js)
-- e `profiles.troca_resolvida_em` (trocas.js, consignados.js) há vários
-- commits, mas nenhuma das duas colunas foi criada por migration — a gravação
-- era feita ignorando o retorno do supabase-js, então o valor digitado pela
-- pessoa era descartado em silêncio. Esta migration cria as duas e passa a
-- fazer a tela de Trocas mostrar datas de verdade.
--
-- Sem policy nova: `maletas_update` já exige is_gestor() e
-- `profiles_update_staff` (0042) já cobre linhas de revendedora.

alter table public.maletas
  add column if not exists data_troca date;

comment on column public.maletas.data_troca is
  'Data prevista da proxima troca de mostruario. Sugerida em hoje+35d no lancador, editavel, pode ficar nula.';

alter table public.profiles
  add column if not exists troca_resolvida_em timestamptz;

comment on column public.profiles.troca_resolvida_em is
  'Quando a troca foi marcada como resolvida na tela de Trocas. Comparada com a criacao da maleta para saber se a resolucao ainda vale.';

-- A tela de Trocas varre só as maletas ativas; o índice parcial mantém isso
-- barato conforme o histórico de maletas finalizadas cresce.
create index if not exists maletas_data_troca_idx
  on public.maletas (data_troca) where status = 'ativa';

-- PostgREST cacheia o schema; sem isso a coluna nova só aparece no próximo
-- restart da API.
select pg_notify('pgrst', 'reload schema');
