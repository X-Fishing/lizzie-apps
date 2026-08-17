# Fase 1 — Critérios de aceite

Renomear o rótulo "Histórico de Clientes" para "Histórico de Vendas" no app da Lizzie.
É renomeação de **rótulo apenas**: nada de painel, rota ou função deve mudar de nome.

## Critérios

1. Não existe mais nenhuma ocorrência do texto "Histórico de Clientes" em `index.html`
   nem em `src/`.
2. O subitem do menu gaveta da revendedora (grupo "Vendas") mostra "Histórico de Vendas".
3. O título da tela `#panel-historico` mostra "Histórico de Vendas".
4. O breadcrumb da topbar do staff mostra "Histórico de Vendas" quando o painel
   `historico` está ativo.
5. A rota `#/historico` continua abrindo a mesma tela, com o mesmo comportamento.
6. O id do painel continua `panel-historico`, o atributo `data-drawer-panel` continua
   `historico`, e nenhuma função foi renomeada (`loadHistorico`, `filtrarHistorico`,
   `toggleHistorico` continuam existindo e expostas no `window`).
7. `npm run build` e `npm run lint` passam sem erro.
