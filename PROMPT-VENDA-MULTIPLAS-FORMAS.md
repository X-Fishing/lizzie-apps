# PROMPT — Venda com MAIS DE UMA forma de pagamento (`venda_pagamentos`)

> Para o agente do **VS Code** aplicar. Projeto: `lizzie-apps` (Vite + JS puro + Supabase).
> Não invente estrutura nova além do descrito. Siga a ordem dos passos — o SQL vai primeiro.

---

## Contexto

Hoje a venda aceita **uma única** forma de pagamento: `index.html:560` é um `<select id="f-forma">` simples, `consignados.js:2053` lê um valor só e manda `p_forma` para a RPC `registrar_venda`, e o banco guarda em `vendas.forma_pagamento` (coluna `text` única, `db-functions.sql:58`).

Resultado: "a cliente pagou R$ 100 no Pix e R$ 50 no cartão" não tem como ser lançado. A revendedora escolhe uma forma só (informação errada no Financeiro) ou quebra em duas vendas (bagunça a cliente, a fidelidade e o certificado de garantia).

**Objetivo:** criar `venda_pagamentos (venda_id, forma, valor, data)` alimentada pela RPC, mantendo `vendas.forma_pagamento` preenchida com a **forma principal** (a de maior valor) ou **`'Misto'`** quando houver mais de uma — para não quebrar as telas que já leem esse campo: `pagamentos.js:90`, `pagamentos.js:159`, `pagamentos.js:211`, `historico.js:78`, `financeiro.js:430`.

---

## Regras de negócio (leia antes de codar)

1. Uma venda tem **1..N** linhas de pagamento. Cada linha: `forma`, `valor`, `data`.
2. A soma das linhas deve fechar **exatamente** com o total do carrinho (tolerância R$ 0,01).
3. A forma **`Fiado`** é a exceção: representa o que a cliente **ainda não pagou**. Só pode haver **uma** linha Fiado, e ela exige a **data combinada** (comportamento que já existe hoje, `consignados.js:2067`).
4. `vendas.valor_pago` = soma das linhas **exceto** a linha Fiado.
5. `vendas.status` continua derivado: `pago >= total → quitado`, `pago > 0 → parcial`, senão `pendente` (`consignados.js:2071` — não mudar essa fórmula).
6. `vendas.forma_pagamento`:
   - 1 linha só → o nome daquela forma (idêntico ao comportamento atual);
   - 2+ linhas → a string **`'Misto'`**.
7. A RPC insere **um `recebimentos`** por linha efetivamente paga (hoje insere um lump só, `db-functions.sql:86-89`). Isso mantém o bloco "Recebimentos" do detalhe da venda coerente com o extrato.

### ⚠️ CONFIRMAR COM O RONDON antes de subir

Hoje `consignados.js:2042` trata **`Parcelado 2x..6x` como NÃO recebido** (deixa o campo "Valor recebido agora" em branco). No modelo novo, **toda linha que não é `Fiado` conta como recebida** — inclusive Parcelado, por ser venda no cartão (o dinheiro está garantido).

Isso muda o status de vendas parceladas de `pendente` para `quitado` daqui pra frente. **É a mudança pretendida**, mas afeta a cobrança automática (`lembretes.js:100` e o botão "Cobrar no WhatsApp"). Se o Rondon quiser manter Parcelado como pendente, basta tratar `Parcelado *` igual a `Fiado` no passo 3 — não mexa em mais nada.

---

## Passo 1 — Migração `supabase/migrations/0051_venda_pagamentos.sql` (NOVO ARQUIVO)

> A maior migração existente é `0050_maleta_data_troca.sql`. Use **0051**.
> Siga o padrão dos outros arquivos: cabeçalho com "COMO APLICAR", tudo idempotente.

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0051 — venda_pagamentos: mais de uma forma de pagamento por venda.
-- COMO APLICAR: Supabase → SQL Editor → cole tudo → Run.
-- Depois: select pg_notify('pgrst','reload schema');
-- Idempotente: pode rodar 2x.
-- ════════════════════════════════════════════════════════════════════

