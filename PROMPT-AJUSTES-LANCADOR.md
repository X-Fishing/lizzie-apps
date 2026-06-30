# PROMPT — Ajustes no Lançador de Maleta + rótulo de custo

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> Mexa em `src/lancador.js` e `src/produtos.js`. Faça **1 commit** no fim. Teste no `npm run dev`.

## Mudança 1 — Rótulo "Custo de compra" (em `src/produtos.js`)
O rótulo atual `Custo de compra (un.)` confunde ("un." parece unidade). O valor é em **reais**.
- Localize o label `Custo de compra (un.)` no formulário de produto e troque por:
  **`Custo de compra (R$)`**
- (não muda lógica; o campo já é monetário com `maskMoneyProduto`)

## Mudança 2 — Cada bipe = uma linha de UMA unidade (NÃO somar) (em `src/lancador.js`)
Hoje, bipar o mesmo produto incrementa a quantidade. O comportamento desejado:
**cada peça bipada vira uma LINHA NOVA com quantidade 1** (nunca soma/mescla), porque cada peça física é uma unidade do estoque.

Na função `lancadorBipar`, remova a lógica de "achar existente e somar" e sempre faça `push` de uma nova linha com `qtd: 1`:
```js
export async function lancadorBipar(code) {
  const c = (code || '').trim();
  if (!c) return;
  const prod = await lookupProduto(c);
  if (!prod) { beep(false); toast('Código não encontrado: ' + c); return; }
  // cada bipe = nova linha, sempre 1 unidade (não soma)
  carrinho.push({
    produto_id: prod.id, descricao: prod.nome, referencia: prod.referencia || null,
    preco_venda: prod.preco_venda || 0, foto_url: prod.foto_url || null, qtd: 1
  });
  beep(true);
  render();
  rolarParaUltima();   // ver Mudança 3
}
```
> Mantenha o input de quantidade na linha editável (caso precisem ajustar manualmente), mas o bipe nunca mescla — sempre cria linha nova.

## Mudança 3 — A tela acompanha o último item bipado (em `src/lancador.js`)
Como a lista cresce para baixo e o campo de bipe fica no topo, o usuário perde de vista o que acabou de entrar. Após cada bipe, **rolar para a última linha** (mantendo o foco no campo de bipe para o leitor USB continuar funcionando).

Adicione a função:
```js
function rolarParaUltima() {
  const scan = document.getElementById('lan-scan');
  if (scan) scan.focus({ preventScroll: true });   // não pula pro topo ao focar
  const linhas = panel().querySelectorAll('tbody tr');
  const ultima = linhas[linhas.length - 1];
  if (ultima) ultima.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```
- Chame `rolarParaUltima()` no fim de `lancadorBipar` (já incluído acima).
- Em `render()`, onde hoje faz `scan.focus();`, troque por `scan.focus({ preventScroll: true });` para o foco não dar "pulo" pro topo a cada render.

## Validar e commitar
```bash
npm run lint
npm run build
git add src/lancador.js src/produtos.js PROMPT-AJUSTES-LANCADOR.md
git commit -m "fix(lancador): cada bipe = 1 linha/1 un, auto-scroll p/ ultima; rotulo custo em R$"
git push origin main
```

## Teste (npm run dev)
- Bipe (ou digite + Enter) o mesmo código 3x: devem aparecer **3 linhas** separadas, cada uma qtd 1 (não uma linha com qtd 3).
- A tela rola sozinha acompanhando a última peça adicionada; o leitor USB continua bipando sem precisar clicar no campo.
- No cadastro de produto, o rótulo agora diz **Custo de compra (R$)**.
