# PROMPT — Importador de fotos em lote (casar foto ↔ produto pelo SKU)

> Rodar no VS Code com a pasta **`D:\lizzie-apps`** aberta (só nela). Branch nova, ex.: `feat/fotos-lote`.
> Trabalhar em **`src/produtos.js`** (+ o mínimo necessário em `index.html`/`main.js` para o botão e o `window`).
> **Não mudar** auth, RLS, PWA, nem o importador do Bling existente. Rodar `npm run lint` + `npm run build` antes de commitar.

## Problema
Foram lançados **~120 produtos novos no Bling**, sem foto no Bling. As fotos estão em arquivos (baixados do Drive para o PC). Hoje só dá para subir imagem **um produto por vez** pelo formulário — inviável para 120.

## Objetivo
Criar, dentro do painel **Produtos**, um **importador de fotos em lote**: o usuário seleciona muitos arquivos de imagem de uma vez, o app **casa cada foto com o produto pelo SKU contido no nome do arquivo**, sobe para o Storage e preenche as imagens do produto.

## Formato do nome do arquivo (real)
```
21800 - Brinco Oval Eye Cravejado com Zircônia Verde Julho Ouro 18 k - R$ 42,00.jpg
```
Padrão: `{SKU} - {descrição} - R$ {preço}.{ext}`

**Regra de extração: o SKU são os dígitos iniciais do nome do arquivo.**
```js
const m = file.name.trim().match(/^(\d+)/);
const sku = m ? m[1] : null;   // sem dígitos no início => "não casou"
```
Não use a descrição nem o preço do nome do arquivo — esses dados já vieram do Bling e estão no banco. O nome do arquivo serve **só** para achar o SKU.

**Várias fotos do mesmo produto:** agrupe os arquivos **pelo SKU**. Se 3 arquivos começam com `21800`, viram as 3 imagens desse produto. Dentro do grupo, ordene por nome do arquivo (ordem natural) — **a 1ª vira a principal**. Isso funciona com qualquer sufixo (`-2`, `(1)`, ` b`), sem precisar de convenção fixa.

## Convenções do projeto que DEVEM ser reaproveitadas (já existem em `src/produtos.js`)
- Bucket: **`lizzie-fotos`** (público) — `sb.storage.from('lizzie-fotos')`
- Caminho do upload: `produtos/${Date.now()}_${i}.${ext}` com `{ upsert: true }`; URL via `getPublicUrl(fname)`
  → no lote, use algo rastreável: `produtos/${sku}_${Date.now()}_${i}.${ext}`
- Persistência: coluna **`imagens`** (array de URLs) e **`foto_url` = `imagens[0]`** (principal, usada no resto do app)
- Limites: **`MAX_IMAGENS = 5`** por produto, **`MAX_IMG_MB = 5`** por arquivo
- Tipos aceitos: `image/jpeg`, `image/png`, `image/webp`

## Fluxo a implementar

### 1. Entrada
Um botão/seção no painel Produtos: **"Importar fotos em lote"**. Abre um `<input type="file" multiple accept="image/jpeg,image/png,image/webp">`.

### 2. Análise (antes de subir qualquer coisa)
1. Para cada arquivo: extrair o SKU (regex acima), validar tipo e tamanho.
2. Agrupar arquivos por SKU (máx. `MAX_IMAGENS` por produto — o excedente vai para o relatório como ignorado).
3. Carregar os produtos com `fetchPaginado(() => sb.from('produtos').select('id,nome,sku,codigo_barras,foto_url,imagens'))`.
4. Casar por **`sku`** (comparação de string, com `trim()`). Fallback opcional: `codigo_barras`. Tolerar zeros à esquerda (compare também sem eles).

### 3. Relatório de conferência (OBRIGATÓRIO — nada sobe antes do OK do usuário)
Mostrar na tela, com contadores bem visíveis:
- ✅ **Vão receber foto** — N produtos (X arquivos): lista com nome do produto, SKU e quantas fotos.
- ⚠️ **Já têm foto** — N produtos: **pulados por padrão**. Oferecer um checkbox **"Substituir fotos existentes"** (padrão **desmarcado**).
- ❌ **Não casaram** — N arquivos: listar o nome do arquivo + o motivo (`SKU não encontrado no catálogo`, `sem dígitos no início do nome`, `tipo inválido`, `maior que 5MB`, `passou do limite de 5 imagens`).

Botão **"Importar N fotos"** só depois desse relatório.

### 4. Upload (com barra de progresso)
- Subir **de forma sequencial ou com concorrência baixa (máx. 3 simultâneos)** — são ~120 produtos, não dispare centenas de uploads em paralelo.
- Mostrar **progresso "X de Y"** e avisar para **não fechar a aba**.
- Para cada produto: subir seus arquivos → juntar as URLs → **um único `update`** na linha do produto com `imagens` (máx. 5) e `foto_url = imagens[0]`.
- **Erro em um arquivo não pode abortar o lote**: registre a falha, continue os demais e mostre tudo no relatório final.
- Se "Substituir fotos existentes" estiver **desmarcado**, não toque em produto que já tem `foto_url`/`imagens`.

### 5. Relatório final
`X produtos atualizados · Y fotos enviadas · Z falhas` + lista das falhas (arquivo + motivo). Depois, recarregar a lista de produtos.

### 6. Idempotência
Rodar de novo tem que ser seguro: como produtos que já têm foto são pulados por padrão, uma segunda execução só completa o que faltou. Isso permite **retomar** se algo travar no meio.

## Detalhes de qualidade
- Funções chamadas por `onclick` precisam ir para o `window` (padrão do projeto: `Object.assign(window, …)` no `main.js`).
- Reaproveite os helpers existentes (`toast`, `esc`, `fetchPaginado`, `sbQ`) e o visual dos relatórios do importador do Bling (mesma pegada de UI).
- Sem emoji na UI — usar os ícones de linha do projeto.

## Teste
1. Selecione **3 arquivos** primeiro (1 SKU que existe, 1 SKU inexistente, 1 arquivo com nome sem dígitos). O relatório deve classificar os três corretamente e **nada deve subir** antes do OK.
2. Importe esses 3 → confira no catálogo que a foto apareceu no produto certo (a principal).
3. Rode de novo os mesmos arquivos → devem cair em "já têm foto" e **não** duplicar.
4. Só então rode a pasta inteira (~120).
5. Console limpo; `npm run lint` e `npm run build` verdes.

## Commits sugeridos
1. `feat(produtos): importador de fotos em lote — parser de SKU e relatório de conferência`
2. `feat(produtos): upload em lote com progresso e relatório final`
