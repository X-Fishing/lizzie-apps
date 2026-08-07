-- 0054 — Local da troca de mostruário.
--
-- O design "Lizzie Mobile Revendedora" mostra a linha "Local" no card da
-- Próxima troca ("Loja — Centro"). Data e horário já existem (0053); faltava
-- onde a troca acontece — e isso varia: loja, casa da revendedora, um ponto
-- combinado. Texto livre porque não há uma lista fechada de locais.
--
-- Nullable de propósito: maletas antigas continuam válidas e a tela da
-- revendedora simplesmente omite a linha quando está vazio.

alter table public.maletas add column if not exists local_troca text;

comment on column public.maletas.local_troca is
  'Onde a troca de mostruário acontece (texto livre). Preenchido no Lançador; a revendedora vê em Próxima troca.';
