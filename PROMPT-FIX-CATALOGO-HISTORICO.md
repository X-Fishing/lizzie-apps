# PROMPT — Corrigir fechamento de maleta e criar Histórico de catálogos

> Cole no Copilot/Cursor com `index.html` aberto. Trabalhe **só no `index.html`** + a migração SQL indicada na Parte 0 (rodar no SQL Editor do Supabase).
> **Não mude** nada de auth, RLS, PWA ou venda. Um **commit por parte**. Teste no live preview antes de cada commit.

## O bug (diagnóstico)
Hoje as peças ficam na tabela `consignados`, identificadas **só por `revendedora_id`** (mais `pedido_numero`, `quantidade_enviada`, `quantidade_vendida`, `preco_venda`, `status` = `ativo`/`encerrado`).

Quando você clica **"Finalizar catálogo"**, a função `finalizarCicloRev()` **faz a coisa certa**: marca as peças ativas como `status = 'encerrado'`. **O problema é só na exibição/contagem:** todas as telas do Catálogo agrupam por `revendedora_id` e **somam/listam TODOS os status juntos** (ativo + encerrado). Por isso a maleta finalizada "encavala" na próxima — ela continua aparecendo na lista e somando nos totais (no caso da Bruna: 295 peças = maleta antiga + nova; 31/295 vendidas; R$ 2.784 misturando os dois ciclos).

**Conclusão:** não falta finalizar — falta **separar o catálogo atual (ativo) do histórico (encerrado)** em toda a interface, e criar uma visão de **Histórico de catálogos por revendedora**.

## Objetivo
1. O **Catálogo atual** mostra e conta **somente peças `ativo`**.
2. Ao finalizar, a maleta vai para um **Histórico de catálogos** da revendedora (somente leitura), agrupado por ciclo.
3. A próxima maleta entra limpa, sem sobreposição.

---

## Parte 0 — Migração SQL (Supabase → SQL Editor)
Adiciona um carimbo de quando o ciclo foi encerrado, pra agrupar o histórico por maleta:

```sql
alter table consignados add column if not exists encerrado_em timestamptz;

-- Backfill: peças já encerradas (ex.: a maleta antiga da Bruna) recebem um carimbo
-- para agruparem como "catálogo anterior". Usa a data de criação como aproximação.
update consignados
set encerrado_em = coalesce(encerrado_em, created_at)
where status = 'encerrado' and encerrado_em is null;
```

> Não precisa mexer em RLS: a policy de update de gestor já cobre essa coluna.

---

## Parte 1 — Gravar `encerrado_em` ao finalizar
Em `finalizarCicloRev()`, no `.update(...)`, gravar o carimbo junto do status:

- Trocar `update({ status: 'encerrado' })` por `update({ status: 'encerrado', encerrado_em: new Date().toISOString() })`.

Assim cada clique em "Finalizar" cria um **ciclo identificável** (todas as peças daquele fechamento compartilham o mesmo `encerrado_em`).

---

## Parte 2 — Helpers de filtro (perto de `statsRevendedora`)
Criar utilitários e usá-los em todas as telas:

```js
const soAtivos    = list => list.filter(c => c.status === 'ativo');
const soEncerrados = list => list.filter(c => c.status === 'encerrado');

// Agrupa peças encerradas em ciclos (1 ciclo = 1 fechamento), pela data de encerramento.
function ciclosEncerrados(list) {
  const map = {};
  soEncerrados(list).forEach(c => {
    const chave = (c.encerrado_em || c.created_at || '').slice(0, 10); // YYYY-MM-DD
    (map[chave] = map[chave] || []).push(c);
  });
  // mais recente primeiro
  return Object.entries(map).sort((a, b) => a[0] < b[0] ? 1 : -1);
}
```

---

## Parte 3 — Telas: separar "Catálogo atual" de "Histórico"

### 3.1 `statsRevendedora(list)` → contar só o ciclo atual
Hoje `totalEnv`, `totalVend`, `totalRecv` somam a lista inteira. **Calcular sobre `soAtivos(list)`** (o `ativos`/`temAtivos` já filtra). O número grande "Vendido" do card e o "X/Y vendidas" passam a refletir **só a maleta ativa**. (A receita histórica vai pro Histórico, item 3.4.)