-- ── A) Tabela ───────────────────────────────────────────────────────
create table if not exists public.venda_pagamentos (
  id         uuid primary key default gen_random_uuid(),
  venda_id   uuid not null references public.vendas(id) on delete cascade,
  forma      text not null,
  valor      numeric not null check (valor > 0),
  data       date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists venda_pagamentos_venda_idx on public.venda_pagamentos(venda_id);

-- ── B) RLS — herda da venda (mesmo padrão de venda_itens/recebimentos,
--        ver RLS-policies.sql:157-180) ────────────────────────────────
alter table public.venda_pagamentos enable row level security;
drop policy if exists venda_pagamentos_select on public.venda_pagamentos;
drop policy if exists venda_pagamentos_insert on public.venda_pagamentos;
drop policy if exists venda_pagamentos_delete on public.venda_pagamentos;
create policy venda_pagamentos_select on public.venda_pagamentos for select to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_pagamentos_insert on public.venda_pagamentos for insert to authenticated
  with check ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
create policy venda_pagamentos_delete on public.venda_pagamentos for delete to authenticated
  using ( exists (select 1 from public.vendas v where v.id = venda_pagamentos.venda_id
            and ( v.revendedora_id = auth.uid() or public.is_staff() )) );
```

**C) `registrar_venda` v5** — na mesma migração, recrie a função **inteira**.

Copie o corpo vigente de `db-functions.sql:24-107` **sem alterar nada** que não esteja listado abaixo (principalmente o bloco de fidelidade das linhas 91-103 — se ele quebrar, o modal pós-venda perde os selos).

Mudanças:

1. Novo parâmetro no fim: `p_pagamentos jsonb default null` — array `[{forma, valor, data}]`.
2. Antes do `insert into vendas`, derivar `p_forma`/`p_pago` das linhas quando `p_pagamentos` vier preenchido.
3. Depois do `insert into vendas`, inserir as linhas em `venda_pagamentos`.
4. Trocar o `insert into recebimentos` único por um por linha paga.

```sql
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date);
drop function if exists public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb);

create or replace function public.registrar_venda(
  p_cliente text, p_data date, p_forma text, p_total numeric, p_pago numeric,
  p_status text, p_obs text, p_itens jsonb,
  p_tel text default null, p_nasc date default null, p_combinada date default null,
  p_pagamentos jsonb default null           -- NOVO: [{forma,valor,data}]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_venda_id   uuid;
  v_item       jsonb;
  v_cliente_id uuid;
  v_fid        jsonb;
  v_pgto       jsonb;
  v_forma      text    := p_forma;
  v_pago       numeric := coalesce(p_pago, 0);
  v_n          int     := 0;
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'venda sem itens'; end if;

  -- NOVO: quando vierem linhas de pagamento, elas mandam em forma/valor_pago.
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    select count(*) into v_n from jsonb_array_elements(p_pagamentos);
    -- soma tudo que NÃO é Fiado = valor efetivamente recebido
    select coalesce(sum((x->>'valor')::numeric), 0) into v_pago
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') <> 'fiado';
    if v_n = 1 then
      select x->>'forma' into v_forma from jsonb_array_elements(p_pagamentos) x;
    else
      v_forma := 'Misto';
    end if;
  end if;

  v_cliente_id := public.cliente_upsert_para_venda(p_cliente, p_tel, p_nasc);

  insert into vendas (
    revendedora_id, nome_cliente, data_venda, forma_pagamento,
    valor_total, valor_pago, status, observacao,
    telefone_cliente, nascimento_cliente, data_combinada, cliente_id
  ) values (
    auth.uid(), p_cliente, p_data, v_forma,      -- <- v_forma
    p_total, v_pago, p_status, p_obs,            -- <- v_pago
    p_tel, p_nasc, p_combinada, v_cliente_id
  )
  returning id into v_venda_id;

  -- NOVO: grava o rateio por forma
  if p_pagamentos is not null then
    for v_pgto in select * from jsonb_array_elements(p_pagamentos)
    loop
      insert into venda_pagamentos (venda_id, forma, valor, data)
      values (v_venda_id, v_pgto->>'forma', (v_pgto->>'valor')::numeric,
              coalesce(nullif(v_pgto->>'data','')::date, p_data));
    end loop;
  end if;

  -- … BLOCO DE ITENS: idêntico a db-functions.sql:68-84, não mudar …

  -- Recebimentos: um por linha paga (antes era um lump só).
  if p_pagamentos is not null and jsonb_array_length(p_pagamentos) > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    select v_venda_id, (x->>'valor')::numeric,
           coalesce(nullif(x->>'data','')::date, p_data)
      from jsonb_array_elements(p_pagamentos) x
     where lower(x->>'forma') <> 'fiado' and (x->>'valor')::numeric > 0;
  elsif v_pago > 0 then
    insert into recebimentos (venda_id, valor, data_recebimento)
    values (v_venda_id, v_pago, p_data);
  end if;

  -- … BLOCO DE FIDELIDADE + return: idêntico a db-functions.sql:91-105, não mudar …
end;
$$;

revoke all on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) from public;
grant execute on function public.registrar_venda(text,date,text,numeric,numeric,text,text,jsonb,text,date,date,jsonb) to authenticated;
```

**D) Backfill** (fim da mesma migração) — toda venda antiga com `valor_pago > 0` ganha uma linha equivalente, para as telas novas nunca aparecerem vazias no histórico:

```sql
insert into public.venda_pagamentos (venda_id, forma, valor, data)
select v.id, coalesce(v.forma_pagamento, 'Não informado'), v.valor_pago, v.data_venda
  from public.vendas v
 where coalesce(v.valor_pago, 0) > 0
   and not exists (select 1 from public.venda_pagamentos p where p.venda_id = v.id);

