# PROMPT — Aba "Fechamentos" no cadastro da revendedora

> Rodar no VS Code, pasta do projeto. Branch sugerida: `feat/revendedora-aba-fechamentos`.
> Arquivos: `src/admin.js` (principal) + `src/styles.css` (CSS das abas).
> Sem migração — usa a tabela `consignados` que já existe e já é lida por staff via RLS.
> `npm run lint` + `npm run build` verdes antes do commit.

## Pedido do usuário
Na tela **"Editar revendedora"** (`abrirFormRev`, hoje uma página única com Identificação/Endereço/Cadastro/Fiador/Gestão/Contratos), adicionar uma **segunda aba "Fechamentos"** mostrando o **histórico de fechamento de maleta** — o mesmo conteúdo que já aparece em **Controle de Vendas** quando o gestor abre o catálogo de uma revendedora (seção "Histórico de catálogos" + o detalhe de cada fechamento). Referência visual anexada pelo usuário: duas abas no topo, "Identificação" (ativa, texto preto) e "FECHAMENTOS" (inativa, texto rosé/vermelho).

## Por que NÃO dá pra só chamar as funções de `consignados.js` direto
Já existem as funções prontas (`historicoCatalogosHtml`, `renderHistoricoCicloDetalhe`, `abrirHistoricoCiclo`, `pecasDoCiclo`) em `src/consignados.js`, mas elas são **acopladas à tela de Controle de Vendas**:
- Dependem de estado global mutável (`state.allConsignados`, `state.cicloRevSelecionada`, `state.historicoCicloSel`) que também é usado pela tela de Controle de Vendas — reusar direto arrisca poluir esse estado (ex.: o usuário abre o cadastro da revendedora, depois vai pra Controle de Vendas e a tela abre "grudada" num histórico errado).
- `historicoCatalogosHtml`'s cards chamam `onclick="abrirHistoricoCiclo(...)"`, que escreve em `document.getElementById('c-list')` — elemento que **não existe** na tela de Revendedoras. Chamar isso de dentro da aba nova quebraria com `Cannot set properties of null`.
- `cicloTableHtml`/`cicloRowHtml` usam cabeçalhos de coluna clicáveis (`cicloTh` → `onclick="sortConsignados(...)"`) que também escrevem em `#c-list` — mesmo problema ao clicar pra ordenar.

**Solução:** implementar a aba nova como uma tela **self-contained** dentro de `admin.js`, com estado próprio (não mexe em `state.allConsignados`/`cicloRevSelecionada`/`historicoCicloSel`), reaproveitando só as funções **puras** (sem side-effect de DOM/estado) que já existem em `consignados.js`:
- `soEncerrados(list)` — filtra só as peças com `status:'encerrado'`.
- `ciclosEncerrados(list)` — agrupa peças encerradas por data de fechamento, já ordenado (mais recente primeiro): `[['YYYY-MM-DD', [pecas...]], ...]`.

Essas duas são puras (`src/consignados.js:262,268`) — seguro reusar via import. **Não** importar `historicoCatalogosHtml`/`cicloTableHtml`/`renderHistoricoCicloDetalhe`/`abrirHistoricoCiclo` (têm o acoplamento acima) — a tabela de peças do detalhe deve ser escrita do zero em `admin.js` (simples, sem sort, é histórico — não precisa ordenar por coluna).

## Parte 1 — Estado + import em `src/admin.js`
No topo do arquivo, junto aos outros imports:
```js
import { soEncerrados, ciclosEncerrados } from './consignados.js';
```
Perto de outras variáveis de módulo (ex.: onde ficam outras `let` locais do arquivo), adicionar:
```js
let revAbaAtual = 'identificacao';   // 'identificacao' | 'fechamentos'
let revIdAtual = null;
let revFechDados = null;             // cache: peças encerradas da revendedora aberta (null = ainda não carregou)
let revFechCicloAberto = null;       // 'YYYY-MM-DD' do fechamento expandido, ou null = lista de cards
```

## Parte 2 — `abrirFormRev(id)`: reset de estado + abas na renderização
No início da função (logo após `if (id && !ehGestor())...`), resetar o estado da aba:
```js
revAbaAtual = 'identificacao';
revIdAtual = id;
revFechDados = null;
revFechCicloAberto = null;
```

