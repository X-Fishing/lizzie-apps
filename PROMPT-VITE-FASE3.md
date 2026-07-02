# PROMPT — Vite Fase 3: quebrar `src/main.js` em módulos por domínio

> Continuação da migração. Rode na **branch `fase2-vite`**, com a Fase 2 já funcionando.
> **Regra de ouro: comportamento idêntico.** É só reorganizar — nada de mudar funcionalidade.
> **Um módulo por commit. Teste o app inteiro (`npm run dev`) depois de CADA módulo.**

## Verificação antes de começar (evita trabalhar na pasta errada)
No terminal:
```
git branch --show-current      # tem que ser: fase2-vite
ls src                         # tem que listar: main.js, styles.css, supabase.js
git status -sb                 # árvore limpa (fora arquivos novos esperados)
```
Se não bater, PARE e me avise — não comece a Fase 3 numa cópia/branch errada.

## O grande perigo desta fase: estado global compartilhado
O `main.js` tem **variáveis globais** usadas por várias áreas: `currentUser`, `profile`, `allConsignados`, `carrinhoVenda`, `cicloRevSelecionada`, `historicoCicloSel`, `revNameMap`, `revBlingMap`, `cSort`, etc. Em ES modules elas **deixam de ser globais** — se cada módulo declarar a sua, viram cópias separadas e o app quebra de formas sutis (login não propaga, carrinho some, etc.).

**Solução — um módulo de estado compartilhado.** Crie `src/state.js`:
```js
// Estado compartilhado entre módulos. Sempre MUTAR as propriedades (state.x = ...),
// nunca reatribuir o objeto. Assim todos os módulos enxergam o mesmo valor.
export const state = {
  currentUser: null,
  profile: null,
  allConsignados: [],
  carrinhoVenda: [],
  cicloRevSelecionada: null,
  historicoCicloSel: null,
  revNameMap: {},
  revBlingMap: {},
  cSort: { col: 'descricao', dir: 'asc' },
  // …adicione TODA variável global que for compartilhada entre arquivos
};
```
Nos módulos: `import { state } from './state.js'` e troque `currentUser` por `state.currentUser`, `allConsignados` por `state.allConsignados`, etc. (Variáveis usadas só dentro de um módulo podem continuar locais nele — não precisa jogar tudo no state, só o que é compartilhado.)

## O outro perigo (já conhecido): handlers no `window`
Toda função chamada por `onclick=`/`oninput=`/`onkeydown=` — **inclusive as geradas dentro de template strings no JS** — precisa estar no `window`. Mantenha **um único** `Object.assign(window, { … })` no `main.js`, importando as funções de cada módulo. Depois de mover cada módulo, **reextraia a lista de handlers do HTML + dos templates** e cruze com o `Object.assign` (o mesmo cuidado da Fase 2).

---

## Módulos sugeridos (ordem de extração)
Comece pelos que não dependem de mais nada e vá subindo. Cada um exporta suas funções; importa `state`, `supabase` e `utils` conforme precisa.