-- DIAGNÓSTICO (rodar e conferir):
-- select count(*) from public.venda_pagamentos;
-- select forma, count(*) from public.venda_pagamentos group by forma order by 2 desc;
```

---

## Passo 2 — `db-functions.sql` (linhas 22-110)

Substitua a definição de `registrar_venda` pela **v5 idêntica** à da migração 0051, e acrescente ao comentário do topo (linhas 17-21):

```
-- 0051: ganhou p_pagamentos jsonb (DEFAULT null → retrocompatível). Quando vem
--   preenchido, ele manda em forma_pagamento ('Misto' se 2+) e valor_pago, e
--   grava o rateio em venda_pagamentos. Mudança de assinatura → drop antes.
```

> **Crítico:** o cabeçalho deste arquivo manda "colar inteiro e Run". Se ele ficar com a v4, um Run futuro **regride o fix**.

---

## Passo 3 — `index.html`: modal Finalizar Venda (linhas 558-582)

Substitua os dois `form-group` atuais — o do `<select id="f-forma">` (558-572) e o do "Valor recebido agora" (578-582) — por:

```html
<div class="form-group">
  <label class="form-label">Formas de pagamento *</label>
  <div id="f-pgtos"></div>
  <button type="button" id="f-pgto-add" class="btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="vendaPgtoAdd()">
    + Adicionar outra forma
  </button>
  <div id="f-pgto-resumo" style="font-size:12px;margin-top:8px;min-height:18px"></div>
</div>
```

Mantenha **intactos** o `#f-combinada-wrap` (573-577) e tudo depois dele.

`#f-pgtos` é renderizado por JS. Cada linha:

```html
<div class="form-row" style="align-items:flex-end;gap:8px;margin-bottom:8px">
  <div class="form-group" style="flex:2;margin:0">
    <select class="form-control" onchange="vendaPgtoSet(IDX,'forma',this.value)"> …opções… </select>
  </div>
  <div class="form-group" style="flex:1;margin:0">
    <input type="text" class="form-control" inputmode="numeric" placeholder="0,00"
           value="…" oninput="maskMoneyBR(this);vendaPgtoSet(IDX,'valor',this.value)">
  </div>
  <button type="button" class="btn-icon" onclick="vendaPgtoRemover(IDX)" title="Remover">…ícone lixeira…</button>
</div>
```

O botão de remover só aparece quando há 2+ linhas. As opções do `<select>` são **as mesmas 10 de hoje** (`index.html:561-570`) — não troque pela tabela `formas_pagamento`.

O `value` do input de valor sai de `moneyToInput(p.valor)` (já importado em `consignados.js:4`), o mesmo helper que o código atual usa em `ajustarValorPago` (linha 2043). O botão `#f-pgto-add` **precisa do id** — `renderVendaPagamentos()` desabilita ele quando o total já fechou.

---

## Passo 4 — `src/state.js`

Ao lado de `carrinhoVenda`, adicione:

```js
vendaPagamentos: [],   // [{forma, valor}] — linhas do modal de venda
```

---

## Passo 5 — `src/consignados.js`

### 5a. `abrirFinalizarVenda()` (linha ~1923)

Troque `document.getElementById('f-forma').value = 'Pix';` por um reset das linhas com o total já preenchido:

```js
const totalCarrinho = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
state.vendaPagamentos = [{ forma: 'Pix', valor: totalCarrinho }];
```

E troque a chamada `ajustarValorPago();` (linha 1930) por `renderVendaPagamentos();`.

