# PROMPT — Autocomplete da cliente pelo telefone na finalização da venda

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> **Pré-requisito:** a feature de fidelidade já está implementada (tabela `clientes` com `telefone` único, `vendas.cliente_id`, `fidelidade_cartelas`).
> Escopo: só a tela de **dados da cliente** na finalização da venda (app da revendedora) + 1 função no banco. Commit no fim. Teste local.

## Problema
A mesma cliente compra várias vezes ao longo do tempo, e hoje a revendedora precisa **redigitar todos os dados a cada venda**. É trabalhoso e gera cadastro duplicado/inconsistente.

## Objetivo
O **telefone é a chave única** da cliente. Ao digitá-lo, o app **preenche o resto sozinho**.

---

## 1. Reordenar os campos
Na tela de dados da cliente (após finalizar o carrinho), o **TELEFONE passa a ser o PRIMEIRO campo**, antes do nome. Ele é o gatilho do autocomplete, então precisa vir primeiro.

- Máscara BR: `(00) 00000-0000`; validar 10–11 dígitos + DDD.
- Normalizar para `55DDDNNNNNNNNN` ao gravar (mesma normalização já usada no cadastro de clientes — reaproveitar o helper existente; se não houver, criar um só).
- Dar `autofocus` no campo de telefone ao abrir a tela.

## 2. Função no banco (busca segura por telefone exato)
⚠️ **Não fazer `select` direto em `clientes`**: a RLS só deixa a revendedora ver clientes para quem ela já vendeu, mas o autocomplete precisa achar também a cliente que comprou com **outra** revendedora (senão duplica cadastro).

Criar esta RPC (arquivo `fidelidade-schema.sql` ou um novo `.sql` — rodar no Supabase):

```sql
-- Busca EXATA por telefone (não lista, não faz busca parcial).
-- Devolve só o mínimo para o autocomplete do PDV.
create or replace function public.buscar_cliente_por_telefone(p_telefone text)
returns table (id uuid, nome text, selos integer, cartela_numero integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, coalesce(f.selos, 0), coalesce(f.numero, 1)
  from public.clientes c
  left join public.fidelidade_cartelas f
    on f.cliente_id = c.id and f.status = 'aberta'
  where c.telefone = p_telefone
  limit 1;
$$;
revoke all on function public.buscar_cliente_por_telefone(text) from public;
grant execute on function public.buscar_cliente_por_telefone(text) to authenticated;
```
Só faz match **exato do telefone completo** e devolve apenas nome + progresso da cartela — quem não souber o número inteiro não descobre nada, e continua impossível listar a base.

## 3. Comportamento do autocomplete (front)
No módulo da venda (`src/consignados.js`, fluxo de finalizar):

- Ao digitar o telefone, com **debounce de ~400ms**, quando houver 10–11 dígitos, chamar:
  ```js
  const { data } = await sb.rpc('buscar_cliente_por_telefone', { p_telefone: telefoneNormalizado });
  const cli = data && data[0];
  ```
- **Se encontrou (`cli`)**:
  - Preencher o campo **nome** com `cli.nome` (mantendo-o **editável**).
  - Mostrar um selo discreto acima/ao lado: **"Cliente já cadastrada · {cli.selos}/10 selos"**.
  - Guardar `cli.id` em estado para usar no salvamento.
- **Se não encontrou**:
  - Deixar o nome vazio e focar nele automaticamente.
  - Mostrar **"Nova cliente"** (estilo neutro/discreto).
- Durante a busca, indicar carregando de forma discreta (não travar o campo).
- Se a revendedora **alterar o nome** de uma cliente existente, ao salvar o cadastro é **atualizado** (o telefone continua sendo a chave — nunca criar cliente nova por causa de nome diferente).

Mostrar o progresso da cartela **antes** de fechar a venda é proposital: dá argumento pra revendedora ("faltam 2 selos pra você ganhar R$300").

## 4. Salvamento
Manter o upsert por telefone que já existe. Se `cli.id` foi encontrado, usar esse `cliente_id` na venda (evita corrida/duplicata).

---

## Validar / commitar
```bash
npm run lint
npm run build
git add -A
git commit -m "feat(venda): telefone como 1o campo + autocomplete da cliente por telefone"
git push origin main
```
Rodar a RPC no Supabase (dev e produção).

## Teste
1. Telefone de cliente existente → nome preenche sozinho + mostra "Cliente já cadastrada · X/10 selos".
2. Telefone novo → "Nova cliente", nome vazio e focado.
3. Cliente cadastrada por **outra** revendedora → é encontrada pelo telefone exato, mas a revendedora continua **sem** conseguir listar clientes de terceiros.
4. Editar o nome de cliente existente e salvar → cadastro atualizado, **sem** criar cliente duplicada.
5. Telefone incompleto → não dispara busca; venda não deixa concluir sem telefone válido.
