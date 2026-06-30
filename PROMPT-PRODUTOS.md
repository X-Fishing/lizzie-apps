# PROMPT — Validar a feature "Produtos + Lançador de Maleta", commitar e rodar local

> Cole este arquivo no chat do Copilot/Cursor com a pasta `lizzie-apps` aberta no VS Code.
> **Não reescreva a feature** — ela já está nos arquivos. Sua tarefa é: conferir, instalar deps, validar (lint/build), **commitar** e subir o **dev server** para teste local.

## Contexto
Foi adicionado um cadastro de produto próprio (saída gradual do Bling) + um lançador de maleta com bipe. Os arquivos já estão na pasta. Confirme que existem e estão íntegros antes de commitar.

### Arquivos NOVOS
- `produtos-schema.sql` — tabelas `produtos`, `categorias`, `colecoes`, `fornecedores`, `produto_variacoes` + RLS + coluna `produto_id` em `consignados`.
- `src/cadastros.js` — CRUD genérico de Categorias, Coleções e Fornecedores.
- `src/produtos.js` — lista + formulário "Cadastrar produto" (etapas: dados básicos, características c/ código de barras e peso/dimensões, imagem, coleção/estoque, fornecedor c/ atalho, tributação "Em breve", variações).
- `src/lancador.js` — "Lançar Maleta": bipe via leitor USB (teclado+Enter) e câmera (BarcodeDetector), monta carrinho e envia para `consignados`.

### Arquivos ALTERADOS
- `src/nav.js` — novos painéis em `PANEIS_STAFF` e no `showPanel` (produtos, categorias, colecoes, fornecedores, lancador).
- `src/main.js` — imports dos novos módulos + exposição das funções no `Object.assign(window, {...})`.
- `index.html` — novos `div#panel-*`, itens na `.staff-nav` (Lançar Maleta + Produtos/Categorias/Coleções/Fornecedores dentro de "Cadastros"), e os modais `#modal-cadastro` e `#modal-scanner` (com `<video id="scanner-video">`).
- `src/styles.css` — classe `.form-grid` (grid responsivo do formulário).

## Passos a executar

1. **Sanidade dos arquivos** — confirme que cada arquivo acima existe e que `index.html` termina com:
   ```html
   <script type="module" src="/src/main.js"></script>
   ```
   e que contém `id="modal-cadastro"`, `id="modal-scanner"` e `id="scanner-video"`.
   Confira também que `src/main.js` NÃO tem bytes nulos / lixo no fim (deve terminar em `})();`).

2. **Instalar dependências** (se necessário):
   ```bash
   npm install
   ```

3. **Validar**:
   ```bash
   npm run lint
   npm run build
   ```
   Corrija apenas erros de integração (import faltando, nome não exposto no window). Não altere o comportamento da feature.

4. **Banco (lembrete, fora do VS)**: no Supabase → SQL Editor, rode `produtos-schema.sql` uma vez. Sem isso as telas novas dão erro de "relation does not exist".

5. **Commit**:
   ```bash
   git add produtos-schema.sql src/cadastros.js src/produtos.js src/lancador.js src/nav.js src/main.js index.html src/styles.css PROMPT-PRODUTOS.md
   git commit -m "feat: cadastro de produtos + lancador de maleta com bipe (USB/camera)"
   ```

6. **Rodar local para teste**:
   ```bash
   npm run dev
   ```
   Abra a URL do Vite, entre como usuário **gestor/admin** e teste:
   - Menu lateral → **Cadastros → Categorias / Coleções / Fornecedores**: criar, editar, excluir.
   - **Cadastros → Produtos → Novo produto**: preencher, salvar; conferir na lista; editar.
   - Atalho de **novo fornecedor** dentro do formulário de produto (botão "+").
   - **Lançar Maleta**: escolher revendedora, bipar (ou digitar um código de barras existente + Enter), ajustar quantidade, **Enviar para a maleta**; conferir que aparece no Catálogo da revendedora.
   - Botão de **câmera** no campo de código de barras e no lançador (Chrome).

## Observações
- O lançador NÃO baixa o estoque central automaticamente (decisão atual — manual).
- Câmera usa `BarcodeDetector` (Chrome Android/desktop). No iPhone, usar leitor USB ou digitação.
- Não publique sem rodar o SQL no Supabase.
