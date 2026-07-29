-- ═══════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO DE TELEFONES / CLIENTES CONTAMINADAS
-- NÃO é migração: nada aqui altera dados. Rode no SQL Editor quando quiser.
--
-- Contexto: clientes.celular é a CHAVE de identidade da cliente e da cartela
-- de fidelidade. Telefone inventado ((00)00000-0000) fundia pessoas
-- diferentes no mesmo cadastro — e o nome era sobrescrito pela última venda.
-- ═══════════════════════════════════════════════════════════════════

-- ── PRÉ-VOO 1: quantos números seriam reprovados, por motivo ─────────
-- Rode ANTES da migração 0038. Se "fora_faixa_movel" for alto, avalie
-- desligar EXIGIR_FAIXA_MOVEL na 0038 e em src/utils.js.
select count(*) filter (where celular is null)                                    as sem_celular,
       count(*) filter (where celular is not null
              and length(regexp_replace(celular,'\D','','g')) not in (10,11,12,13)) as tamanho_estranho,
       count(*) filter (where regexp_replace(celular,'\D','','g') ~ '^(.)\1+$')   as todos_iguais,
       count(*) filter (where length(regexp_replace(celular,'\D','','g')) = 11
              and substr(regexp_replace(celular,'\D','','g'),4,1) not in ('6','7','8','9')) as fora_faixa_movel,
       count(*) filter (where length(regexp_replace(celular,'\D','','g')) = 10)    as fixos,
       count(*)                                                                    as total
  from public.clientes;

-- ── PRÉ-VOO 2: MESMA pessoa em 2 linhas (uma com DDI 55, outra sem) ──
-- Se voltar linhas, RESOLVA À MÃO antes da 0038 (ela normaliza em massa e
-- o bloco defensivo se recusa a rodar enquanto houver colisão).
select case when length(d) in (12,13) and left(d,2)='55' then substr(d,3) else d end as canonico,
       count(*) as linhas, array_agg(id) as ids, array_agg(nome) as nomes, array_agg(celular) as celulares
  from (select id, nome, celular, regexp_replace(coalesce(celular,''),'\D','','g') d
          from public.clientes where celular is not null) x
 group by 1 having count(*) > 1;

-- ═══ RELATÓRIO: clientes possivelmente CONTAMINADAS ═══
-- INDEPENDENTE: roda ANTES ou DEPOIS da migração 0038 (a regra de telefone
-- está embutida aqui, não chama tel_br_valido). É justamente antes de migrar
-- que ele mostra o tamanho do estrago.
--
-- COMO LER:
--   nomes_distintos >= 2  +  qtd_revendedoras >= 2  → assinatura da FUSÃO:
--       pessoas diferentes, revendedoras diferentes, mesmo telefone-lixo.
--   premios_pendentes > 0 numa linha dessas → dinheiro (R$300) prestes a ir
--       para a pessoa errada. É a prioridade de revisão manual.
--
-- Obs.: aqui a checagem é a essencial (tamanho, dígitos repetidos, DDD, nono
-- dígito). A regra completa (faixa móvel, sequências tipo 91234-5678) é a da
-- função tel_br_valido — depois da 0038, veja a variante no fim do arquivo.
with cli as (
  select c.id, c.nome, c.celular,
         case when length(regexp_replace(coalesce(c.celular,''),'\D','','g')) in (12,13)
               and left(regexp_replace(coalesce(c.celular,''),'\D','','g'),2) = '55'
              then substr(regexp_replace(coalesce(c.celular,''),'\D','','g'),3)
              else regexp_replace(coalesce(c.celular,''),'\D','','g')
         end as cel
    from public.clientes c
   where c.celular is not null
), cli2 as (
  select cli.*,
         (length(cel) in (10,11)
          and cel !~ '^(.)\1+$'                       -- 00000000000
          and left(cel,2) in ('11','12','13','14','15','16','17','18','19',
                              '21','22','24','27','28','31','32','33','34','35','37','38',
                              '41','42','43','44','45','46','47','48','49',
                              '51','53','54','55','61','62','63','64','65','66','67','68','69',
                              '71','73','74','75','77','79','81','82','83','84','85','86','87','88','89',
                              '91','92','93','94','95','96','97','98','99')
          and (length(cel) = 10 or substr(cel,3,1) = '9')   -- nono dígito
         ) as telefone_ok
    from cli
), v as (
  select v.cliente_id,
         count(*)                                                    as qtd_vendas,
         count(distinct lower(btrim(regexp_replace(coalesce(v.nome_cliente,''),'\s+',' ','g')))) as nomes_distintos,
         array_agg(distinct v.nome_cliente order by v.nome_cliente)  as nomes_em_vendas,
         count(distinct v.revendedora_id)                            as qtd_revendedoras,
         min(v.data_venda)                                           as primeira_venda,
         max(v.data_venda)                                           as ultima_venda,
         sum(v.valor_total)                                          as total_vendido
    from public.vendas v
   where v.cliente_id is not null
   group by v.cliente_id
)
select c.id,
       c.nome                          as nome_no_cadastro,
       c.celular,
       c.telefone_ok,
       length(c.cel)                   as digitos,
       coalesce(v.qtd_vendas, 0)       as qtd_vendas,
       coalesce(v.nomes_distintos, 0)  as nomes_distintos,
       v.nomes_em_vendas,
       coalesce(v.qtd_revendedoras, 0) as qtd_revendedoras,
       coalesce((select sum(s.quantidade) from public.fidelidade_selos s
                  where s.cliente_id = c.id), 0)                       as selos_total,
       (select count(*) from public.fidelidade_cartelas ca
         where ca.cliente_id = c.id)                                   as cartelas,
       (select ca.selos from public.fidelidade_cartelas ca
         where ca.cliente_id = c.id and ca.status = 'aberta')          as selos_cartela_aberta,
       (select count(*) from public.fidelidade_cartelas ca
         where ca.cliente_id = c.id and ca.status = 'completa')        as cartelas_completas,
       (select count(*) from public.fidelidade_premios p
         where p.cliente_id = c.id and p.status = 'pendente')          as premios_pendentes,
       (select count(*) from public.fidelidade_premios p
         where p.cliente_id = c.id and p.status = 'resgatado')         as premios_resgatados,
       v.primeira_venda, v.ultima_venda, v.total_vendido
  from cli2 c
  left join v on v.cliente_id = c.id
 where not c.telefone_ok or coalesce(v.nomes_distintos, 0) > 1
 order by coalesce(v.nomes_distintos, 0) desc,
          coalesce(v.qtd_vendas, 0)      desc;

-- ── VARIANTE (só DEPOIS da 0038): usa a regra COMPLETA da função ─────
-- Pega também faixa móvel inválida e sequências (91234-5678).
-- select id, nome, celular, public.tel_br_valido(celular) as telefone_ok
--   from public.clientes
--  where celular is not null and not public.tel_br_valido(celular)
--  order by nome;

-- ── CONFERÊNCIA DE INTEGRIDADE (deve voltar ZERO linhas) ────────────
-- A soma dos selos tem de bater com o contador da cartela.
select c.id, c.selos, coalesce(sum(s.quantidade), 0) as soma
  from public.fidelidade_cartelas c
  left join public.fidelidade_selos s on s.cartela_id = c.id
 group by c.id, c.selos
having c.selos <> coalesce(sum(s.quantidade), 0);
