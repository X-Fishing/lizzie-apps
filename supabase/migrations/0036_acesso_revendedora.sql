-- ═══════════════════════════════════════════════════════════════════
-- 0036 — Acesso da revendedora: visibilidade e criação pelo admin
--
-- PROBLEMA QUE ISTO RESOLVE (recorrente, 3 casos): o admin pré-cadastra a
-- revendedora (linha em profiles com id aleatório, aprovada=true), mas isso
-- NÃO cria conta em auth.users. Resultado: ela aparece "ativa" na tela, tenta
-- Entrar e recebe "e-mail ou senha incorretos"; pedir "esqueci minha senha"
-- não envia nada (o Supabase ignora e-mail sem conta, para não revelar quem
-- existe). Ninguém no app enxergava isso.
--
-- Aqui entram as duas peças de banco:
--   1) fn_revendedoras_sem_acesso() → a tela do admin mostra o selo
--      "Sem acesso criado" em quem ainda não tem login.
--   2) fn_auth_uid_por_email() → usada SÓ pela Edge Function (service_role)
--      para saber se já existe conta com aquele e-mail antes de criar.
--
-- Segurança: nenhuma das duas é exposta a anônimo. A (1) só devolve dados
-- para staff autenticado (que já vê a lista de revendedoras — não é
-- enumeração). A (2) NÃO recebe grant nenhum: só o service_role a executa.
-- Rodar no SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Revendedoras SEM conta de acesso (para o selo na tela do admin).
--    Vincula por id (conta já adotada) OU por e-mail (pré-cadastro que ainda
--    será adotado pelo trigger handle_new_user no primeiro login dela).
create or replace function public.fn_revendedoras_sem_acesso()
returns setof uuid
language sql
security definer
set search_path = public, auth
as $$
  select p.id
    from public.profiles p
   where public.is_staff()                   -- só staff enxerga; senão vazio
     and p.is_revendedora
     and not exists (select 1 from auth.users u where u.id = p.id)
     and not exists (
           select 1 from auth.users u
            where p.email is not null
              and lower(u.email) = lower(p.email)
         );
$$;

revoke all on function public.fn_revendedoras_sem_acesso() from public, anon;
grant execute on function public.fn_revendedoras_sem_acesso() to authenticated;

-- 2) Procura a conta por e-mail. SEM grant para anon/authenticated: só o
--    service_role (Edge Function) chama. Se fosse exposta ao cliente seria
--    enumeração de usuários — por isso o revoke abaixo é essencial.
create or replace function public.fn_auth_uid_por_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select u.id from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;
$$;

revoke all on function public.fn_auth_uid_por_email(text) from public, anon, authenticated;

-- 3) Higiene do e-mail no pré-cadastro: o vínculo do trigger é por
--    lower(email), então espaço/maiúscula na ponta quebrava a adoção.
update public.profiles
   set email = lower(trim(email))
 where email is not null
   and email <> lower(trim(email));

-- 4) Impede dois cadastros com o mesmo e-mail (origem de "aprovei mas ela não
--    entra": aprovavam uma linha e ela logava na outra).
--    Defensivo: se já houver duplicado, NÃO derruba a migração — avisa para
--    limpar antes. Ver os duplicados com:
--      select lower(email), count(*) from public.profiles
--       where email is not null group by 1 having count(*) > 1;
do $$
declare n int;
begin
  select count(*) into n from (
    select lower(email) e from public.profiles
     where email is not null group by 1 having count(*) > 1
  ) d;
  if n > 0 then
    raise notice 'ATENCAO: % e-mail(s) duplicado(s) em profiles — indice unico NAO criado. Limpe os duplicados e rode este bloco de novo.', n;
  else
    create unique index if not exists profiles_email_uniq
      on public.profiles (lower(email)) where email is not null;
  end if;
end $$;
