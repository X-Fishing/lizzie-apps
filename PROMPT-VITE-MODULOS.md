# PROMPT — Organizar o app Lizzie com Vite + módulos (migração incremental)

> Cole no Copilot/Cursor com a pasta `D:\lizzie-apps` aberta.
> **Regra de ouro: comportamento idêntico em cada fase. Nada de mudar funcionalidade.** Só reorganizar.
> Faça **uma fase por vez, com commit e teste**. Antes de mergear na `main`, valide num **Deploy Preview do Netlify** (push numa branch) — porque mexer no build pode quebrar o deploy.

## Contexto do projeto (não suponha — é assim hoje)
- App é **um único `index.html` (~4.400 linhas)**: `<style>` inline + `<script>` inline gigante, JS puro (sem módulos).
- Backend = **Supabase** (carregado via UMD CDN, global `window.supabase`, cliente global `sb`). Auth + RLS + RPC. **Bling já roda em Edge Functions** (`/functions/v1/...`) — não tem segredo no front, **não mexer nisso**.
- PWA: `manifest.json` + `sw.js` na raiz. Recovery de senha depende do **hash da URL** (o supabase-js consome o hash no init).
- Deploy: push no GitHub → **Netlify** builda. Hoje **não há build** (publica a raiz). **Isso muda na Fase 2 e precisa de cuidado.**

## ⚠️ Os 3 perigos que NÃO podem passar batido
1. **`onclick="funcao()"` em TODO o HTML.** Hoje as funções são globais (script clássico). Em ES module elas deixam de ser globais e **todos os onclick quebram**. Solução: expor explicitamente no `window` (ver Fase 2/3).
2. **Service worker + nomes de arquivo com hash.** O Vite gera `assets/index-AbC123.js`. O `sw.js` atual tem lista fixa de arquivos → cache quebra. Solução: substituir o SW manual por **`vite-plugin-pwa`** (Fase 2).
3. **Netlify sem build command.** Depois do Vite o publish vira `dist/`. Sem `netlify.toml`, o deploy publica a pasta errada e o app some. Solução: `netlify.toml` na Fase 2.

---

## Estrutura alvo (ao fim da Fase 3)
```
lizzie-apps/
├─ index.html            (só o HTML + <link>/<script type=module> — sem CSS/JS inline)
├─ netlify.toml
├─ package.json
├─ vite.config.js
├─ .env                  (não commitar; ver .env.example)
├─ .env.example
├─ public/               (ícones, favicons, arquivos servidos como estão)
└─ src/
   ├─ main.js            (bootstrap: importa módulos, expõe handlers no window)
   ├─ styles.css
   ├─ supabase.js        (cria e exporta `sb`)
   ├─ utils.js           (esc, toast, formatDate, fmtBRL, qtdDisp, handleSupabaseError…)
   ├─ auth.js            (login, cadastro, google, recovery, loadUser)
   ├─ nav.js             (showPanel, toggleCadastros…)
   ├─ dashboard.js
   ├─ garantias.js
   ├─ consignados.js     (ciclo/maleta/fechamento/carrinho de venda)
   ├─ pagamentos.js
   ├─ historico.js
   ├─ trocas.js
   ├─ admin.js           (revendedoras, aprovação, papéis)
   └─ bling.js           (chamadas às Edge Functions)
```

---

## FASE 1 — Extrair CSS e JS (sem Vite, deploy intacto)
Objetivo: tirar CSS e JS de dentro do `index.html` **sem build e sem mudar comportamento**. Continua publicando a raiz no Netlify.

1. Crie `styles.css` e mova **todo** o conteúdo do `<style>…</style>` pra lá. No `index.html`, troque o bloco por `<link rel="stylesheet" href="styles.css">`.
2. Crie `app.js` e mova **todo** o conteúdo do `<script>…</script>` principal pra lá. No `index.html`, troque por `<script src="app.js" defer></script>`.
   - **MANTENHA como script clássico (não module).** Assim as funções continuam globais e os `onclick` continuam funcionando — zero mudança de comportamento.
   - Cuidado: se houver mais de um `<script>` inline (ex.: a IIFE do PWA no fim), mova todos, preservando a ordem.
3. Teste local servindo estático (`npx serve` ou Live Preview) e confira o checklist de testes no fim. Deve estar **idêntico**.
4. Commit: `refactor: extrai CSS e JS do index.html (sem mudança de comportamento)`.

> Pare aqui e publique. Se algo quebrar, é fácil reverter. Só siga pra Fase 2 com a Fase 1 no ar e funcionando.

---

## FASE 2 — Adicionar Vite, Netlify e PWA
1. **Init**: `npm init -y`, depois `npm i -D vite vite-plugin-pwa` e `npm i @supabase/supabase-js`.
2. **package.json scripts**: `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"`.
3. **Mover para `src/`**: `app.js` → `src/main.js`; `styles.css` → `src/styles.css`. No `index.html`:
   - `<link rel="stylesheet" href="/src/styles.css">` (ou importe o CSS dentro do `main.js`).
   - `<script type="module" src="/src/main.js"></script>` (remova o `defer`/script clássico).