No template do `panelAdmin().innerHTML`, logo abaixo do cabeçalho "← Voltar / Editar revendedora" e **antes** de `${secH('Identificação')}`, inserir a barra de abas — **só quando `id` existe** (revendedora já cadastrada; "Nova revendedora" não tem histórico ainda):
```js
${id ? `<div class="rev-tabs">
  <button class="rev-tab${revAbaAtual === 'identificacao' ? ' active' : ''}" data-aba="identificacao" onclick="revTrocarAba('identificacao')">Identificação</button>
  <button class="rev-tab${revAbaAtual === 'fechamentos' ? ' active' : ''}" data-aba="fechamentos" onclick="revTrocarAba('fechamentos')">Fechamentos</button>
</div>` : ''}
```

Envolver **todo o conteúdo atual** (de `${secH('Identificação')}` até o fim do template, incluindo Endereço/Cadastro/Fiador/botão Salvar/Gestão/Contratos) num `<div id="rev-tab-identificacao">...</div>`. Fazer isso sempre, mesmo em "Nova revendedora" (`id` null) — nesse caso a barra de abas não aparece (passo anterior), então essa div nunca é escondida e o comportamento atual continua idêntico.

Logo depois desse div, adicionar a aba nova (só quando `id`):
```js
${id ? `<div id="rev-tab-fechamentos" style="display:none">
  <div id="rev-fech-conteudo"><div class="loading" style="padding:24px 0"><div class="spinner">⟳</div></div></div>
</div>` : ''}
```

No fim da função, depois de `if (id && gestor) carregarContratosEmissoes(id);`, nada mais precisa rodar aqui — os fechamentos carregam **preguiçosamente** (só quando o usuário clica na aba), pelo mesmo espírito do `carregarContratosEmissoes` (que já preenche `#rev-contratos` de forma assíncrona depois do render inicial).

## Parte 3 — Trocar de aba
```js
export function revTrocarAba(aba) {
  revAbaAtual = aba;
  const idEl = document.getElementById('rev-tab-identificacao');
  const fechEl = document.getElementById('rev-tab-fechamentos');
  if (idEl) idEl.style.display = aba === 'identificacao' ? '' : 'none';
  if (fechEl) fechEl.style.display = aba === 'fechamentos' ? '' : 'none';
  document.querySelectorAll('.rev-tab').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
  if (aba === 'fechamentos' && revFechDados === null) carregarFechamentosRev();
}
```

## Parte 4 — Carregar e renderizar o histórico de fechamentos
```js
async function carregarFechamentosRev() {
  // Captura o id-alvo no momento do disparo: se o usuário fechar esta tela e
  // abrir outra revendedora antes da resposta chegar, a query antiga não deve
  // "vazar" pro cache/tela da revendedora nova (revIdAtual já terá mudado).
  const idPedido = revIdAtual;
  const { data, error } = await sbQ(sb.from('consignados').select('*')
    .eq('revendedora_id', idPedido).eq('status', 'encerrado').order('encerrado_em', { ascending: false }));
  if (idPedido !== revIdAtual) return; // a tela já mudou de revendedora — descarta
  if (error) {
    console.error('Fechamentos da revendedora:', error);
    const el = document.getElementById('rev-fech-conteudo');
    if (el) el.innerHTML = '<div class="empty-state"><p>Erro ao carregar o histórico de fechamentos.</p></div>';
    return;
  }
  revFechDados = data || [];
  renderFechamentosTab();
}

function renderFechamentosTab() {
  const el = document.getElementById('rev-fech-conteudo');
  if (!el) return;
  if (revFechCicloAberto) { el.innerHTML = renderFechamentoDetalhe(revFechCicloAberto); return; }

  const grupos = ciclosEncerrados(revFechDados); // [['YYYY-MM-DD', [pecas...]], ...]
  if (!grupos.length) {
    el.innerHTML = '<div class="empty-state"><p style="font-size:13px">Nenhum fechamento de maleta ainda.</p></div>';
    return;
  }
  el.innerHTML = grupos.map(([data, pecas]) => {
    const env  = pecas.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
    const vend = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
    const recv = pecas.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
    const dataFmt = data ? data.split('-').reverse().join('/') : 'sem data';
    return `<div class="hist-ciclo-card" onclick="revFechamentoAbrir('${data}')"
      style="cursor:pointer;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600;color:var(--plum)">Fechado em ${dataFmt}</span>
        <span style="font-size:12px;color:var(--muted)">${pecas.length} peça${pecas.length !== 1 ? 's' : ''} · ${vend}/${env} vendidas · <span style="color:var(--rose)">${fmtBRL(recv)}</span> <span style="color:var(--muted);margin-left:6px">›</span></span>
      </div>`;
  }).join('');
}

// Detalhe de um fechamento: tabela simples e SEM sort (é histórico, não precisa
// ordenar por coluna — evita reusar cicloTableHtml, que depende de #c-list).
function renderFechamentoDetalhe(chave) {
  const pecas = soEncerrados(revFechDados).filter(c => (c.encerrado_em || c.created_at || '').slice(0, 10) === chave);
  const env  = pecas.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const vend = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const recv = pecas.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  const dataFmt = chave.split('-').reverse().join('/');
  const linhas = pecas.map(c => `<tr>
    <td style="padding:8px 10px">${esc(c.descricao || '')}</td>
    <td style="padding:8px 10px">${esc(c.referencia || '—')}</td>
    <td style="padding:8px 10px">${esc(c.categoria || '—')}</td>
    <td style="padding:8px 10px;text-align:right">${c.quantidade_vendida || 0}/${c.quantidade_enviada || 0}</td>
    <td style="padding:8px 10px;text-align:right">${fmtBRL(c.preco_venda || 0)}</td>
  </tr>`).join('');
  return `<button class="btn-voltar-ciclo" onclick="revFechamentoVoltar()" style="margin-bottom:14px">← Voltar</button>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-weight:600;color:var(--plum)">Fechado em ${dataFmt}</div>
      <div style="font-size:13px;color:var(--muted)">${vend}/${env} vendidas · <b style="color:var(--rose)">${fmtBRL(recv)}</b></div>
    </div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Descrição</th><th class="pag-th">SKU</th><th class="pag-th">Categoria</th>
      <th class="pag-th" style="text-align:right">Vendidas/Enviadas</th><th class="pag-th" style="text-align:right">Preço</th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`;
}

export function revFechamentoAbrir(chave) { revFechCicloAberto = chave; renderFechamentosTab(); }
export function revFechamentoVoltar()     { revFechCicloAberto = null;  renderFechamentosTab(); }
```

