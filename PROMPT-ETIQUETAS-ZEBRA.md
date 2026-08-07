# PROMPT — Impressão de etiquetas de produto (Zebra / ZPL)

> Rodar no VS Code em **`D:\lizzie-apps`**. Branch: `feat/etiquetas-zebra`.
> Arquivos principais: **novo `src/etiquetas.js`** + ganchos em `src/precificacao.js` e `src/produtos.js` + `index.html` (vendorizar SDK + markup do modal).
> `npm run lint` + `npm run build` verdes. **Um commit por etapa.**

## Contexto
Já existe um TODO no código esperando por isso: `src/precificacao.js`, linhas 622-623, dentro de `loteLancar()`:
```js
// TODO etiquetas: quando a impressão (Zebra/Argox) existir, oferecer aqui
// "Imprimir etiquetas do lote" com os produtos recém-lançados.
```
Este prompt implementa exatamente isso, mais a reimpressão avulsa em Produtos.

## Por que NÃO é `window.print()` (diferente do resto do app)
O app já usa `window.print()` + CSS `@media print` para fechamento, conferência, contrato e certificado — funciona bem porque são documentos A4 numa impressora comum. **Etiqueta térmica Zebra é outro mundo**: precisa de posicionamento exato em milímetros, e o jeito confiável de fazer isso é gerar o arquivo na linguagem própria da impressora — **ZPL (Zebra Programming Language)** — e mandar direto pra ela, sem passar pela caixa de diálogo de impressão do navegador (que não sabe alinhar em etiqueta pequena).

Pra mandar ZPL direto do navegador sem instalar nada pesado, a Zebra distribui um SDK JS chamado **Zebra Browser Print**, que conversa com um serviço local instalado no Windows (baixar em zebra.com/browserprint). Esse serviço:
- Detecta impressoras **USB conectadas localmente**.
- Também enxerga impressoras **de rede** já cadastradas nele (Printer Setup do próprio serviço).

**Ou seja: uma única integração resolve USB agora e rede depois**, como o Rondon pediu.

## Especificação decidida (não reabrir estas perguntas)
- **Conexão:** Zebra Browser Print (cobre USB hoje e rede mais tarde, sem trocar de abordagem).
- **Tamanho da etiqueta:** 30 x 15mm.
- **Conteúdo:** código de barras (Code128) + SKU em texto + preço. Sem nome, sem banho.
- **De onde dispara:** dos dois lugares — (A) Entrada de Mercadoria, lote inteiro, ao final do lançamento; (B) tela de Produtos, reimpressão avulsa de 1 peça.
- **Fonte do código de barras:** `produtos.codigo_barras` quando preenchido; se vazio, usar o **SKU** como conteúdo da barra (o campo já existe e é usado hoje só quando bipado/digitado manualmente — nem todo produto tem). Sinalizar na tela quando cair no fallback, para o usuário saber que aquela peça não tem GTIN próprio.

## ⚠️ Pré-requisito FORA do código (avisar o Rondon, não é tarefa do agente)
Antes de testar, é preciso **instalar o Zebra Browser Print** (aplicativo/serviço Windows, gratuito, baixado do site oficial da Zebra) no(s) computador(es) que vão imprimir. Isso é setup de máquina, não algo que o código resolve.

## Arquitetura proposta

### 1. Vendorizar o SDK
A Zebra distribui o `BrowserPrint-3.x.x.min.js` como script global (não é pacote npm). Baixar o arquivo oficial e colocar em `public/vendor/zebra-browserprint/BrowserPrint-3.x.x.min.js`, carregado via `<script>` no `index.html` **antes** do bundle do Vite (fica em `window.BrowserPrint`, não é import ES module). Não usar CDN externo — vendorizar local pra não depender de rede externa em produção.

### 2. Novo módulo `src/etiquetas.js`
- **`gerarZPL(produto, { dpi, larguraMm = 30, alturaMm = 15, qtd = 1 })`** → retorna **string ZPL pura** (função sem DOM, testável isolada). Regras:
  - Converte mm→dots a partir do `dpi` (203dpi ≈ 8 dots/mm; 300dpi ≈ 11.8 dots/mm) — **não fixar um DPI só**, várias Zebra vêm em 203 ou 300.
  - Código de barras: `produto.codigo_barras || produto.sku`.
  - `^PQ{qtd}` para imprimir a quantidade pedida numa única chamada.
  - Deixe módulo de barra, altura e posição X/Y do texto como **constantes nomeadas no topo da função** — ver nota de calibração abaixo.
