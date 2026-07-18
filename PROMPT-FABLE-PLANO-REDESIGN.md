# PROMPT (para o Claude Fable no VS Code) — Montar o PLANO DE AÇÃO do redesign do Sistema

> **Seu papel aqui é PLANEJAR, não executar.** Produza um plano de ação detalhado e faseado que o Opus vai executar depois. Não edite código de feature nesta rodada — só leia o codebase, leia o design e escreva o plano.
> Trabalhe na pasta **`D:\lizzie-apps`**. Entregue o plano em `PLANO-REDESIGN.md` na raiz do projeto.

## Contexto
Chegou um **design handoff de alta fidelidade** com **23 telas** para o Sistema de Semijoias da Lizzie, em `referencias/design_handoff/` (arquivos `.dc.html` + `README.md` + `support.js` + `image-slot.js`). O objetivo é **recriar essas telas no app real**, padronizando o visual — **não** é um app novo.

O app **já existe, está em produção e funcionando**: PWA em **JavaScript puro + Vite + ES modules**, backend **Supabase** (Auth + RLS + RPC + Edge Functions para o Bling). Módulos em `src/` (ver abaixo). Migrations em `supabase/migrations/` (já vão até `0019`).

## ⚠️ Regras inegociáveis do plano (o Opus vai seguir à risca)
1. **NÃO trocar de stack.** É vanilla JS + Vite + ES modules. **Proibido** introduzir React/Vue/Svelte ou qualquer framework, apesar do que o README do handoff sugere. Usar os padrões já existentes (`menu.js`/`router.js`/`state.js`, os helpers de `utils.js`, a classe de ícones `.ico`, o bucket `lizzie-fotos`).
2. **NÃO reconstruir lógica de negócio a partir do mockup.** O `.dc.html` é **só aparência**. Para telas que já existem, o trabalho é **reskin/ajuste visual preservando 100% da lógica** (RLS, permissões por `chave_menu`, ciclo de 35 dias, comissão 30%/35%, dedupe de produtos, RPCs, Edge Functions). Perder lógica = falha do plano.
3. **Cuidado redobrado com módulos recém-consertados.** `consignados.js` (catálogo/ciclo/histórico) e `financeiro.js` tiveram bugs críticos corrigidos há pouco. Redesenhar essas telas é **alto risco** — deixe-as para as últimas fases, com teste reforçado.
4. **Sem emoji.** Ícones = a família de linha `.ico` (SVG) já usada no app.
5. **Cada passo do plano deve caber num PR pequeno**, com critério de teste e possibilidade de rollback.

## Passo 1 — LER de verdade (não presuma)
- Leia `referencias/design_handoff/README.md` (tokens, shell, lista das 23 telas) e **abra cada um dos 23 `.dc.html`** para entender layout, componentes e estados.
- Leia o codebase real: **todos os `src/*.js`** (em especial `menu.js`, `router.js`, `nav.js`, `state.js`, e os módulos de tela), o `index.html`, e a lista de `supabase/migrations/`.
- Módulos existentes hoje: `admin, auth, bling, cadastros, consignados, dashboard, divulgar, financeiro, funcionarios, garantias, historico, lancador, menu, nav, pagamentos, perfil, precificacao, produtos, router, state, supabase, trocas, utils`.

## Passo 2 — Tabela de mapeamento (o coração do plano)
Para **cada uma das 23 telas**, uma linha com:
| Tela (design) | Situação | Módulo/arquivo alvo | Lógica a PRESERVAR | Delta visual vs. hoje | Risco |
|---|---|---|---|---|---|

