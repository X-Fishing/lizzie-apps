# PROMPT — Histórico de catálogos em tela própria + status "Vendido"

> Cole no Copilot/Cursor com `index.html` aberto em **`D:\lizzie-apps`** (e só nela).
> Mexer **só** nas funções do Catálogo/ciclo listadas abaixo. Não tocar em auth, RLS, PWA, venda nem na lógica de finalizar.
> Um commit por parte. Testar no preview antes de commitar.

## Contexto
O fix do histórico já está no ar: peças encerradas saem do catálogo atual e aparecem num bloco "Histórico de catálogos" (função `historicoCatalogosHtml`). Hoje cada ciclo é um `<details>` que **expande na mesma tela**. Queremos mudar dois comportamentos.

Funções envolvidas (todas já existem): `historicoCatalogosHtml`, `cicloRowHtml`, `cicloTableHtml`, `renderCicloGrid`, `renderCicloAdmin`, `renderCicloAdminDetalhe`, `renderCicloRevendedora`. Estado de navegação atual: variável global `cicloRevSelecionada` (qual revendedora o admin abriu).

---

## PARTE 1 — Histórico abre em TELA PRÓPRIA (não accordion)

### 1.1 Novo estado + resolução das peças do ciclo
Perto de `let cicloRevSelecionada = null;` adicione:
```js
let historicoCicloSel = null; // chave 'YYYY-MM-DD' do ciclo encerrado aberto, ou null
```
Adicione um resolvedor das peças de um ciclo (respeita o escopo: admin dentro de uma revendedora vê só as dela; revendedora vê as próprias — `allConsignados` já vem filtrado pra ela):
```js
function pecasDoCiclo(chave) {
  let base = allConsignados;
  if (ehStaff() && cicloRevSelecionada) base = base.filter(c => c.revendedora_id === cicloRevSelecionada);
  return soEncerrados(base).filter(c => (c.encerrado_em || c.created_at || '').slice(0,10) === chave);
}
```

### 1.2 `historicoCatalogosHtml` → lista de cards clicáveis (sem `<details>`)
Troque cada `<details>…</details>` por um **card clicável** que navega pra tela do ciclo. Mantém o mesmo resumo (data, peças, X/Y vendidas, R$), mas sem a tabela embutida — e com um chevron "›" indicando que abre:
```js
return `<div class="hist-ciclo-card" onclick="abrirHistoricoCiclo('${data}')"
  style="cursor:pointer;border:1px solid var(--line,#eee);border-radius:10px;margin-bottom:8px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;transition:background .15s"
  onmouseover="this.style.background='rgba(0,0,0,0.02)'" onmouseout="this.style.background=''">
    <span style="font-weight:600;color:var(--plum)">Fechado em ${dataFmt}</span>
    <span style="font-size:12px;color:var(--muted)">${pecas.length} peça${pecas.length!==1?'s':''} · ${vend}/${env} vendidas · <span style="color:var(--rose)">${fmtBRL(recv)}</span> <span style="color:var(--muted);margin-left:6px">›</span></span>
  </div>`;
```
(O título "Histórico de catálogos" acima da lista continua igual.)

### 1.3 Tela do ciclo + navegação
Crie a tela de detalhe do ciclo (somente leitura), com botão de voltar:
```js
function renderHistoricoCicloDetalhe(chave) {
  const pecas = pecasDoCiclo(chave);
  const dataFmt = chave ? chave.split('-').reverse().join('/') : 'sem data';
  const env  = pecas.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const vend = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const recv = pecas.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  return `<button class="btn-voltar-ciclo" onclick="voltarHistoricoCiclo()">← Voltar para o catálogo</button>
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">Catálogo fechado em ${dataFmt}</div>
          ${pedidoLabelHtml(pecas, 12)}
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${pecas.length} peça${pecas.length!==1?'s':''} · ${vend}/${env} vendidas</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Vendido</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--rose)">${fmtBRL(recv)}</div>
        </div>
      </div>
      ${cicloTableHtml(pecas, true, true)}  /* 3º arg = modo histórico (Parte 2) */
    </div>`;
}
function abrirHistoricoCiclo(chave) { historicoCicloSel = chave; const cs=document.getElementById('c-search'); if(cs) cs.value=''; renderCicloGrid(); }
function voltarHistoricoCiclo() { historicoCicloSel = null; renderCicloGrid(); }
```

