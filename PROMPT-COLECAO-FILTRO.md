# PROMPT — Filtro e busca por Coleção na lista de Produtos

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> Mexa **apenas** em `src/produtos.js` e `src/main.js`. NÃO altere o banco (a coluna `colecao_id` já existe). Faça **1 commit** no fim. Teste no `npm run dev` antes de commitar.

## Objetivo
A Coleção continua sendo **uma por produto** (campo `colecao_id` já existente). Adicionar na **lista de Produtos**:
1. Um **filtro por coleção** (dropdown).
2. A **busca por texto** passar a casar também com o **nome da coleção**.
3. Mostrar a coleção como **badge** em cada linha do produto.

## Passo 1 — `src/produtos.js`

### 1a. Estado do filtro
No topo do módulo, junto de `let filtroProdutos = '';`, adicione:
```js
let filtroColecao = '';   // id da coleção selecionada no filtro ('' = todas)
```

### 1b. Carregar nomes das coleções ao abrir a lista
A lista hoje não tem os nomes das coleções. Em `loadProdutos()`, antes de `renderLista()`, garanta o cache de coleções:
```js
import { cadastroCache, carregarCadastrosParaSelect } from './cadastros.js';
// ...
export async function loadProdutos() {
  // ...consulta existente em produtos...
  produtosCache = data || [];
  if (!cadastroCache.colecoes || !cadastroCache.colecoes.length) {
    await carregarCadastrosParaSelect(); // popula categorias/colecoes/fornecedores
  }
  renderLista();
}
```
> Obs.: `cadastros.js` já exporta `cadastroCache` e `carregarCadastrosParaSelect`. Se o import de `cadastroCache` já existir no arquivo, não duplique.

### 1c. Helper nome da coleção
Adicione um helper:
```js
function nomeColecao(id) {
  const c = (cadastroCache.colecoes || []).find(x => String(x.id) === String(id));
  return c ? c.nome : '';
}
```

### 1d. Filtrar e buscar (incluindo nome da coleção)
Em `renderLista()`, troque a montagem de `lista` para considerar o filtro de coleção e a busca pelo nome da coleção:
```js
const f = filtroProdutos.trim().toLowerCase();
let lista = produtosCache;
if (filtroColecao) lista = lista.filter(p => String(p.colecao_id) === String(filtroColecao));
if (f) lista = lista.filter(p =>
  [p.nome, p.sku, p.codigo_barras, nomeColecao(p.colecao_id)]
    .some(v => (v || '').toLowerCase().includes(f)));
```

### 1e. Badge da coleção na linha
Na célula do produto (onde hoje mostra nome + SKU/código), acrescente a coleção como badge quando existir:
```js
${p.colecao_id ? `<span class="ciclo-badge" style="margin-left:6px">${esc(nomeColecao(p.colecao_id))}</span>` : ''}
```
(coloque logo após o nome do produto).

### 1f. Dropdown de filtro acima da tabela
Logo após o `<input ... oninput="produtoFiltrar(this.value)">`, adicione um select de coleção. Ex.: envolva busca + filtro num flex:
```html
<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
  <input type="text" class="form-control" style="flex:1;min-width:200px" placeholder="Buscar por nome, SKU, código ou coleção..."
    value="${esc(filtroProdutos)}" oninput="produtoFiltrar(this.value)">
  <select class="form-control" style="max-width:220px" onchange="produtoFiltrarColecao(this.value)">
    <option value="">Todas as coleções</option>
    ${(cadastroCache.colecoes || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filtroColecao) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
  </select>
</div>
```
(remova o input antigo solto para não duplicar).

### 1g. Handler do filtro
Adicione e exporte:
```js
export function produtoFiltrarColecao(v) { filtroColecao = v; renderLista(); }
```

## Passo 2 — `src/main.js`
No `Object.assign(window, { ... })`, inclua `produtoFiltrarColecao` junto das outras funções de produto (ex.: ao lado de `produtoFiltrar`). Sem isso o `onchange` do select dá "is not defined".

## Passo 3 — Validar e commitar
```bash
npm run lint
npm run build
git add src/produtos.js src/main.js PROMPT-COLECAO-FILTRO.md
git commit -m "feat(produtos): filtro e busca por colecao na lista"
```

## Teste (npm run dev)
- Cadastre 2 coleções e produtos em coleções diferentes.
- Na lista de Produtos: o badge da coleção aparece na linha.
- O dropdown "Todas as coleções" filtra corretamente.
- A busca por texto encontra produto digitando o nome da coleção.
