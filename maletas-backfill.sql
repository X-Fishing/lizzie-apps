-- ════════════════════════════════════════════════════════════════════
-- BACKFILL — vincula/cria a maleta ATIVA para toda revendedora com peças
-- ativas sem maleta (catálogos legados: importados do Bling ou criados
-- fora do Lançador). Idempotente e seguro (respeita o índice de 1 ativa).
-- Rodar 1x no SQL Editor. Rodar de novo é inofensivo (não faz nada).
-- ════════════════════════════════════════════════════════════════════
do $$
declare r record; m uuid;
begin
  for r in select distinct revendedora_id from public.consignados
           where status = 'ativo' and maleta_id is null loop
    select id into m from public.maletas
      where revendedora_id = r.revendedora_id and status = 'ativa' limit 1;
    if m is null then
      insert into public.maletas (revendedora_id, status, numero)
        values (r.revendedora_id, 'ativa', 1) returning id into m;
    end if;
    update public.consignados set maleta_id = m
      where revendedora_id = r.revendedora_id and status = 'ativo' and maleta_id is null;
  end loop;
end $$;

-- DIAGNÓSTICO — deve voltar 0 após o backfill:
-- select count(*) from public.consignados where status='ativo' and maleta_id is null;