### 5b. Substitua `ajustarValorPago()` (2039-2046) por três funções novas

```js
const FORMAS_VENDA = ['Dinheiro','Pix','Cartão débito','Cartão crédito',
  'Parcelado 2x','Parcelado 3x','Parcelado 4x','Parcelado 5x','Parcelado 6x','Fiado'];

const totalCarrinho = () => state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
// Fiado = o que a cliente NÃO pagou. Todo o resto conta como recebido.
const ehFiado = f => f === 'Fiado';
const somaPagamentos = () => state.vendaPagamentos.reduce((s, p) => s + Number(p.valor || 0), 0);

export function renderVendaPagamentos() {
  const wrap = document.getElementById('f-pgtos');
  const total = totalCarrinho();
  wrap.innerHTML = state.vendaPagamentos.map((p, i) => /* HTML do passo 3, com IDX = i */).join('');

  // Data combinada só quando existe linha Fiado (mesma regra de hoje, linha 2045).
  const temFiado = state.vendaPagamentos.some(p => ehFiado(p.forma));
  document.getElementById('f-combinada-wrap').style.display = temFiado ? 'block' : 'none';

  // Botão "+ Adicionar" some quando já fechou o total (nada a repartir).
  const soma = somaPagamentos();
  const falta = total - soma;
  document.getElementById('f-pgto-add')?.toggleAttribute('disabled', Math.abs(falta) < 0.01);

  const res = document.getElementById('f-pgto-resumo');
  if (Math.abs(falta) < 0.01) {
    res.innerHTML = `<span style="color:var(--success)">Fecha com o total: ${fmtBRL(total)}</span>`;
  } else if (falta > 0) {
    res.innerHTML = `<span style="color:var(--warning)">Faltam ${fmtBRL(falta)} de ${fmtBRL(total)}</span>`;
  } else {
    res.innerHTML = `<span style="color:var(--danger)">Passou ${fmtBRL(-falta)} do total</span>`;
  }
}

export function vendaPgtoAdd() {
  const falta = totalCarrinho() - somaPagamentos();
  const usadas = new Set(state.vendaPagamentos.map(p => p.forma));
  state.vendaPagamentos.push({
    forma: FORMAS_VENDA.find(f => !usadas.has(f)) || 'Dinheiro',
    valor: falta > 0 ? falta : 0,
  });
  renderVendaPagamentos();
}

export function vendaPgtoRemover(i) {
  if (state.vendaPagamentos.length <= 1) return;   // sempre resta uma
  state.vendaPagamentos.splice(i, 1);
  renderVendaPagamentos();
}

export function vendaPgtoSet(i, campo, valor) {
  const linha = state.vendaPagamentos[i];
  if (!linha) return;
  if (campo === 'valor') {
    linha.valor = parseMoneyBR(valor);
    // Não re-renderiza (perderia o foco do input): só atualiza o resumo.
    atualizarResumoPagamentos();
    return;
  }
  // Só UMA linha Fiado: se escolher Fiado numa segunda linha, a outra vira Dinheiro.
  if (valor === 'Fiado') {
    state.vendaPagamentos.forEach((p, j) => { if (j !== i && ehFiado(p.forma)) p.forma = 'Dinheiro'; });
  }
  linha.forma = valor;
  renderVendaPagamentos();
}
```

> `atualizarResumoPagamentos()` é a parte final de `renderVendaPagamentos()` (resumo + `f-combinada-wrap` + estado do botão) extraída, para não redesenhar os inputs enquanto a revendedora digita — **isso é essencial**, senão o campo perde o foco a cada tecla.

### 5c. `confirmarVendaCarrinho()` (2048-2101)

Trocar a leitura de `f-forma`/`f-pago` (linhas 2053-2056) por:

```js
const pgtos = state.vendaPagamentos
  .filter(p => Number(p.valor || 0) > 0)
  .map(p => ({ forma: p.forma, valor: Number(p.valor), data }));
const total = totalCarrinho();
const soma  = pgtos.reduce((s, p) => s + p.valor, 0);
const pago  = pgtos.filter(p => p.forma !== 'Fiado').reduce((s, p) => s + p.valor, 0);
const temFiado  = pgtos.some(p => p.forma === 'Fiado');
const combinada = temFiado ? diaMesParaISO(document.getElementById('f-combinada').value) : null;
```

Validações novas — coloque junto das que já existem (2063-2068), **mantendo todas as atuais**:

```js
if (!pgtos.length) { toast('Informe ao menos uma forma de pagamento'); return; }
if (Math.abs(soma - total) > 0.01) {
  toast(`As formas somam ${fmtBRL(soma)} e o total é ${fmtBRL(total)}. Ajuste os valores.`);
  return;
}
if (temFiado && !combinada) { toast('Informe a data combinada de pagamento'); return; }
```

Remova a validação antiga `if (forma === 'Fiado' && !combinada)` (2067) — a de cima a substitui.

Na chamada da RPC (2082-2100), trocar `p_forma` e `p_pago` e acrescentar `p_pagamentos`:

```js
p_forma: pgtos.length === 1 ? pgtos[0].forma : 'Misto',
p_pago: pago,
p_pagamentos: pgtos,
```

`p_status` continua vindo de `const status = pago >= total ? 'quitado' : pago > 0 ? 'parcial' : 'pendente';` (2071) — **não mudar**.

E limpe o estado junto com o carrinho (linha 2126):

```js
state.carrinhoVenda = [];
state.vendaPagamentos = [];
```

### 5d. Exclusão em cascata (linhas 1807-1808)

Acrescente a nova tabela **antes** do delete das vendas:

```js
await sbQ(sb.from('venda_pagamentos').delete().in('venda_id', vendaIds));
```

---

## Passo 6 — `src/main.js`

1. No import de `./consignados.js` (linha 28), acrescente `renderVendaPagamentos, vendaPgtoAdd, vendaPgtoRemover, vendaPgtoSet` e **remova `ajustarValorPago`** (a função deixou de existir).
2. No `Object.assign(window, { … })` (linha ~123), faça o mesmo: adicione `vendaPgtoAdd, vendaPgtoRemover, vendaPgtoSet` e tire `ajustarValorPago`.

> Se esquecer o `Object.assign`, os `onclick`/`onchange` inline quebram **em silêncio** (o modal abre, os botões não fazem nada). Verifique no console: `typeof window.vendaPgtoAdd === 'function'`.

---

## Passo 7 — Exibir o rateio (telas de leitura)

### 7a. `src/pagamentos.js` — detalhe da venda (`verVenda`, 125-196)

Carregue as linhas junto com itens e recebimentos (linhas 129-134):

```js
sbQ(sb.from('venda_pagamentos').select('*').eq('venda_id', id).order('created_at'))
```

E quando `v.forma_pagamento === 'Misto'`, troque a `detail-row` "Forma" (linha 159) por um bloco com o rateio, no mesmo estilo do bloco "Recebimentos" (177-178):

```
FORMAS DE PAGAMENTO
  Pix ................ R$ 100,00
  Cartão débito ...... R$  50,00
```

Se não houver linhas (venda antiga fora do backfill), mantenha o texto de hoje.

### 7b. `src/pagamentos.js` — exclusão de venda (linha 348)

Acrescente antes dos outros deletes:

```js
await sbQ(sb.from('venda_pagamentos').delete().eq('venda_id', id));
```

### 7c. `src/admin.js` (linha 735)

Mesma coisa, junto de `venda_itens`/`recebimentos`:

```js
await sbQ(sb.from('venda_pagamentos').delete().in('venda_id', vendaIds));
```

### 7d. `src/pagamentos.js:90` e `src/historico.js:78`

**Não mexer.** Vão exibir `Misto`, que é o comportamento desejado — o detalhe abre o rateio.

---

## Ordem de aplicação

1. Rodar `0051_venda_pagamentos.sql` no Supabase → `select pg_notify('pgrst','reload schema');`
2. Conferir o diagnóstico do backfill (contagem por forma).
3. Atualizar `db-functions.sql` com a v5.
4. Só então subir o front (passos 3-7).

O front antigo continua funcionando com o banco novo (`p_pagamentos` tem default `null` → cai no caminho de sempre). O front novo **não** funciona com o banco antigo.

---

## Teste ponta a ponta (executar tudo, nesta ordem)

Rode com uma revendedora de teste (`ehRevTeste`) e confira **no banco** e **na tela**.