### 3.2 `renderCicloAdmin()` — grade de cards das revendedoras
- Cada card mostra os números do **catálogo atual** (vinda do `statsRevendedora` já corrigido).
- `list.length` no card deve virar **`soAtivos(list).length`** (peças do ciclo atual). Quem não tem nenhuma ativa mostra "○ Sem catálogo ativo" (já existe), mas o card continua **clicável** pra ver o histórico.
- `grandTotal` / `totalPecasVend` / `totalRevsAtivas`: deixe o "Total geral vendido" refletindo o **catálogo atual** (somar sobre `soAtivos(allConsignados)`), pra bater com os cards. (Se quiser o faturamento histórico total, exiba como linha separada "Histórico" — opcional.)

### 3.3 `renderCicloAdminDetalhe(revId, list)` — detalhe de uma revendedora
- A tabela principal (`cicloTableHtml`) deve receber **`soAtivos(list)`** (some as linhas "Encerrado" da lista atual).
- O cabeçalho (`list.length`, `totalVend/totalEnv`, `ativas`, `Vendido`) usa os números do ciclo atual.
- `pedidoLabelHtml(...)` deve usar **`soAtivos(list)`** (só os pedidos da maleta atual).
- **Adicionar abaixo das ações** um bloco **"Histórico de catálogos"** usando `ciclosEncerrados(list)`: para cada ciclo, um item recolhível (accordion) com: data do fechamento, pedido(s) (`pedidoLabelHtml` do ciclo), nº de peças, vendidas/enviadas e valor vendido (`fmtBRL`). Somente leitura — **sem** botões de vender/editar/finalizar. Se não houver encerrados, não mostra o bloco.

### 3.4 `renderCicloRevendedora()` — visão da própria revendedora
- A tabela e o `pedidoLabelHtml` devem usar **`soAtivos(allConsignados)`** (catálogo atual dela).
- `temAtivos`/botão de Fechamento continuam baseados nas ativas.
- Adicionar, no fim, o mesmo bloco **"Histórico de catálogos"** (`ciclosEncerrados(allConsignados)`), recolhido por padrão, somente leitura.
- Se ela não tem nenhuma ativa mas tem histórico, mostrar "Nenhum catálogo ativo no momento" + o histórico (em vez do empty-state genérico).

### 3.5 `renderBuscaPeca()` e `openBuscaPeca()` (admin: "Buscar peça — com quem está")
- Buscar **só em `soAtivos(allConsignados)`** — a busca serve pra saber onde a peça está **agora**. Peça de catálogo encerrado não deve aparecer como "disponível".

---

## Parte 4 — Não regredir (conferir, não mudar)
- `atualizarMaleta()` / `confirmarMaleta()` já comparam a maleta do Bling contra **`status = 'ativo'`** ao deduplicar (`.eq('status','ativo')`). Confirme que continua assim: depois de finalizar (zero ativas), "Atualizar itens da maleta" importa a **nova maleta inteira** como ciclo novo (`ativo`), sem tocar no histórico.
- `deletarCicloRev()` já apaga só `status='ativo'` — manter (preserva o histórico).
- Venda: `quantidade_vendida` é por peça; vendas antigas permanecem nas peças encerradas (viram receita do histórico). Não alterar a lógica de venda.

---

## Parte 5 — Testes de verificação
1. **Caso Bruna (dado real):** abra o detalhe da Bruna Ventura. O **Catálogo atual** deve mostrar só a maleta nova (as peças "Encerrado" somem da tabela atual) e os contadores (peças, X/Y vendidas, Vendido R$) devem refletir **só a maleta nova**. A maleta antiga aparece em **"Histórico de catálogos"**.
2. **Fluxo completo (teste com uma revendedora de teste):**
   a. Importe uma maleta (vira ciclo ativo).
   b. Registre 1–2 vendas.
   c. Clique **Finalizar catálogo** → a maleta some do atual e aparece no histórico com a data e o valor vendido.
   d. **Atualizar itens da maleta** com uma nova relação → entra um ciclo novo limpo; o anterior continua só no histórico (nada encavalado).
3. **Contagem:** o card da revendedora na grade e o cabeçalho do detalhe mostram o mesmo número de peças/ativas (só ciclo atual).
4. **Busca peça (admin):** procurar uma peça que está só em catálogo encerrado → não aparece como disponível.
5. Sem erros no console; revendedora comum não vê botões de gestor.

## Commits sugeridos
1. `db+fix: carimba encerrado_em ao finalizar catálogo`
2. `fix: catálogo atual conta/lista só peças ativas (sem encavalar maleta)`
3. `feat: histórico de catálogos por revendedora (ciclos encerrados, somente leitura)`
4. `fix: busca de peça e totais consideram só o catálogo ativo`
