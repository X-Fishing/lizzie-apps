# Handoff: Sistema de Semijoias (Lizzie)

## Overview
Sistema completo de gestão para a Lizzie Semijoias: cadastro e aprovação de revendedoras, clientes finais, controle de vendas, mostruários, garantias, estoque/fornecedores/produtos, financeiro, precificação, e módulos de marketing (raspadinha, fidelidade, bônus de aniversário) e RH (funcionários, perfis, comissão). 23 telas no total.

## About the Design Files
Os arquivos `.dc.html` neste pacote são **referências de design em HTML** — protótipos de alta fidelidade mostrando aparência e comportamento pretendidos, não código de produção para copiar diretamente. A tarefa é **recriar essas telas no ambiente real do projeto** (React, Vue, ou o stack que for escolhido) usando os padrões e bibliotecas já estabelecidos no codebase — ou, se ainda não existir um ambiente, escolher o framework mais adequado e implementar as telas nele.

Cada arquivo é auto-suficiente: abre direto no navegador. `support.js` e `image-slot.js` são includes compartilhados (dados mock e o componente de upload de foto) — não precisam ser recriados 1:1, apenas a funcionalidade que representam (dados vindos de API real; upload/crop de imagem persistido).

## Fidelidade
**Alta fidelidade (hifi)**: cores, tipografia, espaçamento e interações finais. Recrie pixel a pixel usando os componentes/bibliotecas já existentes no codebase de destino.

## Padrão compartilhado (shell)
Todas as 23 telas usam a mesma casca, definida inline em cada arquivo (sem CSS externo — é assim que o protótipo faz o conteúdo aparecer instantaneamente; no app real isso deve virar um layout/component compartilhado):

- **Sidebar** fixa à esquerda, recolhível (232px aberta / 60px fechada), fundo branco, com grupos: Dashboard, Vendas (Controle de Vendas, Revendedoras, Clientes, Lançar Mostruário, Troca de Mostruário, Garantias), Estoque (Fornecedores, Produtos, Categorias, Coleções, Entrada de Mercadoria, Precificação, Calculadora), Financeiro (Lançamentos, Formas de Pagamento*, Categorias Financeiras*), Marketing (Raspadinha, Fidelidade*, Bônus de Aniversário), Configurações (Funcionários, Perfis & Permissões, Faixas de Comissão). Itens marcados com "EM BREVE" (badge dourado) são features futuras — item selecionado tem fundo rosa claro `rgba(201,116,138,0.10)` e texto `#c9748a` em negrito.
- **Topbar** fundo `#1a0a2e` (roxo escuro), breadcrumb à esquerda em branco 50% opacidade com último nível em dourado `#d4a84b`, badge de papel (ex. "STAFF") à direita com borda `#c9748a`.
- **Área de conteúdo**: max-width 1200–1280px, padding `26px 32px 48px`, fundo geral `#faf7f2`.
- **Padrão de tela**: cabeçalho (título + subtítulo + botão de ação principal) → cards de estatística (grid, número grande em Cormorant Garamond) → busca/filtros (chips arredondados) → tabela ou grid de cards → modal de detalhe/edição (overlay `rgba(26,10,46,0.7)` com blur, painel branco-rosado `#faf7f2` arredondado 20px).

## Design Tokens

**Cores**
- Fundo geral: `#faf7f2`
- Texto principal: `#2d1f35` / títulos `#1a0a2e`
- Rosa/plum (marca, ações primárias): `#c9748a` → gradiente `linear-gradient(135deg,#c9748a,#b5526a)`
- Roxo escuro (topbar, títulos): `#1a0a2e`
- Dourado (destaque, badges "em breve"): `#d4a84b`
- Texto secundário/labels: `#8a7590`
- Sucesso/ativo: `#4caf82`
- Alerta/pendente: `#e8a838`
- Erro/revogado: `#e05555`
- Bordas: `rgba(201,116,138,0.2)` (1 a 1.5px)
- Sombra padrão de card: `0 2px 10px rgba(0,0,0,0.04)` a `0 2px 20px rgba(0,0,0,0.3)` na topbar

