# PLANO DE AÇÃO — Redesign do Sistema (23 telas do design handoff)

> Executor: Opus, fase por fase, **com aprovação do Rondon entre fases**.
> Handoff em `referencias/design_handoff/` (23 `.dc.html` + README). O `.dc.html` é SÓ aparência.
> Data-base: main `e1a8418` (menu reestruturado; revendedoras + contrato prontos; migrations até 0019).

## Resumo executivo

- **A base visual já bate.** Os tokens do handoff (plum `#1a0a2e`, rose `#c9748a`, gold `#d4a84b`, blush `#f5e6ec`, cream `#faf7f2`, success/warning/danger, fontes **Cormorant Garamond** + **DM Sans**, radius 8–20px) são **idênticos** ao `:root` de `src/styles.css`. Não há retrabalho de paleta: o redesign é (a) polir o shell, (b) padronizar ~6 componentes (stat/KPI card, tabela, chips de filtro, modal, empty-state, breadcrumb), (c) construir 6 telas novas, (d) reskin das existentes **preservando 100% da lógica**.
- **O menu atual já é o do handoff** (Estoque com Entrada de Mercadoria/Precificação/Calculadora; Financeiro/Marketing como grupos; Configurações). Único delta: adicionar **Fidelidade** (em breve) no grupo Marketing.
- **Stack intocada:** vanilla JS + Vite + ES modules. O runtime React do handoff (`support.js`) e o web component `image-slot.js` são infra de protótipo — **ignorar/não portar**. Ícones = família `.ico` (SVG de linha). **Sem emoji.**
- **5 fases**, do menor pro maior risco; `consignados.js` e `financeiro.js` (bugs críticos recém-corrigidos) ficam **por último** (Fase 4).
- Cada item de fase = **1 PR/commit pequeno** com checklist de teste + rollback (`git revert`; painéis são independentes, regressão fica contida na tela).

## Regras inegociáveis (o executor segue à risca)

1. **PROIBIDO** React/Vue/Svelte/qualquer framework. Padrões existentes: `menu.js` (registry declarativo), `router.js` + `nav.js` (navegação por hash + `showPanel`/`aplicarTela`), `state.js`, helpers de `utils.js` (`esc`, `sbQ`, `toast`, `fetchPaginado`, `confirmarAcao`, masks), template strings + `onclick` global via `Object.assign(window, …)` no `main.js`.
2. **Mockup é aparência.** Onde o mockup divergir do modelo de dados/negócio real, **vale o app** (Precificação, Perfis & Permissões, Faixas de Comissão, Raspadinha — ver "Decisões de conflito").
3. **Não tocar na lógica** de: RLS/policies, permissões por `chave_menu` (mover item de grupo é ok; **renomear chave JAMAIS**), ciclo/fechamento, comissão, dedupe de produtos, RPCs, Edge Functions.
4. **Telas prontas — NÃO refazer:** Revendedoras (cadastro + contrato, migrations 0016–0019) e o motor de Precificação/Entrada de Mercadoria (0013–0015). Nelas, no máximo, polimento visual pontual.
5. Sem emoji. `npm run lint` + `npm run build` verdes em **todo** commit.

## Tabela de mapeamento — as 23 telas

