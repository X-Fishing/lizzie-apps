# PROMPT — Corrigir estoque zerado ao importar planilha de cadastro de produtos

> Rodar no VS Code com a pasta **`D:\lizzie-apps`** aberta.
> Trabalhar só em **`src/produtos.js`**. Parte 2 é opcional e começa com uma investigação (leitura, sem editar nada) — só mexer em código se a hipótese se confirmar.
> `npm run lint` + `npm run build` verdes antes de cada commit. Um commit por parte.

## O bug (diagnóstico)

Relato: ao subir uma planilha para **cadastrar** produtos, o estoque ficou **zero para todos**.

Investigado o fluxo completo (`produtoPlanilhaArquivo` → `produtoPlanilhaAplicar`, em `src/produtos.js`). Causa raiz confirmada:

- O importador de planilha casa o cabeçalho por **igualdade literal** de string com `PLANILHA_COLS` (linha ~1122), incluindo `estoque_qtd`:
  ```js
  const header = linhas[0].map(h => (h || '').trim().toLowerCase());
  const idx = {};
  PLANILHA_COLS.forEach(c => { const i = header.indexOf(c); if (i >= 0) idx[c] = i; });
  if (idx.sku == null) { area.innerHTML = impErro('Falta a coluna "sku" no cabeçalho...'); return; }
  ```
- Se o cabeçalho da planilha usar um nome diferente do literal `estoque_qtd` (ex.: "Estoque", "Qtd", "Quantidade" — que é como o próprio app rotula esse campo em outras telas), `idx.estoque_qtd` fica `undefined`. **Nenhum erro é mostrado** — só a coluna `sku` é obrigatória.
- Com `idx.estoque_qtd` indefinido, `get('estoque_qtd')` (linha ~1271) sempre retorna `''`, então o parser (linha ~1282) nunca preenche `campos.estoque_qtd`, **para nenhuma linha**.
- Para **produto que já existe** (update), isso é inofensivo por design: campo ausente não entra no `diff`, então o estoque atual é preservado.
- Para **SKU novo** (cadastro — exatamente o caso relatado), o produto é inserido sem `estoque_qtd`:
  ```js
  const { error } = await sbQ(sb.from('produtos').insert({ ...c.campos, sku: c.sku }));
  ```
  A coluna `estoque_qtd` no banco é `not null default 0` (`produtos-schema.sql`), então **todo produto novo nasce com estoque 0**, mesmo que a planilha original tivesse valores diferentes — e sem nenhum aviso na tela. Bate exatamente com o relato.

Não há trigger, RPC ou Edge Function envolvidos — é 100% client-side, nesse arquivo.

## Objetivo

1. O importador reconhece sinônimos comuns para a coluna de estoque (não só o literal `estoque_qtd`).
2. Se, mesmo assim, alguma coluna esperada do modelo não for encontrada no cabeçalho, isso fica **visível** no relatório antes de aplicar — nunca mais silencioso.

---

## Parte 1 — Casamento de cabeçalho tolerante + aviso de coluna não encontrada

### 1.1 Sinônimos para `estoque_qtd`

Perto de `PLANILHA_COLS` (linha ~1122), adicionar um mapa de apelidos e usá-lo no casamento de cabeçalho:

```js
const PLANILHA_AVATAR_COLS = { estoque_qtd: ['estoque', 'qtd', 'qtde', 'quantidade', 'saldo'] };
```

(nomeie como preferir, ex. `PLANILHA_COL_SINONIMOS` — só não pode colidir com nomes já usados no arquivo).

No trecho que monta `idx` (linha ~1264), tentar o literal primeiro e cair nos sinônimos:

```js
PLANILHA_COLS.forEach(c => {
  let i = header.indexOf(c);
  if (i < 0 && PLANILHA_COL_SINONIMOS[c]) {
    for (const alt of PLANILHA_COL_SINONIMOS[c]) { i = header.indexOf(alt); if (i >= 0) break; }
  }
  if (i >= 0) idx[c] = i;
});
```

### 1.2 Aviso explícito quando uma coluna do modelo não foi encontrada

Ainda em `produtoPlanilhaArquivo`, depois de montar `idx`, calcular quais colunas do modelo **não** foram encontradas no cabeçalho desta planilha:

```js
const colunasFaltando = PLANILHA_COLS.filter(c => c !== 'sku' && idx[c] == null);
```