- **`listarImpressoras()`** → usa `BrowserPrint.getLocalDevices` / `getDefaultDevice` pra listar as impressoras que o serviço enxerga (USB + rede já cadastrada nele).
- **`enviarParaImpressora(device, zpl)`** → `device.send(zpl, sucessoCb, erroCb)` conforme o SDK.
- **`baixarZPL(produto, opts)`** → fallback: gera `Blob` do ZPL e dispara download `.zpl`, para quando o Browser Print não estiver rodando/instalado (dá pra mandar manualmente depois pelo Zebra Setup Utility).

### 3. Configuração de impressora (preferência de máquina, não de negócio)
Salvar impressora escolhida + dpi em `localStorage` (ex.: chave `lizzie_etiqueta_config`) — **não precisa tabela nova no Supabase**, é local ao computador. Mini-modal "Configurar impressora": select com as impressoras encontradas, campo DPI (203/300), botão "Imprimir etiqueta de teste".

### 4. UI de impressão — `#modal-etiquetas`
Fluxo curto, pode ser modal simples (não precisa tela inteira): lista dos produtos a imprimir (sku, preço, qtd editável — default = quantidade lançada no lote, ou 1 na peça avulsa), aviso "sem código de barras próprio — usando SKU" quando aplicável, botão "Configurar impressora" (se nenhuma salva ainda), botão principal **"Imprimir N etiquetas"** e botão secundário **"Baixar arquivo .zpl"**.

Função central: **`abrirImpressaoEtiquetas(produtos: Array<{id, sku, nome, preco_venda, codigo_barras, qtd}>)`** — chamada dos dois pontos de entrada abaixo.

### 5. Gancho no lote — `precificacao.js`, dentro de `loteLancar()`
Substituir o TODO (linhas 622-623) por: montar a lista dos produtos recém-inseridos (sku, preco_venda, `codigo_barras: null` — lote novo ainda não tem barras, vai cair no fallback SKU — e `qtd: r.qntd`) e chamar `abrirImpressaoEtiquetas(...)`.
**Atenção:** o `insert` de hoje (linha ~615) não pede `.select()`, então não retorna os ids. Se precisar do id dentro do modal, adicionar `.select('id,sku,...')` no insert é uma mudança **mínima e segura** — só amplia o que volta da query, não muda o que é gravado. **Não tocar em mais nada da validação nem do payload.**

### 6. Gancho na peça avulsa — `produtos.js`
Botão "Imprimir etiqueta" perto do campo `#p-codbarras` (linha ~1158), chamando `abrirImpressaoEtiquetas([{ ...produtoAtual, qtd: 1 }])`.

### 7. Menu
Não precisa registrar painel novo em `menu.js` — é um modal disparado de onde a impressão já acontece, não uma tela própria.

## ⚠️ Regra de ouro
Não mexer em `consignados.js` nem `financeiro.js`. Não alterar cálculo/validação de `precificacao.js` nem o cadastro de `produtos.js` — só adicionar o gancho de impressão **depois do sucesso**. Sem framework novo. SDK da Zebra vendorizado localmente, sem CDN externo em produção.

## Nota de calibração (avisar o Rondon)
30x15mm é apertado (barra + 2 linhas de texto). Os números de módulo de barra, altura e posição X/Y no `gerarZPL` são um **ponto de partida**, quase certamente vão precisar de ajuste **na etiqueta física, na impressora real**. Isso não é bug de código — é calibração de hardware. Por isso as constantes ficam nomeadas e visíveis no topo da função, fáceis de achar e ajustar rápido.

## Teste (obrigatório)
1. Instalar o Zebra Browser Print no PC de teste antes de testar.
2. `npm run lint` + `npm run build` verdes.
3. Lançar um lote de teste (2-3 produtos) na Entrada de Mercadoria → modal de etiquetas abre com produtos e quantidades certas.
4. Configurar impressora → **imprimir etiqueta de teste física** → conferir: código de barras lê no leitor do app? SKU e preço legíveis? Nada cortado nos 30x15mm?
5. Testar peça avulsa em Produtos → 1 etiqueta.
6. Desligar o Zebra Browser Print → confirmar aviso na tela + botão "Baixar .zpl" funcionando (arquivo baixa, abre como texto puro com comandos ZPL).
7. Produto **sem** `codigo_barras` → aviso na tela + barra impressa usando o SKU.
8. Produto **com** `codigo_barras` → usa ele, não o SKU.

## Commits sugeridos
1. `feat(etiquetas): módulo etiquetas.js — geração de ZPL + integração Zebra Browser Print`
2. `feat(etiquetas): modal de impressão + configuração de impressora`
3. `feat(etiquetas): gancho no lote da Entrada de Mercadoria`
4. `feat(etiquetas): gancho na peça avulsa em Produtos`
5. `chore(etiquetas): fallback de download .zpl quando Browser Print não detectado`