### 1.4 Plugar no `renderCicloGrid`
Logo no início de `renderCicloGrid()` (depois de pegar `div`), antes de decidir admin/revendedora:
```js
if (historicoCicloSel) { div.innerHTML = renderHistoricoCicloDetalhe(historicoCicloSel); return; }
```
Como `voltarHistoricoCiclo()` só limpa `historicoCicloSel` e re-renderiza, o voltar funciona nos dois contextos: admin volta pro detalhe da revendedora (`cicloRevSelecionada` segue setado) e a revendedora volta pro catálogo dela.

### 1.5 Expor no `window`
Como há `onclick=` no HTML, garanta que `abrirHistoricoCiclo` e `voltarHistoricoCiclo` estão acessíveis globalmente (se o projeto usa funções globais, já basta declará-las; não as deixe presas em escopo de módulo).

> Também: ao trocar de revendedora ou voltar pros cards (`abrirCicloRev`/`voltarCardsCiclo`), zere `historicoCicloSel = null` pra não abrir a tela errada.

---

## PARTE 2 — Status "Vendido" no histórico (e sem apagar o vendido)
Hoje `cicloRowHtml(c, isAdmin)` na coluna Status mostra **sempre "Encerrado"** para peça encerrada, e a linha vendida fica esmaecida (classe `.esgotado { opacity: 0.3 }`). No histórico isso fica ao contrário do esperado.

Adicione um 3º parâmetro `historico` em `cicloRowHtml` e `cicloTableHtml`:

- **`cicloTableHtml(list, isAdmin, historico = false)`** → repassa `historico` ao `cicloRowHtml`.
- Em **`cicloRowHtml(c, isAdmin, historico = false)`**, quando `historico === true`:
  - **Coluna Status** baseada em venda real, não em estoque:
    ```js
    const vendida = c.quantidade_vendida || 0;
    const acao = vendida > 0
      ? `<span style="font-size:11px;color:var(--success);font-weight:600">Vendido${vendida>1?` (${vendida})`:''}</span>`
      : `<span style="font-size:11px;color:var(--muted)">Não vendido</span>`;
    ```
  - **Não aplicar o fade `esgotado`** no modo histórico. Em vez disso, deixe a peça **vendida em destaque (normal)** e, se quiser, esmaeça levemente só a **não vendida** (ex.: classe própria com `opacity:.55`). O importante: peça vendida **não** pode ficar apagada.
  - O cabeçalho da coluna pode continuar "Status".

> Mantém o comportamento atual do catálogo **ativo** intacto (quando `historico` é `false`, nada muda).

---

## Testes (rodar no preview)
1. Abra uma revendedora com histórico (ex.: Bruna). O bloco "Histórico de catálogos" mostra os ciclos como **cards clicáveis** (sem expandir inline).
2. Clique em "Fechado em 15/05/2026" → abre **tela própria** com o pedido, resumo e a tabela daquele ciclo. Botão **← Voltar para o catálogo** retorna ao catálogo atual da revendedora.
3. Na tela do ciclo, a coluna **Status** mostra **"Vendido"** nas peças vendidas (em destaque, não apagadas) e **"Não vendido"** nas demais.
4. Admin: o voltar retorna ao **detalhe da revendedora** (não pra grade geral). Revendedora comum vê o próprio histórico igual, sem botões de gestor.
5. Catálogo **ativo** continua idêntico (botão Vender, fade de esgotado normal).
6. Console sem erros; nenhum `onclick` "is not defined".

## Commits sugeridos
1. `feat: histórico de catálogo abre em tela própria (por ciclo) em vez de accordion`
2. `ui: status "Vendido"/"Não vendido" no histórico (sem esmaecer o vendido)`