| # | Tela (`.dc.html`) | Situação | Módulo/arquivo alvo | Lógica a PRESERVAR | Delta visual vs. hoje | Risco |
|---|---|---|---|---|---|---|
| 1 | Dashboard | EXISTE | `dashboard.js` (`loadDashboardStaff`) · `panel-dashboard` | filtro `ehRevTeste`, fetchPaginado de vendas; dashboard da REVENDEDORA intocado | KPI cards com delta ▲▼, chips Hoje/Semana/Mês, gráfico de barras CSS (`.dash-bars` já existe), feed "Atividade recente" (novo, derivar de vendas/garantias recentes) | Médio |
| 2 | Revendedoras | **PRONTA — NÃO REFAZER** | `admin.js` | TUDO (0016–0019, contrato, checklist, ViaCEP, LGPD docs) | Só se sobrar tempo: stat cards + chips (filtro client-side do cache). Modal dual-mode do mockup **ignorado** (form full-page atual fica) | Alto se mexer → tocar o mínimo |
| 3 | Clientes | NOVA | novo `clientes.js` + migration (`clientes`, RLS staff) | — (hoje stub em `dashboard.js:loadClientes`) | Tela do design: stats, busca, tabela, modal detalhe+form. Dedupe por celular (roadmap M3) | Médio (migration) |
| 4 | Lançar Mostruário | EXISTE | `lancador.js` | bipe USB + câmera `BarcodeDetector`, busca F3, montagem de consignados, destino nova/existente | Wizard visual 1–2, footer fixo com total, stepper de qtd | Alto (scanner sensível a foco/DOM) |
| 5 | Troca de Mostruário | EXISTE | `trocas.js` | próximas trocas via pedidos Bling, botão WhatsApp | Stat cards com border-left colorido; cards agrupados por urgência (Vencidas/7 dias/Mês/Sem data) | Médio |
| 6 | Garantias | EXISTE | `garantias.js` | status flow, prazo 90 dias, upload foto (`lizzie-fotos`), permissões | Cards de distribuição % por status + ranking B.O.; tabela com foto; pipeline horizontal de status no detalhe | Médio-alto |
| 7 | Fornecedores | EXISTE | `cadastros.js` (engine CFG) | CRUD engine; campo `desconto` (a precificação usa!) | Tabela padronizada + stats. Logo/avatar do mockup = backlog | Baixo |
| 8 | Produtos | EXISTE | `produtos.js` | TUDO: dedupe SKU/barras, importar Bling por faixa, fotos em lote, planilha CSV, variações, custo inline, precif no form | Já perto do design. Delta: 4 stat cards (Produtos/Peças/Valor/Sem foto); polir tabela/paginação | Médio (arquivo grande — só render) |
| 9 | Categorias | EXISTE | `cadastros.js` | engine + `banho_padrao` | Lista simples do design (reskin leve) | Baixo |
| 10 | Coleções | EXISTE | `cadastros.js` | engine | Grid de cards (engine ganha "modo card") | Baixo |
| 11 | Entrada de Mercadoria | **PRONTA (recém-construída)** | `precificacao.js` | planilha viva, cálculo por linha, lançamento em lote | Conferir 1:1 com o design; ajuste de estilo apenas | Baixo (não mexer na lógica) |
| 12 | Precificação | EXISTE — **mockup diverge** | `precificacao.js` | parâmetros/cotações/banhos reais (0013) | Mockup mostra "regras de margem por categoria" = OUTRO modelo → **ignorar o do mockup**; reskin da tela real | Baixo (visual) |
| 13 | Calculadora | EXISTE | `precificacao.js` (`loadCalculadora`) | motor `calcularPrecificacao`, categoria pré-preenche padrões | Layout 2 colunas + painel escuro sticky com resultado ao vivo (cálculo já é reativo) | Baixo-médio |
| 14 | Lançamentos | EXISTE — **recém-consertado** | `financeiro.js` | recebimentos, PIX BR Code, estorno (`acao_estornar_recebimento`) | Stats + tabela padronizada + modal | **Alto → Fase 4** |
| 15 | Formas de Pagamento | NOVA | `cadastros.js` (novo CFG) + migration (`formas_pagamento`: nome, taxa_pct, prazo_dias) | — (stub) | Cards taxa+prazo do design; tirar "em breve" | Baixo |
| 16 | Categorias Financeiras | NOVA | `cadastros.js` (novo CFG) + migration (`categorias_financeiras`: nome, tipo) | — (stub) | Lista do design; tirar "em breve" | Baixo |
| 17 | Raspadinha | PARCIAL — **mockup diverge** | `cadastros.js` (config atual) | config real = valor por raspadinha (régua da revendedora usa!) | Mockup traz campanha/prêmios/probabilidades = mecânica nova → **backlog**; reskin leve da config atual | Baixo (visual) |
| 18 | Fidelidade | NOVA (estática) | novo `panel-fidelidade` | — | Somente leitura (níveis Bronze/Prata/Ouro + benefícios, box "em desenvolvimento"); item de menu `marketing_fidelidade` | Muito baixo |
| 19 | Bônus | NOVA | novo `bonus.js` · `panel-bonus` (já no HTML) | nascimento das revendedoras já existe (`revendedora_docs.data_nascimento`, RLS gestor) | Tabela de aniversariantes + chips + "Avisar" via `wa.me` (sem API). Clientes finais entram DEPOIS da tela 3 | Médio |
| 20 | Controle de Vendas | EXISTE — **recém-consertado** | `consignados.js` | TUDO: ciclo, maletas ativa/aguardando, carrinho, fechamento+conferência, PDF, divergência, comissão por faixa | KPI hero escuro, cards por revendedora com barra de conversão, modal de catálogo | **Muito alto → Fase 4, por último** |
| 21 | Funcionários | EXISTE | `funcionarios.js` | vínculo por e-mail, is_admin, perfil_id | Stats + tabela padronizada | Baixo |
| 22 | Perfis & Permissões | EXISTE — **mockup diverge** | `funcionarios.js` (`loadPerfis`) | modelo real = 1 checkbox por `chave_menu` (só-ver-menu) + `ACOES` | Mockup mostra matriz Módulo×(Ver/Criar/Editar/Excluir) que **não existe** → ignorar; reskin do checklist atual | Baixo (visual) |
| 23 | Faixas de Comissão | EXISTE — **mockup diverge** | `cadastros.js` | faixas por VALOR com percentual, editáveis (fechamento usa!) | Mockup mostra cards estáticos por "nota" = outro modelo → ignorar; reskin leve sobre os dados reais | Baixo (visual) |

