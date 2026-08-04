-- 0043 — Excluir produto passa a ser exclusividade do ADMIN.
--
-- Contexto: a grid de Produtos ganhou exclusão em massa, e o pedido do dono é
-- que apagar produto só apareça no login admin. A trava na tela (botão que nem
-- é montado pra quem não é admin) é de UI — não protege a API. Quem tem
-- func_completo continuava podendo apagar chamando o PostgREST direto, porque a
-- policy de delete criada em produtos-schema.sql usa is_gestor() (admin OU
-- func_completo). Aqui a policy de DELETE dessas tabelas passa pra is_admin().
--
-- O que NÃO muda: select (staff), insert e update (gestor) seguem iguais — o
-- funcionário continua cadastrando, editando, clonando e usando as ações em
-- massa de categoria/fornecedor/ativar/inativar. Só o apagar é que sobe de nível.

do $$
declare t text;
begin
  foreach t in array array['produtos', 'produto_variacoes'] loop
    -- só age se a tabela existir (ambientes que ainda não rodaram o schema)
    if to_regclass('public.' || t) is null then continue; end if;

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      $f$create policy %I on public.%I for delete to authenticated using ( public.is_admin() )$f$,
      t || '_delete', t);
  end loop;
end $$;

-- PostgREST guarda o schema em cache; sem isso a mudança pode demorar a valer.
select pg_notify('pgrst', 'reload schema');