- **Situação** = um de: `EXISTE` (reskin), `PARCIAL` (completar), `NOVA` (criar do design).
- Classifique com base no que você **encontrar no código**, não no meu palpite. Referência inicial (confira):
  - EXISTE: Controle de Vendas (`consignados`), Revendedoras (`admin` — cadastro + contrato **já feitos**, migrations 0016–0019, NÃO refazer), Garantias, Lançar Mostruário (`lancador`), Troca de Mostruário (`trocas`), Fornecedores/Categorias/Coleções (`cadastros`), Produtos (`produtos`), Precificação (`precificacao`), Lançamentos (`financeiro`), Raspadinha, Funcionários, Perfis & Permissões (`menu`/perfis), Faixas de Comissão, Dashboard.
  - PARCIAL/NOVA (validar): Clientes, Calculadora, Entrada de Mercadoria, Formas de Pagamento (em breve), Categorias Financeiras (em breve), Fidelidade (nova), Bônus de Aniversário (nova).

## Passo 3 — Conflitos a resolver (documentar decisão no plano)
1. **Shell compartilhado:** o mockup repete sidebar+topbar inline em cada tela. No app isso já é `menu.js`/`nav.js`/`index.html`. Plano: extrair/ajustar **um** layout compartilhado, não 23 cópias.
2. **Menu:** o handoff agrupa **Entrada de Mercadoria, Precificação e Calculadora dentro de Estoque**; conferir contra o `menu.js` atual e propor a estrutura final (mantendo as `chave` de permissão — mover é ok, renomear chave NÃO). Alinhar labels ("Bônus" vs "Bônus de Aniversário").
3. **`<image-slot>`** (upload/crop do design) → mapear para o upload já existente no bucket `lizzie-fotos` (`produtos.js`/`garantias.js`); não recriar componente do zero.
4. **Tokens:** confirmar que os tokens do handoff == variáveis CSS já no app (devem bater). Se baterem, o reskin é leve; documentar quaisquer diferenças reais.
5. **Trabalho em voo:** existem prompts recentes de Produtos (importar por faixa de SKU, importar fotos em lote) e o menu reestruturado — o plano deve dizer como conviver com isso, sem colidir.

## Passo 4 — Faseamento (do menor risco ao maior)
Proponha fases nesta lógica (ajuste conforme o que achar):
- **Fase 0 — Fundação visual:** consolidar o shell/layout e um arquivo de tokens/estilos compartilhado; padronizar cards de stat, tabelas, chips de filtro, modais — sem tocar em lógica. Ganho visual amplo, risco baixo.
- **Fase 1 — Telas novas** (Clientes, Bônus de Aniversário, Fidelidade, Calculadora, Formas de Pagamento, Categorias Financeiras): construir direto do design, tira os "em breve".
- **Fase 2 — Reskin de telas simples que já existem** (Fornecedores, Categorias, Coleções, Funcionários, Faixas de Comissão, Perfis & Permissões, Dashboard).
- **Fase 3 — Reskin de telas com lógica pesada, com teste reforçado** (Produtos, Garantias, Lançar/Troca de Mostruário, Lançamentos, Precificação, Entrada de Mercadoria).
- **Fase 4 — Alto risco, por último** (Controle de Vendas / `consignados` — catálogo, ciclo, histórico, fechamento; foi onde consertamos bugs críticos).

Para **cada fase**: objetivo, telas incluídas, arquivos tocados, o que testar (checklist funcional + `npm run lint` + `npm run build`), e commits sugeridos (um por tela/PR pequeno).

## Passo 5 — Registro de riscos
Liste os riscos (perda de lógica, regressão em permissão, quebra de RLS, cache de PWA/service worker, divergência de menu) e a mitigação de cada um. Marque explicitamente as telas "não tocar / já prontas".

## Entregável
Um único arquivo **`PLANO-REDESIGN.md`** contendo: resumo executivo, a tabela de mapeamento das 23 telas, as decisões de conflito, o faseamento com checklists, o registro de riscos, e uma ordem de execução recomendada. **Não gere código de feature agora** — o Opus executa depois, fase por fase, com aprovação do Rondon entre elas.

## Conferência final (antes de entregar o plano)
- Todas as 23 telas aparecem na tabela? Cada uma com módulo alvo e situação?
- O plano deixa claro o que **não** refazer (Revendedoras, Precificação)?
- O plano proíbe framework e preserva lógica/permissões?
- As fases vão do menor pro maior risco, com `consignados` por último?
