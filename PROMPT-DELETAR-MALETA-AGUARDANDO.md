# PROMPT — "Deletar catálogo" passa a excluir só a maleta AGUARDANDO

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta (branch `feat-maletas`).
> Mexa em `src/consignados.js` (função `deletarCicloRev` e o que for necessário). Commit no fim. Teste local.

## Regra (decisão do dono)
A ação destrutiva **nunca pode tocar a maleta ATIVA** (ela está com a revendedora, no app dela — apagar quebraria tudo). Portanto, "Deletar catálogo" passa a significar: **excluir a maleta AGUARDANDO** (a próxima já montada), e somente ela.

## Comportamento esperado
Ao acionar `deletarCicloRev` para uma revendedora:
1. Buscar a(s) maleta(s) com `status = 'aguardando'` daquela revendedora:
   `select id from maletas where revendedora_id = :rev and status = 'aguardando'`.
2. Se **não houver** aguardando: mostrar toast "Esta revendedora não tem maleta aguardando para excluir." e **não fazer nada** (não tocar na ativa).
3. Se houver: confirmação clara (usar `confirmarAcao`) — algo como:
   "Excluir a maleta AGUARDANDO de {nome}? As peças dessa maleta serão removidas. A maleta que está com a revendedora NÃO é afetada." → botão "Excluir maleta aguardando".
4. Ao confirmar:
   - `delete from consignados where maleta_id in (:idsAguardando)` (remove as peças da aguardando).
   - `delete from maletas where id in (:idsAguardando)` (remove a linha, para não contar no limite de 2).
   - Toast de sucesso e recarregar a tela (staff).
5. **Nunca** apagar por `revendedora_id` solto, nem mexer em peças/maleta com `status='ativa'`.

## UI (recomendado)
- Renomear o rótulo/título do botão de "Deletar catálogo" para **"Excluir maleta aguardando"** onde ele aparece (staff/admin), para refletir o novo significado.
- Opcional: só exibir o botão quando a revendedora tiver uma maleta aguardando (se for simples detectar no contexto onde o botão é renderizado). Se complicar, deixe o botão sempre visível e trate o caso "não há aguardando" com o toast do item 2.

## Validar e commitar
```bash
npm run lint
npm run build
git add src/consignados.js PROMPT-DELETAR-MALETA-AGUARDANDO.md
git commit -m "fix(maletas): deletar catalogo passa a excluir apenas a maleta aguardando (preserva a ativa)"
```

## Teste (npm run dev)
- Revendedora com ativa + aguardando → "Excluir maleta aguardando" remove só a aguardando (peças + linha); a ativa e o catálogo da revendedora ficam intactos; o limite volta a permitir criar nova.
- Revendedora só com ativa → ação informa que não há aguardando e não apaga nada.
