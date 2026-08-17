# Fase 5 — Critérios de aceite

A tela **Clientes** do staff (menu Vendas → Clientes) passa a mostrar o histórico comercial
de cada cliente e a editar pela mesma RPC que a revendedora usa.

Contexto mínimo: app PWA (Vite + JS puro + Supabase) da Lizzie Semijoias.
A RPC `cliente_editar` foi criada na migração `0056` (fase anterior) e **não** está
aplicada no banco — avalie o SQL por leitura.

## Critérios

### Conteúdo da tela
1. A tabela mostra, por cliente: nome, telefone, **quais revendedoras já venderam para
   ela**, número de compras, total gasto e data da última compra.
2. Cliente sem nenhuma compra aparece na lista (com os números zerados/traço), não some.
3. A busca também encontra por nome de revendedora, além de nome/telefone/cidade/e-mail.
4. A busca não faz o campo perder o foco enquanto se digita.
5. Clicar na linha abre a tela da cliente (`#/cliente/:id`), com as compras de todas as
   revendedoras. Os botões de editar/excluir na linha **não** disparam essa navegação.
6. O aniversário é exibido como `dd/mm`.

### Correção de dado — o ponto crítico
7. As vendas usadas para montar os números são buscadas com **paginação**. O PostgREST
   corta em 1000 linhas: sem paginar, clientes antigas apareceriam com "0 compras" sem
   nenhum aviso. Buscar sem paginar é REPROVAÇÃO.
8. Editar uma cliente passa pela RPC `cliente_editar` — **não** por `update` direto na
   tabela `clientes`.
9. Como consequência do 8: o admin que tenta gravar um telefone que já é de outra cliente
   recebe uma mensagem em português explicando, e **nada é gravado**. Não pode aparecer
   mensagem crua do Postgres (`duplicate key value violates unique constraint...`).
10. Criar cliente NOVA continua funcionando (a RPC só edita; a criação é insert direto).
    Criar com um celular que já existe mostra mensagem clara.
11. Excluir cliente continua restrito ao gestor pela policy do banco, e a confirmação
    avisa quando a cliente tem compras registradas.

### Sanidade
12. `npm run build` e `npm run lint` passam.
13. Toda função usada em `onclick=`/`oninput=` está registrada no `Object.assign(window,
    ...)` de `src/main.js`, importada e exportada. O lint verde NÃO prova isso.
14. Não sobrou função órfã: nada importado/registrado que não exista mais, nem o contrário.
15. Todo dado do banco interpolado em `innerHTML` passa por `esc()`.
16. O formulário de edição é **um só**, compartilhado com a tela da revendedora — não
    pode haver duas cópias do mesmo formulário com regras que possam divergir.
17. O número de colunas do `colspan` do estado vazio bate com o número real de colunas da
    tabela.
