-- ═══════════════════════════════════════════════════════════════════
-- 0038 — Telefone válido: regra ÚNICA no banco, normalização do cadastro,
--        flag de diagnóstico e blindagem do upsert da cliente.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
-- Rodar DEPOIS da 0033 (redefine cliente_upsert_para_venda).
--
-- PROBLEMA QUE ISTO RESOLVE: clientes.celular é a CHAVE de identidade
-- (0021:8 unique) e, por tabela, a chave da cartela de fidelidade (0028:36,
-- uma cartela aberta por cliente_id). Telefone falso (00000000000) fundia
-- pessoas diferentes na MESMA cartela e ainda sobrescrevia o nome da que já
-- estava lá. A validação vivia só no front — e mal (só "tem 10 dígitos").
--
-- A MESMA regra vive em src/utils.js (telValido/telNormalizado).
-- Mudou aqui, mude lá.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) Normalização canônica: só dígitos, sem DDI 55. NULL se vazio. ──
create or replace function public.tel_normalizado(p_tel text)
returns text language sql immutable set search_path = public as $$
  select nullif(case
           when length(d) in (12,13) and left(d,2) = '55' then substr(d,3)
           else d
         end, '')
    from (select regexp_replace(coalesce(p_tel,''), '\D', '', 'g') as d) s;
$$;

-- ── 2) DDDs válidos no Brasil (plano de numeração ANATEL) ────────────
create or replace function public.tel_ddd_valido(p_ddd text)
returns boolean language sql immutable set search_path = public as $$
  select p_ddd in (
    '11','12','13','14','15','16','17','18','19',
    '21','22','24','27','28',
    '31','32','33','34','35','37','38',
    '41','42','43','44','45','46','47','48','49',
    '51','53','54','55',
    '61','62','63','64','65','66','67','68','69',
    '71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89',
    '91','92','93','94','95','96','97','98','99');
$$;

-- ── 3) Regra ÚNICA de telefone brasileiro ────────────────────────────
--   10 díg. = fixo    (1º dígito do número 2..5)
--   11 díg. = celular (nono dígito '9' + faixa móvel 6..9)
--   Rejeita: todos iguais, corpo todo igual (90000-0000), sequência óbvia.
create or replace function public.tel_br_valido(p_tel text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  EXIGIR_FAIXA_MOVEL constant boolean := true;  -- desligue se reprovar número real
  v text; v_num text; v_corpo text; i int;
  v_cres boolean := true; v_decr boolean := true;
begin
  v := public.tel_normalizado(p_tel);
  if v is null or length(v) not in (10, 11) then return false; end if;
  if v ~ '^(.)\1+$' then return false; end if;                    -- 00000000000
  if not public.tel_ddd_valido(left(v, 2)) then return false; end if;

  v_num := substr(v, 3);                                          -- 8 ou 9 dígitos
  if length(v_num) = 9 then
    if left(v_num, 1) <> '9' then return false; end if;           -- nono dígito
    if EXIGIR_FAIXA_MOVEL and substr(v_num, 2, 1) not in ('6','7','8','9')
      then return false; end if;
    v_corpo := substr(v_num, 2);
  else
    if left(v_num, 1) not in ('2','3','4','5') then return false; end if;  -- fixo
    v_corpo := v_num;
  end if;

  if v_corpo ~ '^(.)\1+$' then return false; end if;              -- 9 0000-0000
  for i in 2 .. length(v_corpo) loop                              -- 12345678 / 87654321
    if ascii(substr(v_corpo,i,1)) <> ascii(substr(v_corpo,i-1,1)) + 1 then v_cres := false; end if;
    if ascii(substr(v_corpo,i,1)) <> ascii(substr(v_corpo,i-1,1)) - 1 then v_decr := false; end if;
  end loop;
  if v_cres or v_decr then return false; end if;

  return true;
end; $$;

-- ── 4) NORMALIZA clientes.celular (conserta o split por DDI) ─────────
--   O CRUD gravava com 55 e o PDV sem — a mesma pessoa virava 2 cadastros,
--   e a linha com 13 dígitos ficava invisível ao autocomplete.
--   Defensivo (padrão da 0036): se normalizar criaria duplicata na
--   unique(celular), NÃO altera nada — avisa para resolver à mão antes.
do $$
declare n int;
begin
  select count(*) into n from (
    select public.tel_normalizado(celular) c
      from public.clientes where celular is not null
     group by 1 having count(*) > 1
  ) d;
  if n > 0 then
    raise notice 'ATENCAO: % telefone(s) ficariam duplicados apos normalizar — NADA foi alterado. Rode o diagnostico (supabase/diagnostico-telefones.sql), funda as linhas a mao e rode este bloco de novo.', n;
  else
    update public.clientes
       set celular = public.tel_normalizado(celular)
     where celular is not null
       and celular is distinct from public.tel_normalizado(celular);
  end if;
end $$;

-- ── 5) Flag de diagnóstico (só SINALIZA — nada é apagado nem desmembrado) ──
alter table public.clientes
  add column if not exists telefone_invalido boolean not null default false;

create or replace function public.clientes_marca_tel_invalido()
returns trigger language plpgsql set search_path = public as $$
begin
  new.telefone_invalido := (new.celular is not null and not public.tel_br_valido(new.celular));
  return new;
end; $$;

drop trigger if exists clientes_marca_tel_invalido_trg on public.clientes;
create trigger clientes_marca_tel_invalido_trg
  before insert or update of celular on public.clientes
  for each row execute function public.clientes_marca_tel_invalido();

-- Backfill das linhas que já existem.
update public.clientes
   set telefone_invalido = (celular is not null and not public.tel_br_valido(celular))
 where telefone_invalido is distinct from (celular is not null and not public.tel_br_valido(celular));

-- ── 6) Normalizador de nome (para a regra "só enriquece") ────────────
create or replace function public.nome_norm(p text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(regexp_replace(coalesce(p,''), '\s+', ' ', 'g')));
$$;

-- ── 7) cliente_upsert_para_venda BLINDADA ────────────────────────────
--   • telefone inválido → NULL: a venda segue SEM cliente (sem selos), em vez
--     de fundir duas pessoas no mesmo cadastro.
--   • nome → só ENRIQUECE (Ana → Ana Paula Souza). Nunca troca por um nome
--     diferente: era o 'set nome = excluded.nome' da 0033, que apagava a
--     evidência da fusão (a venda da Joana renomeava a cliente Maria).
create or replace function public.cliente_upsert_para_venda(
  p_nome text, p_celular text, p_nasc date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cel text; v_id uuid;
begin
  v_cel := public.tel_normalizado(p_celular);
  if not public.tel_br_valido(v_cel) or coalesce(btrim(p_nome), '') = '' then
    return null;
  end if;
  insert into clientes (nome, celular, data_nascimento, criado_por)
  values (btrim(p_nome), v_cel, p_nasc, auth.uid())
  on conflict (celular) do update
    set nome = case
                 when public.nome_norm(excluded.nome)
                      like public.nome_norm(clientes.nome) || '%'
                  and length(public.nome_norm(excluded.nome))
                      > length(public.nome_norm(clientes.nome))
                   then btrim(excluded.nome)
                 else clientes.nome
               end,
        data_nascimento   = coalesce(excluded.data_nascimento, clientes.data_nascimento),
        telefone_invalido = false          -- conflitou ⇒ o celular passou na regra
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.cliente_upsert_para_venda(text,text,date) from public;
grant  execute on function public.cliente_upsert_para_venda(text,text,date) to authenticated;
