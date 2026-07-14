# PROMPT — Importar do Bling por FAIXA DE SKU (substituir o filtro de data)

> Rodar no VS Code com a pasta **`D:\lizzie-apps`** aberta (só nela).
> Trabalhar em **`src/produtos.js`**. **NÃO** mexer na Edge Function (`supabase/functions/bling-produtos`) — a ideia é justamente não precisar de deploy.
> `npm run lint` + `npm run build` verdes antes do commit.

## Contexto / diagnóstico
O filtro **"Incluídas no Bling a partir de"** não funciona. O caminho técnico está certo (o app envia `dataInclusaoInicial` e a Edge Function repassa — está na whitelist `REPASSA`), mas a **API de Produtos do Bling v3 aparentemente ignora esse parâmetro** e devolve o catálogo inteiro. Filtro ignorado = "não filtrou nada".

**Solução:** filtrar por **faixa de SKU no lado do app** (client-side), que não depende de nenhum filtro do Bling. Os SKUs da Lizzie são **sequenciais** — o lote novo vai de **21800 a 21933** (~134 produtos).

## Objetivo
Na tela **Produtos → Importar do Bling**, trocar o filtro de data por **"SKU de" / "SKU até"**, varrendo as páginas do Bling e mantendo só os produtos cujo SKU (numérico) esteja no intervalo.

## O que fazer

### 1. UI (tela de importação)
- Substituir o campo de data por dois campos numéricos: **`SKU de`** e **`SKU até`** (ex.: 21800 e 21933).
- Manter o checkbox **"Só produtos ativos"** como está.
- Texto de ajuda: *"Deixe em branco para trazer tudo. Os SKUs da Lizzie são sequenciais — use a faixa do lote que você quer importar."*
- Pode manter o campo de data, mas **marque-o como não confiável** ou remova — hoje ele engana o usuário. Recomendo **remover**.

### 2. Varredura + filtro (a parte importante)
Hoje `fetchBlingProdutos(pagina, filtros)` busca uma página (`limite: 100`). Implemente uma varredura completa com filtro local:

- Percorra as páginas do Bling (`pagina = 1, 2, 3, …`) **até uma página voltar com menos de 100 itens** (fim do catálogo) ou vazia.
- Para cada produto, extraia o SKU e converta para número. **Mantenha apenas** os que estão em `[skuDe, skuAte]` (se os campos estiverem vazios, mantém todos — comportamento atual).
- Respeite o rate limit do Bling: use o `sleep()` que já existe, com **~350ms entre páginas**.
- **Progresso na tela**, obrigatório: *"Varrendo página N · X produtos no intervalo · Y varridos"*. Sem isso o usuário acha que travou.
- **Botão "Parar"** para cancelar a varredura no meio (e ainda assim ver o que já achou).

> Atenção: como os SKUs novos (21800+) são os mais recentes, eles tendem a estar nas **últimas páginas**. Não dá para parar cedo — a varredura precisa ir até o fim (ou até o usuário parar). Por isso o progresso e o botão parar são essenciais.

### 3. Reaproveitar o que já existe
- A prévia, o `mapProdutoBling()`, a deduplicação (SKU/código de barras que já existem são ignorados) e o relatório final **continuam iguais** — só passam a operar sobre a lista já filtrada pela faixa.
- Mantenha a idempotência: rodar de novo não duplica.

### 4. Robustez
- SKU não numérico ou vazio → não entra no intervalo (conta como "fora do filtro" no relatório).
- Se a varredura terminar e **nenhum** produto cair no intervalo, avise claramente ("Nenhum produto entre 21800 e 21933 — confira a faixa") em vez de mostrar prévia vazia sem explicação.
- No relatório, mostre também **quantos produtos foram varridos no total** — assim dá pra ver a escala do catálogo.

### 5. Padrões do projeto
- Funções chamadas por `onclick` vão para o `window` (`Object.assign` no `main.js`).
- Reaproveite `toast`, `esc`, `sleep`, e o visual dos relatórios já existentes. Sem emoji — usar os ícones de linha.

## Teste
1. Faixa curta primeiro: **SKU de 21800 até 21805**. A prévia deve trazer só esses. Confira nome/preço/código de barras.
2. Importe essa faixa curta → confirme no catálogo que entraram.
3. Rode a mesma faixa de novo → devem ser **ignorados** (dedupe funcionando), sem duplicar.
4. Só então rode a faixa completa: **21800 a 21933**.
5. Console limpo; lint e build verdes.

## Commits sugeridos
1. `feat(produtos): importar do Bling por faixa de SKU (substitui filtro de data que o Bling ignora)`
2. `feat(produtos): progresso e cancelamento na varredura do Bling`
