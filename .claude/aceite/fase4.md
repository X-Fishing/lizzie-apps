# Fase 4 — Critérios de aceite

Nova tela **"Minhas Clientes"** para a REVENDEDORA, no grupo "Vendas" do menu gaveta,
com edição do cadastro da cliente. Escrita nova no banco pela RPC `cliente_editar`
(`supabase/migrations/0056_cliente_editar.sql` — **não** foi aplicada no banco ainda;
avalie o SQL por leitura).

Contexto mínimo: app PWA (Vite + JS puro + Supabase) da Lizzie Semijoias, SPA com
roteamento por hash. Papéis: `admin`, `func_completo`, `func_basico` (os três são "staff")
e `revendedora`. A revendedora navega por um menu gaveta; o staff, por uma sidebar.

## Critérios

### Menu e acesso
1. "Minhas Clientes" aparece como subitem do grupo **Vendas** no menu gaveta da
   revendedora, e clicar nele abre a tela.
2. Quando a tela está ativa, o grupo "Vendas" da gaveta abre sozinho e o item fica
   marcado como ativo.
3. O **staff NÃO** acessa "Minhas Clientes" — nem por menu, nem digitando a rota na URL
   (deve cair em outra tela). Existe um guard explícito para isso.
4. O painel novo é escondido quando outra tela é aberta.

### Escopo
5. A revendedora vê **apenas** as clientes para quem ela já vendeu. O filtro é feito
   **na query** (`revendedora_id = usuário logado`), não apenas pela RLS — confiar só na
   RLS é REPROVAÇÃO (o modo "Entrar como Revendedora" troca o papel só na memória).
6. Cada cliente mostra nome, telefone, aniversário, nº de compras, total gasto e selos.
7. Clicar na cliente abre a tela dela (`#/cliente/:id`); clicar no lápis abre a edição
   sem navegar.
8. A busca por nome/telefone filtra sem o campo de busca perder o foco.

### Edição — RPC `cliente_editar`
9. A revendedora edita nome, telefone, aniversário (dd/mm), cidade, e-mail e observação.
10. Toda a escrita passa pela RPC `SECURITY DEFINER`. **Nenhuma policy nova de INSERT ou
    UPDATE em `clientes`** pode ter sido criada — a escrita direta pela revendedora
    continua bloqueada. Criar policy aqui é REPROVAÇÃO.
11. A RPC valida a permissão **no servidor**: staff OU a revendedora que já vendeu para
    aquela cliente. Uma revendedora chamando a RPC para uma cliente alheia recebe erro.
12. Telefone inválido (`00000000000`, `123456789`, DDD inexistente) é recusado **pelo
    banco**, não só pelo front.
13. Trocar o telefone por um número que já pertence a OUTRA cliente é **recusado** com
    mensagem clara, e nada é gravado. (O celular é UNIQUE e é a chave da cartela de
    fidelidade: fundir dois cadastros misturaria os selos de duas pessoas.)
14. Trocar o telefone por um número livre e válido funciona.
15. Aniversário inválido é recusado; `29/02` é aceito.
16. Dá para LIMPAR cidade, e-mail e observação (apagar o conteúdo e salvar deixa o campo
    vazio no banco) — não apenas preencher.
17. A RPC grava auditoria (quem alterou e quando).
18. A mensagem de erro do banco chega até a tela do usuário (o `toast` deste projeto
    silencia mensagens que parecem de sucesso — confira se a chamada força a exibição).

### Sanidade
19. `npm run build` e `npm run lint` passam.
20. Toda função usada em `onclick=`/`oninput=` no HTML gerado está registrada no
    `Object.assign(window, ...)` de `src/main.js`, importada e exportada. Atenção: o
    eslint deriva os globais desse mesmo `Object.assign`, então lint verde NÃO prova que
    a função existe — verifique um por um.
21. Não há função órfã: nada importado/registrado que não exista mais, e nada que exista
    e não esteja registrado.
22. Todo dado vindo do banco interpolado em `innerHTML` passa por `esc()`.
23. A migração 0056 é idempotente, tem `revoke`/`grant` explícitos, `search_path = public`
    e termina com `select pg_notify('pgrst','reload schema')`.
