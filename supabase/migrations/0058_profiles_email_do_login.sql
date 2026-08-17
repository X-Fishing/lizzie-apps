-- ════════════════════════════════════════════════════════════════════
-- 0058 — Preenche profiles.email a partir do e-mail do LOGIN.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run. Idempotente.
--
-- PROBLEMA: quem se cadastrou sozinha pelo app (aba "Cadastrar") entrava pelo
-- trigger handle_new_user, que só grava `email` no ramo de cadastro NOVO. No
-- ramo de ADOÇÃO de pré-cadastro ele move o id e não copia o e-mail — então
-- vários profiles ficaram com `email` nulo mesmo tendo conta funcionando.
--
-- CONSEQUÊNCIA PRÁTICA: `email` é a chave de várias ações do admin. Sem ele:
--   • o botão "Criar acesso / Redefinir senha" nem aparecia (admin.js checava
--     `r.email` para decidir se mostra);
--   • promover a funcionária falhava ("informe o e-mail antes");
--   • a detecção de cadastro duplicado não tinha por onde comparar.
-- Ou seja: revendedora com login funcionando e sem como ter a senha redefinida.
--
-- FONTE DA VERDADE aqui é o auth.users: é o endereço com que ela ENTRA. O
-- cadastro estava vazio, não divergente — não há nada para escolher.
--
-- ⚠️ NÃO TOCA em profile que já tem e-mail, mesmo divergente do login. Quando
-- os dois estão preenchidos e diferentes, é erro de digitação ou troca de
-- endereço, e quem decide qual vale é uma pessoa. Rode o diagnóstico do fim
-- do arquivo para ver esses casos.
-- ════════════════════════════════════════════════════════════════════

-- O `not exists` evita o índice único profiles_email_uniq: existe pelo menos
-- um caso de MESMA pessoa com dois profiles (um pré-cadastro com o e-mail e
-- outro real com o login). Preencher ali estouraria a constraint e derrubaria
-- a migração inteira — e a fusão dos dois cadastros é decisão humana.
update public.profiles p
   set email = lower(u.email)
  from auth.users u
 where u.id = p.id
   and p.email is null
   and u.email is not null
   and not exists (
     select 1 from public.profiles p2
      where lower(p2.email) = lower(u.email) and p2.id <> p.id
   );

-- ── DIAGNÓSTICO (rodar depois; o que sobrar precisa de decisão humana) ──
-- 1) Profiles que continuam sem e-mail porque o endereço já está em OUTRO
--    cadastro — provável duplicata da mesma pessoa:
--   select p.nome as sem_email, u.email,
--          (select p2.nome from public.profiles p2
--            where lower(p2.email) = lower(u.email) and p2.id <> p.id limit 1) as ja_existe_em
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.email is null;
--
-- 2) Cadastro e login com e-mails DIFERENTES (erro de digitação ou troca):
--   select p.nome, p.email as no_cadastro, u.email as no_login
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.email is not null and lower(p.email) is distinct from lower(u.email);
--
-- 3) Contas de login sem profile nenhum (lixo de tentativa que falhou):
--   select u.email, u.created_at::date, u.last_sign_in_at is not null as ja_entrou
--     from auth.users u
--    where not exists (select 1 from public.profiles p where p.id = u.id);

select pg_notify('pgrst', 'reload schema');