| # | Cenário | Esperado |
|---|---|---|
| 1 | **Forma única (regressão)** — venda R$ 200, só Pix | `vendas.forma_pagamento='Pix'`, `valor_pago=200`, `status='quitado'`; 1 linha em `venda_pagamentos`; 1 em `recebimentos`. Telas idênticas a antes. |
| 2 | **Misto 2 formas** — R$ 150 = Pix 100 + Cartão débito 50 | `forma_pagamento='Misto'`, `valor_pago=150`, `quitado`; 2 linhas em `venda_pagamentos`; 2 em `recebimentos`. Lista mostra "Misto"; detalhe abre o rateio. |
| 3 | **Misto com Fiado** — R$ 300 = Pix 100 + Fiado 200 | `forma_pagamento='Misto'`, `valor_pago=100`, `status='parcial'`, `data_combinada` gravada; `recebimentos` só a linha de 100. Botão "Cobrar no WhatsApp" aparece. |
| 4 | **Fiado puro** — R$ 80 só Fiado | `forma_pagamento='Fiado'`, `valor_pago=0`, `pendente`; **zero** linhas em `recebimentos`. |
| 5 | **Soma não fecha** — total 100, linhas somando 90 | Toast "As formas somam R$ 90,00 e o total é R$ 100,00"; **nada** gravado no banco. |
| 6 | **Soma passa** — linhas somando 120 num total de 100 | Bloqueia igual, resumo em vermelho "Passou R$ 20,00". |
| 7 | **Fiado sem data** | Toast "Informe a data combinada"; nada gravado. |
| 8 | **Dois Fiados** — escolher Fiado em duas linhas | A primeira vira "Dinheiro" sozinha; nunca ficam dois Fiados. |
| 9 | **Remover linha** — 3 linhas → remover 1 | Resumo recalcula; com 1 linha só, o botão de remover some. |
| 10 | **Foco do input** — digitar "1500" no valor | Os 4 dígitos entram sem o campo perder o foco (valida a extração do `atualizarResumoPagamentos`). |
| 11 | **Fidelidade** — venda com WhatsApp válido | Modal pós-venda abre **com os selos** (prova que a v5 preservou `db-functions.sql:91-105`). |
| 12 | **Excluir venda** (`pagamentos.js` → Excluir) | `venda_pagamentos` da venda somem; nenhum registro órfão. |
| 13 | **Excluir maleta** (staff, `consignados.js:1807`) | Idem, em lote. |
| 14 | **Backfill** — abrir uma venda antiga | Detalhe mostra a forma de sempre com o rateio de 1 linha; nada quebrado. |
| 15 | **Idempotência** | Rodar `0051` duas vezes seguidas: sem erro, sem linha duplicada no backfill. |
| 16 | **Front velho × banco novo** | Se o Netlify servir cache antigo, a venda ainda registra (default `null`). |

SQL de conferência:

```sql
select v.id, v.forma_pagamento, v.valor_total, v.valor_pago, v.status,
       (select jsonb_agg(jsonb_build_object('forma', p.forma, 'valor', p.valor))
          from venda_pagamentos p where p.venda_id = v.id) as rateio,
       (select coalesce(sum(r.valor),0) from recebimentos r where r.venda_id = v.id) as recebido
  from vendas v order by v.created_at desc limit 10;
```

Invariante que **precisa** valer nas vendas novas: `valor_pago` = soma do rateio sem Fiado = `recebido`.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Recriar `registrar_venda` derrubando o bloco de fidelidade | Copiar literalmente `db-functions.sql:24-107` e inserir só as 4 mudanças; teste #11 pega na hora |
| Overload ambíguo no PostgREST (3 assinaturas históricas) | Os três `drop function` no topo cobrem todas (mesmo padrão do 0032) |
| `f-pago` removido do HTML mas ainda referenciado em JS | Grep por `f-pago` depois de editar — **não pode sobrar nenhuma ocorrência** |
| `ajustarValorPago` removido mas ainda no `main.js`/HTML | Grep por `ajustarValorPago` — zero ocorrências no fim |
| Input perde o foco a cada dígito | Passo 5b: `vendaPgtoSet` com `campo==='valor'` **não** chama `renderVendaPagamentos()` |
| Parcelado passa a contar como recebido | Ver o box "CONFIRMAR COM O RONDON" no topo |
| `financeiro.js:320` monta `forma_pagamento` do **fechamento**, não da venda | Não tem relação — **não mexer** em `financeiro.js` |

---

## Arquivos tocados

- `supabase/migrations/0051_venda_pagamentos.sql` *(novo)*
- `db-functions.sql` (22-110)
- `index.html` (558-582)
- `src/state.js`, `src/main.js` (28, ~123)
- `src/consignados.js` (1923, 1930, 2039-2046, 2048-2101, 2126, 1807)
- `src/pagamentos.js` (129-134, 159, 348)
- `src/admin.js` (735)