Guardar isso em `planilhaAnalise` (junto com `atualizar, criar, avisos, semMudanca, total`) e, em `renderPlanilhaRelatorio()`, mostrar um bloco de aviso **no topo** do relatório se `colunasFaltando.length`, por exemplo:

> "Colunas do modelo não encontradas no cabeçalho desta planilha (serão ignoradas em todas as linhas): **estoque_qtd**, colecao. Produtos **novos** criados a partir desta planilha não terão esses campos preenchidos."

Use o mesmo estilo visual dos outros blocos de aviso já existentes (`blocoAvisos`, cor `var(--gold)` ou `var(--danger)` se `estoque_qtd` especificamente estiver faltando e houver `criar.length > 0` — esse é o caso que realmente zera estoque).

### 1.3 Não regredir

- Planilha que já usa o cabeçalho `estoque_qtd` literal continua funcionando exatamente igual.
- Update de produto existente continua preservando estoque quando a coluna não vem na planilha (não mudar esse comportamento — é intencional, ver "Célula em branco NÃO altera nada" no código).

---

## Parte 2 (opcional) — "Importar do Bling" também não traz estoque

Ao investigar o bug relatado, encontrei um segundo ponto (não é literalmente "planilha", é o botão **Importar do Bling**) com o mesmo sintoma final: `mapProdutoBling()` (linha ~90) não inclui `estoque_qtd` no objeto retornado, então todo produto trazido do Bling também nasce com estoque 0.

**Antes de mexer em código**, investigar (só leitura):
1. Chamar a Edge Function `bling-produtos` (já existe, proxy puro pro Bling v3 — não filtra campos) pra um produto real e ver se a resposta da **listagem** (`GET /produtos`) ou do **detalhe** (`GET /produtos/{id}`) traz algum campo de estoque/saldo. Pode inspecionar no `console.log` da prévia de importação, ou via `curl`/Postman direto na Edge Function.
2. A API de Produtos do Bling v3 costuma **não** trazer saldo de estoque nem na listagem nem no detalhe do produto — estoque é recurso separado (`/estoques/saldos`). Se for esse o caso aqui, **não dá pra resolver só mudando `mapProdutoBling`** sem uma chamada extra por produto (custo de requests/rate limit a avaliar — não implementar sem combinar).

Se o campo existir na resposta (ex. algo como `p.estoque?.saldoVirtualTotal` ou similar — **confirme o nome real no payload, não adivinhe**):
- Adicionar em `mapProdutoBling()`: `estoque_qtd: Number(p.estoque?.saldoVirtualTotal ?? 0) || 0` (ajustar o caminho pro que a resposta real trouxer).

Se **não** existir (mais provável):
- Não inventar nada. Em vez disso, deixar visível no relatório de importação do Bling (`produtoImportBlingRun` / relatório final) uma linha fixa: **"Estoque não vem do Bling nesta importação — ajuste manualmente depois de criar os produtos."** — pra não repetir o efeito surpresa "zerou sem avisar".

---

## Teste

1. Baixe a planilha modelo (`produtoPlanilhaModelo`) e renomeie a coluna `estoque_qtd` para `Estoque` (com maiúscula, só pra confirmar o `.toLowerCase()`/trim). Preencha 2-3 linhas com SKUs **novos** e estoque ≠ 0. Suba a planilha → confira que o relatório reconhece a coluna (sem aviso de "coluna faltando") e que, ao aplicar, os produtos novos nascem com o estoque correto.
2. Repita com o cabeçalho `Qtd` e depois `Quantidade` — mesmo resultado.
3. Suba uma planilha com uma coluna de estoque com nome **não reconhecido** (ex. "Unidades") → o relatório deve mostrar o aviso de coluna faltando **antes** de aplicar, avisando que estoque não será preenchido nos novos.
4. Confirme que **update** de produto existente continua sem alterar estoque quando a coluna está ausente/vazia (comportamento antigo preservado).
5. Console limpo; `npm run lint` e `npm run build` verdes.

## Commits sugeridos

1. `fix(produtos): planilha reconhece sinônimos de coluna de estoque (estoque/qtd/quantidade/saldo)`
2. `fix(produtos): avisa no relatório quando coluna do modelo não é encontrada no cabeçalho, antes de aplicar`
3. *(se aplicável, Parte 2)* `fix(produtos): importar do Bling — mapeia/avisa sobre estoque`
