# Fase 3 — Critérios de aceite

Nova tela **"compras da cliente"** com rota própria `#/cliente/:id`, e a tela de
**Fidelidade** passa a levar para ela ao clicar numa cliente (antes abria um modal).

Contexto mínimo: app PWA (Vite + JS puro + Supabase) da Lizzie Semijoias, SPA com
roteamento por hash. Papéis: `admin`, `func_completo`, `func_basico` (os três são "staff")
e `revendedora`.

## Critérios

### Navegação
1. Clicar numa cliente na tela Fidelidade **navega** para `#/cliente/<id>` — não abre modal.
   Vale para os dois layouts da lista (card da revendedora e tabela do staff).
2. A rota `#/cliente/<id>` funciona também por link direto / F5 / colando a URL.
3. O botão "Voltar" da tela e o "voltar" do navegador retornam para a Fidelidade.
4. O painel novo é escondido quando outra tela é aberta (não fica sobrando na tela).

### Escopo por papel — o ponto mais importante
5. **Staff** abrindo uma cliente vê as compras de **todas** as revendedoras daquela cliente.
6. **Revendedora** abrindo uma cliente vê **apenas as compras dela** com aquela cliente.
7. Uma revendedora que digita na URL o id de uma cliente para quem ela **nunca vendeu**
   NÃO vê nome, telefone, aniversário, cidade nem qualquer compra — só uma mensagem de
   "não encontrada". Vazar qualquer dado dessa cliente é REPROVAÇÃO.
8. O escopo do critério 6/7 é feito **na query** (`.eq('revendedora_id', ...)`), não
   apenas confiando na RLS. Motivo: o modo "Entrar como Revendedora" troca o papel só na
   memória da sessão — para o banco a funcionária continua staff. Se o escopo depender só
   da RLS, é REPROVAÇÃO.

### Conteúdo
9. A tela lista as compras por `vendas.cliente_id` — **não** por `vendas.nome_cliente`.
10. Cada compra mostra data, valor, forma de pagamento e se está quitada ou pendente;
    clicar expande os itens daquela compra.
11. A cartela de fidelidade, o extrato de selos, os prêmios pendentes, o botão de ajuste
    ±1 (só admin) e o botão de resgate (só gestor) continuam existindo e funcionando —
    com as MESMAS travas de papel de antes. Nenhuma dessas funcionalidades pode ter sido
    perdida na mudança do modal para a tela.
12. Se a RPC de fidelidade falhar, as compras continuam aparecendo (a fidelidade não pode
    derrubar a tela).
13. A tela mostra totais: número de compras, total gasto e valor em aberto.

### Sanidade
14. `npm run build` e `npm run lint` passam.
15. Toda função usada em `onclick=` no HTML gerado está registrada no
    `Object.assign(window, ...)` de `src/main.js`. Um nome faltando só quebra em runtime,
    no clique — o build não acusa. Verifique um por um.
16. Nenhuma função removida de `src/fidelidade.js` continua sendo importada ou
    referenciada em qualquer lugar (inclusive no `Object.assign` do main.js).
17. Todo dado vindo do banco que é interpolado em `innerHTML` passa por `esc()`.