**Tipografia**
- Display/números/títulos: `Cormorant Garamond` (300–600), serif
- Corpo/UI: `DM Sans` (400–700), sans-serif
- Google Fonts, carregadas via `<link>` em cada arquivo

**Espaçamento e forma**
- Raio de borda: 8–14px em cards/inputs, 20px em modais e pills/badges, 50% em avatares
- Grid de stats: `repeat(3-4, 1fr)`, gap 12px
- Grid de cards: `repeat(auto-fill, minmax(240px,1fr))`, gap 14px

## Screens (23)

### Vendas
1. **Controle de Vendas** — listagem de vendas, filtros por status/período, detalhe de venda.
2. **Revendedoras** — cadastro/aprovação de acesso. Grid de cards com foto (via `<image-slot>`, circular, iniciais como placeholder), nome, cidade/telefone, badges de status (Ativa/Pendente), teste, funcionária, cadastro incompleto. Modal com aba Detalhe (contato, documentos, ações: editar, aprovar/revogar acesso, marcar como teste) e Formulário (identificação, dados pessoais, endereço).
3. **Clientes** — cadastro de clientes finais.
4. **Lançar Mostruário** — atribuição de mostruário a revendedora.
5. **Troca de Mostruário** — fluxo de troca de peças do mostruário.
6. **Garantias** — abertura/acompanhamento de garantias, com foto da peça via `<image-slot>`.

### Estoque
7. **Fornecedores** — cadastro de fornecedores.
8. **Produtos** — catálogo, com fotos via `<image-slot>` (foto principal + galeria).
9. **Categorias** — categorias de produto.
10. **Coleções** — coleções/linhas de produto.
11. **Entrada de Mercadoria** — registro de entrada de estoque.
12. **Precificação** — regras de precificação.
13. **Calculadora** — calculadora de preço final (peso × cotação + mão de obra + banho + desconto fornecedor + verniz + margem + overhead).

### Financeiro
14. **Lançamentos** — lançamentos financeiros.
15. **Formas de Pagamento** *(em breve)*.
16. **Categorias Financeiras** *(em breve)*.

### Marketing
17. **Raspadinha** — mecânica de raspadinha promocional.
18. **Fidelidade** *(em breve)* — programa de pontos/fidelidade.
19. **Bônus de Aniversário** — recompensas automáticas (voucher/desconto) para revendedoras e clientes finais aniversariantes do mês. Stats (aniversariantes, enviados, pendentes, valor total), filtro por perfil (Revendedora/Cliente final), tabela com nome, aniversário, recompensa e status de envio.

### Configurações
20. **Funcionários** — cadastro da equipe interna.
21. **Perfis & Permissões** — papéis e permissões de acesso ao sistema.
22. **Faixas de Comissão** — faixas Ouro/Prata/Bronze do sistema de bonificação da equipe interna.
23. **Dashboard** — visão geral com KPIs principais.

## Interações & Comportamento
- Modais: clique fora fecha (`onclick` no overlay + `stopPropagation` no painel); `×` no canto superior direito.
- Cards e linhas de tabela: hover eleva o card (`translateY(-2px)` + sombra) ou realça o fundo (`rgba(201,116,138,0.04)`).
- Sidebar: toggle recolhe para 60px (só ícones), com transição `width 0.2s`.
- Busca e filtros (chips) são client-side sobre a lista mock; chip ativo vira fundo `#c9748a` sólido com texto branco.
- Upload de foto (`<image-slot>`): drag-and-drop ou clique para selecionar; reframe (double-click) permite pan/zoom da imagem; no app real deve persistir a foto tirada pela própria revendedora via app.

## Assets
Nenhum asset de imagem externo — placeholders via `<image-slot>` (componente próprio deste ambiente de prototipagem; no app real, substituir por upload real com preview, ex. usando input file + crop). Ícones são SVGs inline (Lucide-style, stroke 1.8px).

## Arquivos deste pacote
Todas as 23 telas (`.dc.html`), mais `support.js` (dados mock — substituir por chamadas de API reais) e `image-slot.js` (componente de upload/preview de imagem usado como referência de comportamento, não para reuso direto).