`fmtBRL`/`esc`/`sbQ` já estão importados em `admin.js` — conferir antes de duplicar import.

## Parte 5 — Exposição no `window` (`src/main.js`)
Adicionar ao import de `./admin.js` e ao `Object.assign(window, {...})`: `revTrocarAba`, `revFechamentoAbrir`, `revFechamentoVoltar`.

## Parte 6 — CSS (`src/styles.css`)
Adicionar (perto de `.auth-tabs`/`.auth-tab` ou de outra seção de abas), um estilo NOVO para fundo claro (o `.auth-tab` existente é pro splash escuro, não dá pra reusar aqui):
```css
.rev-tabs { display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:18px; }
.rev-tab {
  background:none; border:none; cursor:pointer; padding:10px 18px 12px;
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:.3px;
  text-transform:uppercase; color:var(--rose); border-bottom:2px solid transparent; margin-bottom:-1px;
}
.rev-tab.active { color:var(--plum); border-bottom-color:var(--plum); }
```
(Cores só uma sugestão pra bater com o anexo do usuário — ativa em preto/plum, inativa em rosé. Ajustar se não bater visualmente.)

## Testes
1. Editar uma revendedora que **tem** fechamentos de maleta no histórico → aba "Fechamentos" aparece, mostra os cards por data.
2. Clicar num card → mostra a tabela de peças daquele fechamento (descrição/SKU/categoria/vendidas-enviadas/preço) + total vendido. "← Voltar" retorna à lista de cards.
3. Revendedora **sem** nenhum fechamento ainda → aba mostra "Nenhum fechamento de maleta ainda." (sem erro).
4. "Nova revendedora" (sem `id`) → **não** mostra a barra de abas (só o formulário de Identificação, como hoje).
5. Trocar de aba e voltar não deve re-fazer a query toda vez (só na primeira vez que abre "Fechamentos" — cache em `revFechDados`).
6. Abrir o cadastro de uma revendedora, ir pra aba Fechamentos, fechar, ir pra **Controle de Vendas** → confirmar que nada lá quebrou/mudou de comportamento (prova de que os dois ficaram desacoplados).
7. Console limpo; `npm run lint` e `npm run build` verdes.

## Commit sugerido
`feat(revendedoras): aba "Fechamentos" no cadastro com historico de maleta (self-contained, sem acoplar em Controle de Vendas)`
