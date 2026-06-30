# PROMPT — Campo de bipe como "última linha" (estilo Bling)

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> Mexa **apenas** em `src/lancador.js`. Faça **1 commit + push** no fim. Teste no `npm run dev`.

## Problema
Hoje o campo de bipe fica **fixo no topo**. Depois de bipar muitos itens, se a pessoa clica em qualquer lugar, precisa **rolar pra cima** para voltar ao campo. Atrapalha.

## Objetivo (igual ao Bling — ver print do "Pedido de venda")
O campo de bipe deve ser a **ÚLTIMA LINHA da lista**: cada peça bipada entra **acima** do campo, e o campo "desce junto", ficando sempre visível e focado para a próxima leitura — sem precisar rolar pra cima.

## Mudança em `src/lancador.js`

### 1. Mover o campo de bipe para DEPOIS da tabela
Na função `render()`, **remova** o bloco do campo de bipe que hoje fica ANTES da tabela:
```html
<div style="display:flex;gap:8px;margin:10px 0 18px">
  <input type="text" id="lan-scan" ... >
  <button class="btn-secondary" ... onclick="lancadorCamera()">${IC_CAM}</button>
</div>
```
E **coloque-o logo APÓS** o `</div>` do `pag-wrap` (a tabela), ou seja, **entre a tabela e a linha de total** (`cart-total-row`). Assim o campo aparece como a "última linha", abaixo dos itens já bipados. Mantenha o mesmo `id="lan-scan"`, o mesmo `onkeydown` e o botão de câmera.

> Resultado da ordem na tela: Revendedora → Tabela de itens → **Campo de bipe** → Total → Botão "Enviar para a maleta".

### 2. Após bipar, rolar o CAMPO para a vista (não a última linha) e manter o foco
Troque a função `rolarParaUltima()` por uma que rola o **próprio campo de bipe** para o centro e o mantém focado:
```js
// Mantém o campo de bipe visível e focado após cada leitura (estilo Bling).
function focarCampoBipe() {
  const scan = document.getElementById('lan-scan');
  if (!scan) return;
  scan.focus({ preventScroll: true });
  scan.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```
- Em `lancadorBipar`, troque a chamada `rolarParaUltima();` por `focarCampoBipe();`.
- No final de `render()`, onde hoje faz `scan.focus({ preventScroll: true })`, mantenha assim (sem scroll automático no render normal, só no bipe).

### 3. (Opcional, recomendado) Destaque visual da última peça
Para imitar o Bling, pode dar um leve realce na última linha adicionada. Se for simples, adicione `style="background:rgba(201,116,138,0.06)"` apenas na última `<tr>` da lista. (Se complicar, ignore.)

## Validar, commitar e publicar
```bash
npm run lint
npm run build
git add src/lancador.js PROMPT-LANCADOR-CAMPO-FIXO.md
git commit -m "fix(lancador): campo de bipe como ultima linha (estilo Bling), segue a lista"
git push origin main
```

## Teste (npm run dev)
- Bipe/Enter 10+ itens: o campo de bipe fica **logo abaixo** dos itens e acompanha a lista; nunca precisa rolar pra cima.
- Após cada bipe, o foco continua no campo (leitor USB segue lendo) e o campo aparece centralizado na tela.
- O botão "Enviar para a maleta" continua no fim, abaixo do total.
