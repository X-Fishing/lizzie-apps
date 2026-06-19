# PROMPT — Tirar emojis e dar cara de Zenply/Bling ao app Lizzie

> Cole este arquivo no chat do Copilot/Cursor com o `index.html` aberto.
> Trabalhe **só no `index.html`**. Não mude lógica/Supabase/PWA — só HTML/CSS e os textos de ícone.
> Faça **um commit por etapa** (mensagens sugeridas no fim). Teste no live preview antes de cada commit.

## Objetivo
Remover **todos os emojis** da interface e substituir por ícones de linha (estilo Lucide), monocromáticos, no padrão limpo do Zenply e do Bling. Sem mudar funcionalidade.

## Status atual (já aplicado direto no arquivo — confira no `git diff`)
A **navegação já foi convertida**: barra inferior (`.nav`), menu lateral staff (`.staff-nav`, incl. grupo Cadastros) e as telas de acesso (splash 💎, aguardando ⏳, nova senha 🔑). Já existe no `<style>` a classe utilitária:

```css
svg.ico { width: 1em; height: 1em; fill: none; stroke: currentColor;
  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
```

**Reuse essa classe `ico`** em tudo. Ela herda a cor do texto (vira rosa em item ativo, vermelho em botão de perigo, etc.) e o tamanho do `font-size` do contexto (ex.: `.empty-icon` tem 48px → o ícone vira 48px sozinho).

---

## Etapa 1 — Helper de ícones (evita repetir SVG gigante no JS)
Logo no começo do `<script>` principal, adicione um mapa + função:

```js
const ICONS = {
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cart:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clipboard:'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  printer:'<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  gem:'<path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  wallet:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  calc:'<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user:'<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  megaphone:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  contact:'<path d="M16 2v2"/><path d="M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><path d="M8 2v2"/><circle cx="12" cy="11" r="3"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  card:'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  tag:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  trending:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  hourglass:'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  inbox:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  calendar:'<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  message:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  sortaz:'<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>'
};
function ic(name){ return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||''}</svg>`; }

// Pontinho de status colorido (cor = significado)
function dot(color){ return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle"></span>`; }
```

---

## Etapa 2 — Regra de contexto (MUITO IMPORTANTE)
Onde o emoji aparece define como trocar:

| Contexto | Como renderiza | O que fazer |
|---|---|---|
| `innerHTML` / template string (botões, badges, empty-state, modal-title, dash-row) | HTML | trocar emoji por `${ic('nome')}` (ou SVG inline em HTML estático) |
| Status colorido (🔵🟡🟢🔴🟠⚪⚫) | HTML | trocar por `${dot('cor')}` |
| `placeholder="..."` | texto puro (atributo) | **só remover** o emoji e o espaço |
| `toast(...)`, `showMsg(...)`, `.textContent = ...`, `confirm(...)`, `alert(...)` | texto puro | **só remover** o emoji e o espaço |
| Setas `← → ▲ ▼ ⇅` | tipográficas, ok | **manter** (não são emoji) |

Cores dos dots: `🔵`→`#3f7fe0`, `🟡`→`var(--warning)`, `🟢`→`var(--success)`, `🔴`→`var(--danger)`, `🟠`→`#e8932f`, `⚪`→`var(--muted)`, `⚫`→`#5a4a60`.

---

## Etapa 3 — Mapa emoji → ícone
`💎`→gem · `⏻`→power* · `📥 📲 ⬇️`→download · `🔍`→search · `📸`→camera · `🛒`→cart · `✓ ✔ ✅`→check · `✕ ✗`→x · `📋`→clipboard · `🖨`→printer · `🔄`→refresh · `📱`→user/phone (modal "Quase lá") · `📧`→mail · `💰`→wallet · `🧮`→calc · `👥`→users · `📣`→megaphone · `🧑‍💼`→contact · `💳`→card · `🏷️`→tag · `⚠️`→alert · `💍`→gem · `📈`→trending · `👤 🧍`→user · `✏️`→edit · `🗑️ 🗑`→trash · `⏰`→clock · `⏳`→hourglass · `🔗`→link · `🔒`→lock · `📭`→inbox · `📅`→calendar · `📞`→phone · `💬`→message · `🚫`→ban · `🔤`→sortaz · `💖`→(remover, é toast) · `👑`→(ver Etapa 4)

\* power: `<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>`

Use `Buscar/Substituir` no arquivo para achar cada emoji. Confira que não sobrou nenhum (Etapa 6).

---

## Etapa 4 — Caso especial: `user-badge`
Linha `const icone = profile.role === 'admin' ? '👑' : ...` é usada em `user-badge.textContent` (texto puro). **Remova o emoji do badge**: troque o template `` `${icone} ${nomeBadge}` `` por apenas `nomeBadge` e apague a variável `icone` (ou deixe-a vazia). Nada de SVG aqui.

---

## Etapa 5 — Polimento visual (cara de Zenply/Bling)
Mudanças de CSS para aproximar do visual dos dois sistemas (clean, claro, tabelas arejadas):

1. **Tipografia da área logada**: reduzir o peso/serifa nos títulos de seção do PC; manter a serifa só na marca. Títulos de seção em `font-weight:600`, cor `var(--plum)`, tamanho 18–20px.
2. **Cards do dashboard** (`.dash-card`): borda `1px solid var(--border)`, raio 14–16px, sombra bem suave (já está perto). Espaçamento interno generoso (20px).
3. **Linhas/tabelas** (`.dash-row`, listas): separadores finos `1px solid var(--border)`, hover sutil `rgba(0,0,0,0.02)`.
4. **Acento de cor**: usar o rosa (`--rose`) como cor de destaque/ativo (equivalente ao verde do Zenply / verde do Bling), e dourado (`--gold`) só para pontos especiais. Evitar muitos emojis coloridos competindo.
5. **Ícones**: sempre linha fina (a classe `.ico`), nunca preenchidos.

> Faça a Etapa 5 num commit separado e me mostre antes/depois, porque é mais subjetivo.

---

## Etapa 6 — Verificação (rodar antes de commitar)
1. No terminal, procure emojis remanescentes (deve voltar só setas `←→▲▼⇅`, se houver):
   ```bash
   grep -nP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]' index.html
   ```
2. Abra o app no live preview e confira: barra inferior, menu lateral staff, dashboard, lista de garantias, catálogo, pagamentos, trocas, admin/revendedoras, modais (finalizar venda, buscar peça, fechamento, importar Bling). Nenhum ícone quebrado, nenhum `<svg>` aparecendo como texto cru (sinal de que foi posto em `textContent` por engano).
3. Toasts e `confirm()` devem aparecer **sem** marcação estranha (texto limpo).

## Commits sugeridos
1. `ui: helper de ícones (ic/dot) e remove emojis de botões e listas`
2. `ui: status com dots coloridos e empty-states com ícone de linha`
3. `ui: remove emojis de toasts, placeholders e diálogos`
4. `ui: ajuste de tipografia e cards do dashboard (estilo Zenply/Bling)`
