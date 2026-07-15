-- ═══════════════════════════════════════════════════════════════════
-- 0017 — Endereço do fiador estruturado (CEP/logradouro/número/...) igual
-- ao da revendedora, para o ViaCEP e o contrato. A coluna antiga
-- revendedora_docs.fiador_endereco continua existindo (retrocompat: o app
-- grava nela a linha montada e lê dela como fallback dos legados).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

alter table public.revendedora_docs
  add column if not exists fiador_cep         text,
  add column if not exists fiador_logradouro  text,
  add column if not exists fiador_numero      text,
  add column if not exists fiador_complemento text,
  add column if not exists fiador_bairro      text,
  add column if not exists fiador_cidade      text,
  add column if not exists fiador_estado      text;