4. **Resolver o perigo nº 1 (onclick):** como agora `main.js` é module, exponha no `window` todas as funções chamadas por `onclick`/`oninput`/`onkeydown` no HTML. No fim do `main.js`:
   ```js
   Object.assign(window, {
     showPanel, fazerLogin, fazerCadastro, loginGoogle, mostrarRecuperar, voltarLogin,
     enviarLinkRecuperacao, salvarNovaSenha, toggleCadastros, openVenda, adicionarAoCarrinho,
     confirmarVendaCarrinho, removerDoCarrinho, abrirFinalizarVenda, openBuscaPeca, openFechamento,
     gerarPdfFechamento, finalizarCicloRev, deletarCicloRev, atualizarMaleta, confirmarMaleta,
     abrirCicloRev, voltarCardsCiclo, editarGarantia, mudarStatus, excluirGarantia, verGarantia,
     aprovarRev, revogarRev, confirmarExclusaoRev, detectarBlingId, /* …todas as demais usadas em on*… */
   });
   ```
   Faça uma busca por `onclick=`, `oninput=`, `onkeydown=` no `index.html` e garanta que **toda** função citada está nesse `Object.assign`. (Na Fase 3 isso se distribui por módulo.)
5. **Supabase** (`src/supabase.js`): remova o `<script>` UMD do CDN no `index.html` e troque por módulo:
   ```js
   import { createClient } from '@supabase/supabase-js';
   export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, { /* mesmas options de hoje */ });
   ```
   - `.env`: `VITE_SUPABASE_URL=…` e `VITE_SUPABASE_KEY=…` (a anon key — é pública, mas fica organizado). Crie `.env.example` sem os valores e adicione `.env` ao `.gitignore`.
   - As Edge Functions do Bling continuam iguais (montar as URLs a partir de `VITE_SUPABASE_URL`).
6. **PWA (perigo nº 2):** configure `vite-plugin-pwa` no `vite.config.js` para gerar o service worker e o manifest (migre o conteúdo do `manifest.json` atual pra config do plugin; use `registerType: 'autoUpdate'`). **Apague o `sw.js` manual** e o registro manual dele (a IIFE do PWA) — o plugin cuida do registro. Mantenha o banner de instalação iOS se quiser.
7. **Netlify (perigo nº 3):** crie `netlify.toml`:
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"
   ```
8. **Testar build de verdade:** `npm run build && npm run preview`, abrir a URL do preview e rodar o checklist. Depois **push numa branch** e validar o **Deploy Preview** do Netlify antes de ir pra `main`.
9. Commit: `build: adiciona Vite, vite-plugin-pwa e configuração de deploy do Netlify`.

---

## FASE 3 — Quebrar `main.js` em módulos por domínio
Mova blocos de função de `src/main.js` para os arquivos de `src/` (lista na estrutura alvo), **um módulo por commit**. Regras:
- Cada módulo **importa** o que usa (`import { sb } from './supabase.js'`, `import { toast, esc } from './utils.js'`).
- Funções chamadas por `on*` no HTML continuam expostas no `window` — pode manter o `Object.assign(window, …)` no `main.js` importando de cada módulo, **ou** criar um helper `expose(fns)` que cada módulo chama. Escolha um padrão e siga.
- Comece pelos sem dependência (`utils.js`, `supabase.js`), depois `auth.js`, `nav.js`, e por fim os domínios (`garantias`, `consignados`, `admin`, `bling`, `dashboard`, `trocas`, `pagamentos`, `historico`).
- **Teste o app inteiro depois de CADA módulo movido.** Se algo sumir, quase sempre é uma função que faltou expor no `window` ou um import esquecido.
- Commits: `refactor: módulo utils`, `refactor: módulo auth`, … (um por arquivo).

---

## Checklist de teste (rodar ao fim de cada fase)
- Login com e-mail, login com Google, **"Esqueci minha senha" → link do e-mail → definir nova senha** (o fluxo do hash).
- Cadastro novo cai em "Aguardando aprovação".
- Dashboard carrega (revendedora e staff/PC).
- Garantias: criar, editar, mudar status, excluir.
- Catálogo: listar, buscar, **adicionar ao carrinho → finalizar venda**, fechamento (PDF).
- Trocas, Pagamentos, Histórico abrem e listam.
- Admin: aprovar/revogar revendedora, vincular ID Bling, atualizar maleta.
- **PWA**: instalável; abre offline (shell) sem erro; atualização aplica nova versão.
- Console sem erros; nenhum `onclick` "function is not defined".

## Ordem de entrega
Fase 1 → publica e estabiliza → Fase 2 (validar Deploy Preview) → Fase 3 (módulo a módulo). Não pule fases.
