# PROMPT — Lançador deve SEMPRE perguntar: continuar maleta atual ou nova

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta (branch a partir da `main`).
> Mexa **apenas** em `src/lancador.js`. Commit + push no fim. Teste local.

## Problema
Hoje, quando a revendedora tem **1 maleta aberta**, o lançador **assume essa maleta automaticamente** como destino e já permite enviar — sem perguntar. O dono quer **sempre escolher** explicitamente: continuar a maleta atual OU criar uma nova (mesmo que ela já tenha uma, pois às vezes já deixamos a próxima montada).

## Mudanças em `src/lancador.js`

### 1. Não auto-selecionar o destino
Em `lancadorSelecionarRev`, **remover** a linha que assume a maleta quando só há uma:
```js
// REMOVER esta linha:
if (maletasAbertas.length === 1) maletaDestino = { ...maletasAbertas[0] };
```
Assim `maletaDestino` começa sempre `null` ao escolher a revendedora → o envio fica bloqueado até o usuário escolher (o botão "Enviar" já depende de `maletaDestino`).

### 2. Painel de escolha sempre visível e claro (`maletaPanelHtml`)
Depois de escolher a revendedora, mostrar SEMPRE a pergunta, com:
- Um texto curto: **"Onde lançar as peças?"**
- Para **cada maleta em aberto**, um botão **"Continuar {Status} #{numero}"** (ex.: "Continuar Ativa #1", "Continuar Aguardando #2"). Destacar visualmente o que estiver selecionado (ex.: borda/fundo rosa quando `maletaDestino?.id === m.id`).
- Um botão **"+ Nova maleta"**:
  - **desabilitado** quando já houver 2 maletas em aberto (mostrar aviso "Limite de 2 maletas atingido"); destacar quando `maletaDestino?.nova === true`.
- Se nenhuma escolha feita, exibir um aviso discreto: "Escolha uma opção acima para liberar o envio."
- Se a revendedora não tem nenhuma maleta aberta: mostrar só **"+ Nova maleta"** (será a 1ª, criada como `ativa`).

### 3. Confirmação no envio (opcional, recomendado)
Em `lancadorEnviar`, antes de gravar, se `maletaDestino.nova`, manter a criação como já está (status `aguardando` se já existe ativa, senão `ativa`). Se for continuar uma existente, gravar com aquele `maleta_id`. Nenhuma mudança de regra aqui — só garantir que **não há destino assumido sozinho**.

## Validar / commitar / publicar
```bash
npm run lint
npm run build
git add src/lancador.js PROMPT-LANCADOR-ESCOLHA-MALETA.md
git commit -m "fix(lancador): sempre exigir escolha de maleta (continuar atual ou nova)"
git push origin main
```

## Teste (npm run dev)
1. Revendedora com 1 maleta ativa: ao selecioná-la, o envio fica **bloqueado** até escolher "Continuar Ativa #1" **ou** "+ Nova maleta".
2. Escolher "+ Nova maleta" cria uma **aguardando** (já que existe ativa); as peças vão pra ela, não pra ativa.
3. Revendedora com 2 abertas: "+ Nova maleta" fica **desabilitado**; só dá pra continuar uma das duas (escolhendo qual).
4. Revendedora sem maleta: aparece só "+ Nova maleta" e cria a **ativa**.
