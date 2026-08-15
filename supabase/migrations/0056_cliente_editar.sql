-- ════════════════════════════════════════════════════════════════════
-- 0056 — A REVENDEDORA passa a editar o cadastro das clientes DELA.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente. Rodar DEPOIS da 0055 (usa aniversario_dia/mes).
--
-- PROBLEMA: a revendedora tem SELECT nas clientes para quem já vendeu
-- (0028:105-109) e ZERO escrita — a RLS de `clientes` é staff-only para
-- insert/update (0021:23-28). Quando ela erra o nome no PDV ou a cliente troca
-- de número, ela não tem como consertar: precisa pedir para a administração.
--
-- POR QUE UMA RPC E NÃO UMA POLICY: escrita barrada pela RLS volta
-- "HTTP 200 com lista vazia", em SILÊNCIO (armadilha documentada em 0040:5-10
-- e confirmada em teste — PENDENCIAS.md:39). Uma policy nova também abriria a
-- escrita para o PostgREST inteiro, sem lugar para pôr a trava de colisão de
-- telefone. Toda escrita continua passando por SECURITY DEFINER.
--
-- TRAVA DE COLISÃO: `clientes.celular` é UNIQUE e é a chave da cartela de
-- fidelidade (0028:36 — uma cartela aberta por cliente_id). Deixar alguém
-- gravar um número que já é de outra cliente fundiria duas pessoas na mesma
-- cartela. Aqui a troca é RECUSADA com mensagem clara — juntar cadastro é
-- operação de admin e não acontece por acidente numa edição de nome.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Auditoria (padrão do projeto: <verbo>_em / <verbo>_por, igual 0039) ──
alter table public.clientes
  add column if not exists atualizado_por uuid,
  add column if not exists atualizado_em  timestamptz;

-- ── 2) A RPC ─────────────────────────────────────────────────────────
--   Autorização no SERVIDOR (a UI é só conveniência):
--     staff  OU  a revendedora que já vendeu para esta cliente.
--   Passar '' (string vazia) em cidade/email/observação LIMPA o campo;
--   passar NULL mantém o que está lá. Sem isso não há como apagar um dado
--   errado, e com null-como-limpeza a UI apagaria tudo sem querer.
create or replace function public.cliente_editar(
  p_cliente_id uuid,
  p_nome       text,
  p_tel        text default null,
  p_dia        int  default null,
  p_mes        int  default null,
  p_cidade     text default null,
  p_email      text default null,
  p_obs        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_atual  record;
  v_cel    text;
  v_pode   boolean;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;

  select * into v_atual from clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente nao encontrada'; end if;

  v_pode := public.is_staff()
         or exists (select 1 from vendas v
                     where v.cliente_id = p_cliente_id
                       and v.revendedora_id = auth.uid());
  if not v_pode then
    raise exception 'Voce so pode editar as clientes para quem ja vendeu';
  end if;

  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome da cliente';
  end if;

  -- Telefone: vazio → null (a coluna é unique, mas nulos não colidem — mesma
  -- regra do CRUD do staff). Preenchido → tem de ser um número real.
  v_cel := public.tel_normalizado(p_tel);
  if v_cel is not null and not public.tel_br_valido(v_cel) then
    raise exception 'Telefone invalido — informe um numero real com DDD';
  end if;

  if v_cel is not null and v_cel is distinct from v_atual.celular
     and exists (select 1 from clientes
                  where celular = v_cel and id <> p_cliente_id) then
    raise exception 'Este WhatsApp ja e de outra cliente — fale com a administracao para juntar os cadastros';
  end if;

  if not public.aniversario_valido(p_dia, p_mes) then
    raise exception 'Aniversario invalido — informe dia e mes (ex.: 07/03)';
  end if;

  update clientes
     set nome            = btrim(p_nome),
         celular         = v_cel,
         aniversario_dia = p_dia,
         aniversario_mes = p_mes,
         cidade          = case when p_cidade is null then cidade     else nullif(btrim(p_cidade), '') end,
         email           = case when p_email  is null then email      else nullif(btrim(p_email),  '') end,
         observacao      = case when p_obs    is null then observacao else nullif(btrim(p_obs),    '') end,
         atualizado_por  = auth.uid(),
         atualizado_em   = now()
   where id = p_cliente_id;

  return to_jsonb((select c from clientes c where c.id = p_cliente_id));
end; $$;
revoke all on function public.cliente_editar(uuid,text,text,int,int,text,text,text) from public, anon;
grant  execute on function public.cliente_editar(uuid,text,text,int,int,text,text,text) to authenticated;

-- DIAGNÓSTICO (rodar e conferir):
-- select nome, celular, aniversario_dia, aniversario_mes, atualizado_em
--   from public.clientes where atualizado_em is not null order by atualizado_em desc limit 10;

select pg_notify('pgrst', 'reload schema');
