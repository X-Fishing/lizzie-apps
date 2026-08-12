# PROMPT — Log de auditoria para exclusões (banco + tela admin)

## Contexto
Em 12/08/2026 a maleta/vendas da revendedora Stéfanny Passos apareceram
zeradas sem explicação recuperável — não dava pra saber, só olhando as
tabelas vivas, se algo foi apagado (hard delete não deixa rastro) ou se
nunca existiu. Isso não pode se repetir sem deixar prova.

**Objetivo**: qualquer `DELETE` nas tabelas sensíveis do app fica registrado
automaticamente (quem, quando, tabela, dado completo da linha apagada),
de forma que **nenhum caminho de código consiga apagar sem deixar rastro**
— nem um botão existente, nem um bug futuro, nem um DELETE manual rodado
direto no SQL Editor por um admin.

## Passo 1 — Migration SQL

Criar `supabase/migrations/00XX_audit_log_exclusoes.sql` (adote o próximo
número livre da pasta `supabase/migrations/`, mesmo padrão dos demais:
cabeçalho com contexto + "COMO APLICAR: Supabase → SQL Editor → Run" +
idempotente).

### A) Tabela `audit_log`
```sql
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  acao        text not null,           -- 'delete' (deixar aberto p/ 'update' no futuro)
  tabela      text not null,
  registro_id text,                    -- id da linha apagada, como texto (PKs são uuid)
  dados       jsonb not null,          -- snapshot completo da linha (to_jsonb(OLD))
  ator_id     uuid,                    -- auth.uid() de quem executou
  ator_nome   text,                    -- resolvido no momento (profiles.nome / funcionarios.nome), pra não depender de join depois
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_tabela on public.audit_log(tabela, created_at desc);
create index if not exists idx_audit_log_ator on public.audit_log(ator_id);
```

### B) Função de gatilho genérica (SECURITY DEFINER)
Precisa ser `security definer` porque quem dispara o DELETE (ex.: um
`func_completo`) não tem — e não deve ter — permissão de INSERT em
`audit_log`; só o próprio gatilho grava.
```sql
create or replace function public.fn_audit_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  select coalesce(p.nome, f.nome) into v_nome
    from public.profiles p
    full outer join public.funcionarios f on f.auth_user_id = auth.uid()
   where p.id = auth.uid()
   limit 1;

  insert into public.audit_log (acao, tabela, registro_id, dados, ator_id, ator_nome)
  values ('delete', TG_TABLE_NAME, OLD.id::text, to_jsonb(OLD), auth.uid(), v_nome);

  return OLD;
end;
$$;
```
Obs.: todas as tabelas alvo abaixo têm coluna `id`. Se alguma não tiver
(confira antes), ajustar o `registro_id` pra essa tabela específica.

### C) Anexar o gatilho nas tabelas sensíveis
Uma tabela = um `AFTER DELETE FOR EACH ROW`. Rodar para cada uma (o `drop
trigger if exists` antes torna idempotente):
```sql
do $$
declare
  t text;
begin
  foreach t in array array[
    'maletas','consignados','vendas','venda_itens','venda_pagamentos',
    'recebimentos','produtos','clientes','financeiro_lancamentos',
    'fidelidade_selos','fidelidade_cartelas','fidelidade_premios'
  ]
  loop
    execute format('drop trigger if exists trg_audit_delete on public.%I', t);
    execute format(
      'create trigger trg_audit_delete after delete on public.%I
       for each row execute function public.fn_audit_log_delete()', t);
  end loop;
end $$;
```

### D) RLS — só admin lê, ninguém edita/apaga (log imutável)
```sql
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ( public.is_admin() );
-- Sem policy de insert/update/delete para authenticated: só o trigger
-- (security definer, roda como owner) consegue gravar. Ninguém edita depois.
revoke all on public.audit_log from public;
grant select on public.audit_log to authenticated; -- RLS acima filtra quem realmente vê
```

Terminar a migration com `select pg_notify('pgrst', 'reload schema');`

### E) Teste manual (incluir como comentário no fim do arquivo)
```sql
-- delete from public.produtos where id = '<algum id de teste>';
-- select * from public.audit_log order by created_at desc limit 1;
-- (deve aparecer a linha inteira apagada em `dados`, com seu nome em ator_nome)
```

## Passo 2 — Tela "Auditoria" no admin (só quem é `admin`, não `func_completo`)

Seguir o mesmo padrão das outras telas admin-only do projeto (ver
`cad_funcionarios` / `cad_perfis` em `src/menu.js` — ambas usam
`admin_only: true`).

1. **Menu** (`src/menu.js`): adicionar no grupo `grp_cadastros`
   (seção "Configurações"):
   ```js
   { chave: 'cad_auditoria', panel: 'auditoria', label: 'Auditoria', icon: IC.shield, admin_only: true },
   ```

2. **Painel novo** — criar `src/auditoria.js` seguindo o mesmo formato de
   carregamento/paginação/render que os outros módulos de listagem usam
   (ex.: `fetchPaginado`, `sbQ`, `esc()` pra qualquer texto vindo do banco,
   `formatDate` pros timestamps). A tela deve ter:
   - Lista das entradas mais recentes primeiro (`order by created_at desc`).
   - Colunas: **Quando** (data/hora formatada), **Quem** (`ator_nome`),
     **Tabela**, **Registro** (uma descrição amigável tirada de `dados`
     quando existir campo óbvio tipo `descricao`/`nome`/`nome_cliente` —
     senão mostrar o `registro_id`).
   - Clique na linha expande/abre modal com o JSON completo de `dados`
     (só leitura — usar `<pre>` ou similar, sem permitir editar).
   - Filtros simples: por tabela (select) e por período (dois campos de
     data), reaproveitando os componentes de filtro já usados em outras
     telas do projeto (ex. financeiro.js) em vez de criar um padrão novo.
   - **Sem nenhuma ação de escrita nessa tela** — é só consulta. Não
     precisa (e não deve) ter botão de excluir/editar aqui.

3. **Registro no app** (`src/main.js`): expor as funções chamadas via
   `on*` no HTML dentro do `Object.assign(window, {...})` existente — sem
   comentários dentro desse bloco (quebra o parser do ESLint que deriva os
   globais dali).

4. **Roteamento do painel**: seguir o mesmo mecanismo que os demais
   `panel-*` usam hoje (ver `src/nav.js` / `showPanel`) — adicionar o
   `panel-auditoria` no HTML estático e o load correspondente no ponto
   onde os outros painéis são despachados.

## Fora de escopo (não fazer agora)
- Não logar `UPDATE`, só `DELETE` por enquanto — é o que causou o
  incidente. Auditoria de update pode ser um prompt separado depois.
- Não adicionar as tabelas de cadastro de baixo risco (`categorias`,
  `colecoes`, `fornecedores`, `formas_pagamento`) — a lista do Passo 1C já
  cobre onde exclusão é sensível. Se quiser ampliar depois, é só repetir a
  mesma linha no array do bloco `do $$`.
