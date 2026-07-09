-- ═══════════════════════════════════════════════════════════════════
-- 0004 — Produto com até 5 imagens
-- Array de URLs (imagens[1] = principal). foto_url continua existindo e
-- SEMPRE sincronizado com a principal, para não quebrar as telas que já
-- leem foto_url (grid, lançador, conferência, PDF, Bling import).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

alter table public.produtos
  add column if not exists imagens text[] not null default '{}';

-- backfill: joga a imagem existente para dentro do array (se ainda não estiver)
update public.produtos
set imagens = array[foto_url]
where foto_url is not null and foto_url <> ''
  and (imagens is null or array_length(imagens, 1) is null);