1. **`utils.js`** — helpers puros: `esc`, `toast`, `showMsg`, `formatDate`, `fmtBRL`, `qtdDisp`, `detectarCategoria`, `CAT_LABEL`, `handleSupabaseError`, `sbQ`, `fetchPaginado`, `confirmarAcao`, `openModal`/`closeModal`/`fecharModal`. (Sem dependência de domínio.)
2. **`supabase.js`** — já existe (exporta `sb`). Se as URLs das Edge Functions do Bling estiverem aqui, ok; senão deixe em `bling.js`.
3. **`auth.js`** — `fazerLogin`, `fazerCadastro`, `loginGoogle`, `switchTab`, `mostrarRecuperar`, `voltarLogin`, `enviarLinkRecuperacao`, `salvarNovaSenha`, `loadUser`, o `onAuthStateChange`, e os papéis `ehStaff`/`ehGestor`/`ehRevendedora`. Usa `state.currentUser`/`state.profile`.
4. **`nav.js`** — `showPanel`, `toggleCadastros`, `PANEIS_STAFF`.
5. **`dashboard.js`** — `loadDashboard` + render do dashboard (revendedora e staff/PC).
6. **`garantias.js`** — listar/salvar/editar/`mudarStatus`/`excluirGarantia`/`verGarantia` + a visão visual do staff.
7. **`consignados.js`** (o maior) — `loadConsignados`, `renderCicloGrid`/`renderCicloAdmin`/`renderCicloAdminDetalhe`/`renderCicloRevendedora`, `cicloRowHtml`/`cicloTableHtml`/`cicloSortRows`/`cicloTh`, `soAtivos`/`soEncerrados`/`ciclosEncerrados`/`historicoCatalogosHtml`/`pecasDoCiclo`/`renderHistoricoCicloDetalhe`/`abrirHistoricoCiclo`/`voltarHistoricoCiclo`, `finalizarCicloRev`/`deletarCicloRev`, carrinho (`openVenda`, `adicionarAoCarrinho`, `confirmarVendaCarrinho`, `removerDoCarrinho`, `abrirFinalizarVenda`, `renderCartBar`), `openFechamento`/`gerarPdfFechamento`, `openBuscaPeca`/`renderBuscaPeca`, `abrirCicloRev`/`voltarCardsCiclo`. (Se ficar grande demais, dá pra dividir depois em `consignados.js` + `vendas.js` + `fechamento.js` — mas só num segundo momento.)
8. **`bling.js`** — `atualizarMaleta`, `confirmarMaleta`, `detectarBlingId`, `openBlingSync`, e as constantes `BLING_FN`/`BLING_ITENS_FN`/`BLING_HEADERS` (montadas a partir de `import.meta.env.VITE_SUPABASE_URL`).
9. **`pagamentos.js`** — painel de pagamentos.
10. **`historico.js`** — histórico de vendas das clientes (`loadHistorico`, `filtrarHistorico`).
11. **`trocas.js`** — painel de trocas.
12. **`admin.js`** — revendedoras: `aprovarRev`, `revogarRev`, `confirmarExclusaoRev`, gestão de papéis, lista.

O `main.js` no fim vira fino: importa os módulos, faz o `Object.assign(window, …)` com os handlers, e chama o `init()`/bootstrap.

---

## Procedimento por módulo (repita para cada um)
1. Crie `src/<modulo>.js`. Mova as funções do `main.js` pra lá. Adicione `export` no que for usado fora (ou usado por `onclick`).
2. No topo do módulo, importe o que ele usa: `import { sb } from './supabase.js'`, `import { state } from './state.js'`, `import { esc, toast } from './utils.js'`, etc.
3. No `main.js`: importe as funções desse módulo e inclua as de `onclick` no `Object.assign(window, …)`.
4. `npm run dev` e **teste o app**. Se algo sumiu/quebrou, quase sempre é: (a) função faltando no `window`, (b) import esquecido, ou (c) variável que devia estar no `state` e ficou local.
5. Commit: `refactor: módulo <nome>`.

## Checklist de teste (depois de cada módulo e no fim)
Login e-mail · Google OAuth · **recovery por link (hash da URL)** · cadastro → aguardando aprovação · dashboard (revendedora e PC) · garantias (criar/editar/status/excluir) · catálogo (listar/buscar/**vender**/fechamento PDF) · **histórico de catálogo (tela própria + status "Vendido")** · trocas · pagamentos · admin (aprovar/revogar/Bling/atualizar maleta) · PWA instalável e abre offline · **console sem `is not defined`**.

## No fim da Fase 3
- `npm run build && npm run preview` e rodar o checklist no build de produção.
- Só então pensamos em deploy (lembrando: setar `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` nas Environment variables do Netlify antes de mergear, e validar o Deploy Preview).

## Commits sugeridos
Um por módulo: `refactor: módulo utils`, `refactor: estado compartilhado (state.js)`, `refactor: módulo auth`, `refactor: módulo nav`, … até `refactor: main.js fino (bootstrap + window)`.
