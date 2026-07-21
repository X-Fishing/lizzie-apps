# PROMPT — Fechamento e Conferência: de modal para TELA INTEIRA

> Rodar no VS Code em **`D:\lizzie-apps`**. Branch: `feat/fechamento-tela-inteira`.
> Arquivo principal: **`src/consignados.js`** (+ `index.html` para mover o markup).
> `npm run lint` + `npm run build` verdes. **Um commit por etapa.**

## Contexto e motivo
O app nasceu **mobile-first** (PWA num `index.html` só). No celular, um modal já ocupa a tela toda — então "telas secundárias" viraram modais, o que era barato e funcionava. Depois o app virou **ERP de desktop** (casca com sidebar), e esses modais viraram **caixinhas apertadas no meio de um monitor grande**.

O **Fechamento do Catálogo** e a **Conferência** são o pior caso: fluxo denso, tabela longa, conferência item a item, edição de comissão e impressão no fim. Modal é o formato errado. Eles precisam virar **tela inteira**.

Hoje: `openModal('modal-fechamento')` (≈linha 1795) e `openModal('modal-conferencia')` (≈linha 726) em `src/consignados.js`.

## ⚠️ Regra de ouro
**NÃO ALTERAR A LÓGICA.** Este é o módulo mais crítico do sistema (foi onde corrigimos bugs graves de ciclo/fechamento). Mude **só o container/apresentação**:
- Não tocar em: cálculo de comissão, faixas, conferência item a item, marcação de devolvido/vendido, reconciliação, geração de PDF/impressão, RPC de venda, atualização de estoque.
- Só muda **onde** o conteúdo é renderizado e **como** se navega até ele.

## Padrão a seguir (já existe no projeto — NÃO invente outro)
O `consignados.js` já tem sub-telas em tela cheia: o **Histórico de catálogos** (`abrirHistoricoCiclo` / `renderHistoricoCicloDetalhe` / `voltarHistoricoCiclo`). Elas renderizam **dentro do `panel-consignados`**, substituindo o conteúdo, com um botão **"← Voltar"** (classe `btn-voltar-ciclo`).

**Use exatamente esse padrão** para o Fechamento e a Conferência. Assim:
- Não precisa registrar painel novo em `PANEIS_STAFF`/`menu.js` (não é item de menu, é sub-tela).
- Não mexe em permissões (`chave_menu`) — nada de chave nova.
- O breadcrumb e a sidebar continuam funcionando.

## Etapa 1 — Conferência em tela inteira
1. Adicione um estado de sub-tela (ex.: `conferenciaAberta = { revId | chave }` ou reaproveite o padrão de `historicoCicloSel`).
2. `abrirConferencia(revId)` e `abrirConferenciaCorrecao(chave)`: em vez de `openModal('modal-conferencia')`, passam a **setar o estado e re-renderizar** o `panel-consignados` com a conferência ocupando a tela.
3. Mova o markup de `#modal-conferencia` do `index.html` para uma função de render (ex.: `renderConferenciaTela()`), mantendo **todos os ids, classes e handlers atuais** — a conferência tem campos editáveis, busca por teclado (`confBuscaTeclas`), lightbox de foto (`confVerFoto`, `lightboxFotoNav`), comissão editável (`confComissaoEditada`, `confComissaoUsarFaixa`). **Preservar ids é obrigatório**, senão esses handlers quebram.
4. Botão **"← Voltar"** no topo, que limpa o estado e volta pro detalhe da revendedora de onde veio.
5. Aproveite a largura: a tabela de conferência pode usar a tela toda (como o `entrada-mercadoria` faz com `.tela-full`, se fizer sentido).

**Teste:** abrir conferência → marcar devolvido/vendido → buscar por teclado → abrir foto → editar comissão → usar faixa → finalizar. Tudo igual a antes, só que em tela cheia.

## Etapa 2 — Fechamento em tela inteira
1. `openFechamento()`: em vez de `openModal('modal-fechamento')`, renderiza a tela cheia dentro do `panel-consignados` (mesmo padrão).
2. Mover o markup de `#modal-fechamento` para a função de render, **preservando ids/classes**.
3. Botão **"← Voltar"**.
4. **Impressão:** `gerarPdfFechamento()` usa `window.print()` com container de impressão + `@media print`. Confira que o CSS de impressão **continua isolando só o conteúdo do fechamento** agora que ele vive dentro do painel (e não num overlay). Se necessário, ajuste o seletor do `@media print` — mas **não mude a lógica de geração**.

**Teste:** abrir fechamento → conferir os totais → **gerar PDF/imprimir** (o print tem que sair idêntico ao de hoje) → voltar.

## Etapa 3 — Limpeza
- Remover do `index.html` os blocos `#modal-fechamento` e `#modal-conferencia` que ficaram órfãos.
- Remover chamadas de `closeModal('modal-fechamento'/'modal-conferencia')` que não fazem mais sentido (substituir pelo "voltar").
- Garantir que **nenhuma outra parte** do código ainda chama `openModal` desses dois.

## O que NÃO fazer nesta tarefa
- **Não converter outros modais.** Vários fluxos densos (`modal-bling`, `modal-detalhe-venda`, `modal-recebimento`, `modal-maleta`, `modal-divulgar`, `modal-detalhe-rev`) também deveriam virar tela inteira — **mas os módulos deles estão sendo redesenhados agora** nas branches `feat/redesign-fase1/2/3`. Convertê-los aqui geraria conflito de merge. Eles ficam registrados no `PLANO-REDESIGN.md` para serem convertidos dentro da fase que já vai tocá-los.
- Não mexer em menu, permissões, RLS, PWA.
- Modais que **devem continuar modais** (não tocar): `confirma`, `install`, `foto-perfil`, `busca-peca`, `busca-produto`, `scanner`, `pos-venda`.

## Teste final (obrigatório — módulo crítico)
Numa **revendedora de TESTE**, ciclo completo:
lançar mostruário → vender algumas peças → **abrir conferência em tela cheia** → conferir item a item → finalizar → **fechamento em tela cheia** → **imprimir/gerar PDF** → voltar → conferir o histórico do ciclo.
Mais: console limpo, `npm run lint` e `npm run build` verdes, e testar também numa **largura de celular** (a revendedora usa no telefone — a tela cheia tem que funcionar lá também, não pode quebrar o mobile).

## Commits sugeridos
1. `refactor(conferencia): conferência em tela inteira (sai do modal, padrão sub-tela do consignados)`
2. `refactor(fechamento): fechamento do catálogo em tela inteira + impressão preservada`
3. `chore: remove markup órfão dos modais de fechamento/conferência`