Conferência: **23/23 telas mapeadas**, cada uma com situação + módulo + risco.

## Decisões de conflito

1. **Shell compartilhado:** o mockup repete sidebar+topbar inline; no app já é `menu.js` + `index.html` + `.snav-*`. Fase 0 ajusta o shell EXISTENTE — (a) **breadcrumb** na topbar (`Grupo / Tela`, nível final em gold, derivado do item ativo do MENU), (b) **sidebar colapsável para trilho de 60px** com só ícones (hoje `snav-fechada` esconde tudo; o design mantém rail), (c) scrollbar custom + badge de papel (o `user-badge` já existe). **Não criar 23 cópias nem tocar na estrutura de painéis.**
2. **Menu:** já idêntico ao handoff. Delta único: **Fidelidade** (`chave: marketing_fidelidade`, em_breve até a Fase 1) no grupo Marketing. Manter label "Bônus". **Nenhuma chave renomeada.**
3. **`<image-slot>`:** NÃO portar o web component. Mapear para uploads existentes: produtos (galeria 5, `lizzie-fotos`, pronto), garantias (foto, pronto), revendedora (avatar = padrão `perfil.js`, backlog), clientes/fornecedores (avatar/logo = backlog). Crop/reframe do protótipo fica de fora.
4. **Tokens:** handoff == `:root` atual (hex a hex, fontes idênticas). Fase 0 só ADICIONA tokens que faltam como variável (sombras padrão, hover de card, gradiente rose `linear-gradient(135deg,#c9748a,#b5526a)` hoje hardcoded) — sem trocar valores.
5. **Trabalho em voo:** fotos em lote / faixa de SKU / planilha / menu / revendedoras / contrato **já mergeados na main** — sem colisão. Branches antigas (`feat/fotos-lote`, `feat/menu-reestrutura`, `feat/revendedoras-cadastro`, `backup-fotos-lote-pre-merge`) podem ser apagadas. Trabalho novo durante o redesign: alinhar com o Rondon antes de tocar `produtos.js`/`admin.js`.
6. **Gráficos:** todos em CSS/div (como o mockup) — **sem lib de charts** (`.dash-bars` já faz isso).

## Faseamento

> Cada item: 1 commit/PR; testar no `npm run dev` (staff + revendedora quando aplicável); `npm run lint` + `npm run build` verdes; rollback = revert. Migrations em `supabase/migrations/00XX_*.sql` idempotentes, rodadas pelo Rondon antes do teste.

### Fase 0 — Fundação visual (sem lógica) · risco baixo
**Objetivo:** shell + kit de componentes; ganho visual em todas as telas de uma vez.
Arquivos: `src/styles.css`, `src/menu.js` (render do shell/breadcrumb), `index.html` (topbar).
1. Tokens complementares no `:root` (sombras, hover, gradiente rose) + utilitárias novas: `.kpi-card` (stat com ícone + delta ▲▼), unificação visual de `.pag-table`/`.ciclo-table`, `.chips` (filtros), `.page-head` (título+ações), empty-states.
2. Breadcrumb na topbar derivado do MENU + badge de papel.
3. Sidebar: colapso para trilho de 60px (ícones + tooltip), transição 0.2s, estado persistido.
4. Item de menu "Fidelidade" (em_breve).
**Teste:** navegar por TODAS as telas nos 3 papéis (admin/func/revendedora); permissões inalteradas; mobile da revendedora intocado.
Commits: `feat(ui): tokens+kit`, `feat(ui): breadcrumb`, `feat(ui): sidebar rail`, `feat(menu): item fidelidade (em breve)`.

### Fase 1 — Telas novas (tiram os "em breve") · risco baixo/médio
1. **Fidelidade** (estática, sem migration) — `panel-fidelidade` + render.
2. **Formas de Pagamento** — migration `formas_pagamento` (nome, taxa_pct, prazo_dias, ativo; RLS staff-read/gestor-write) + CFG novo no `cadastros.js` (modo card).
3. **Categorias Financeiras** — migration `categorias_financeiras` (nome, tipo receita|despesa, ativo) + CFG novo.
4. **Clientes** — migration `clientes` (nome, celular único normalizado, email, nascimento, cidade, obs; RLS select/write staff) + módulo `clientes.js` (stats, busca, tabela, modal detalhe+form).
5. **Bônus** — `bonus.js`: aniversariantes do mês (revendedoras via `revendedora_docs` — só gestor; clientes via tabela nova), chips, "Avisar" via `wa.me`. Tirar em_breve.
**Teste por tela:** CRUD completo, RLS (func_basico onde couber), menu sem "EM BREVE", permissão nova no checklist de perfis.

### Fase 2 — Reskin de telas simples · risco baixo
Ordem: **Categorias → Coleções (modo card) → Fornecedores → Funcionários → Faixas de Comissão → Perfis & Permissões → Dashboard staff**.
- Nas 5 primeiras: só o RENDER muda (handlers do engine `cadastros.js`/`funcionarios.js` intocados). Faixas/Perfis: manter modelo real (decisões 22/23).
- Dashboard: KPIs com delta, chips de período, atividade recente. **Não tocar** no dashboard da revendedora.
**Teste:** cada CRUD ponta a ponta + checklist de permissões continua salvando.

### Fase 3 — Reskin com lógica pesada (teste reforçado) · risco médio/alto
Ordem: **Produtos → Garantias → Troca de Mostruário → Calculadora → Precificação (leve) → Entrada de Mercadoria (conferência 1:1) → Lançar Mostruário (por último)**.
- Produtos: stats no topo; NÃO tocar em importadores/planilha/dedupe (só chrome visual).
- Garantias: cards de distribuição/ranking + pipeline (visual sobre o flow atual).
- Lançar Mostruário: wizard visual SEM mudar o foco do scanner — testar bipe físico + câmera + F3 após cada mudança.
**Teste reforçado:** roteiro funcional por tela, console limpo, lint/build.

### Fase 4 — Alto risco, por último · aprovação explícita antes
1. **Lançamentos (`financeiro.js`)** — stats+tabela+modal; PIX/estorno intocados. Testar: receber maleta parcial/total, estorno (permissão), PIX copia-e-cola.
2. **Controle de Vendas (`consignados.js`)** — KPI hero, cards por revendedora, modal catálogo. Mexer SÓ nas funções de render (`renderCicloGrid`, `renderCicloAdmin`, `renderCicloRevendedora`, `cicloTableHtml`), NUNCA em fechamento/conferência/venda/carrinho. Testar: ciclo completo em conta de **TESTE** — lançar → vender → fechar com conferência → PDF → histórico; catálogo da revendedora no celular.

## Registro de riscos

| Risco | Mitigação |
|---|---|
| Perda de lógica ao "recriar do mockup" | Mudar SÓ funções de render; handlers/queries intocados. Diff review por tela; PR pequeno. |
| Regressão de permissão (`chave_menu`) | Chaves congeladas; testar com perfil restrito (Funcionário Parcial) após cada fase. |
| Quebra de RLS em migration nova | Padrão das migrations existentes (idempotente, policies explícitas, sem anon); probe anônimo pós-migration. |
| PWA/service worker servindo versão velha | Após cada deploy: hard refresh; fechar o app instalado; conferir `dist/sw.js` novo no build. |
| Scanner do Lançador quebrar com DOM novo | Preservar ids/autofocus/handlers de teclado; testar com leitor físico antes do merge. |
| `consignados`/`financeiro` regressão | Fase 4 isolada, conta de teste, roteiro completo, plano de revert. |
| Divergência mockup×modelo (Precificação, Perfis, Faixas, Raspadinha) | Decisões registradas: **vale o app**. Mecânica de prêmios da Raspadinha = backlog p/ decisão do Rondon. |
| Telas prontas (Revendedoras/Entrada) | Marcadas "não refazer"; ajuste = polimento mínimo, sem tocar salvar/contrato/lançamento. |

## Ordem de execução recomendada

Fase 0 (1 sessão) → deploy + validação visual → Fase 1 (novas, uma a uma) → Fase 2 → Fase 3 → **pausa e aprovação** → Fase 4. Entre TODAS as fases: aprovação do Rondon, deploy incremental na `main`, e as migrations rodadas por ele no SQL Editor.

**Backlog anotado (fora do redesign):** avatar de revendedora/cliente e logo de fornecedor (upload), mecânica de prêmios da Raspadinha, crop de imagem, API oficial do WhatsApp, feed de atividade recente com fonte dedicada.
