# PROMPT — Etiquetas cortando o preço (rolo real é 30×15mm, código assume 30×20mm)

> Rodar no VS Code em **`D:\lizzie-apps`**. Branch: `fix/etiquetas-altura-15mm` (a partir de `main`).
> Arquivo principal: **`src/etiquetas.js`**. Possível toque em `index.html` (novos campos no painel de config).
> `npm run lint` + `npm run build` verdes. **Um commit por etapa.**

## Sintoma relatado (Rondon, 2026-08-06)
"A impressão parou de ficar enquadrada, preço está cortando quase inteiro, desconfigurou sozinha."
Config atual em Configurações → Impressora de Etiquetas: **203 dpi, 3 colunas no rolo**. Preço corta
embaixo/fora da etiqueta (não nas laterais). Aconteceu tanto num computador novo quanto no de sempre —
não é coisa de um PC só.

## Causa raiz (confirmada, não é suposição)
O rolo físico usado agora tem etiquetas de **30×15mm** (confirmado por medição direta do Rondon). O
código em `src/etiquetas.js`, função `gerarZPL` (linha ~98) e `gerarZPLLinha` (linha ~110), usa
`alturaMm = 20` como default **hardcoded**, herdado das rodadas de calibração antigas (rev.4→rev.6,
comentário em `calibracao()` linha ~24-45) — essas rodadas foram feitas para um rolo de **1 coluna**
diferente deste, que aparentemente era mesmo ~20mm de altura física. O rolo de **3 colunas** que está
em uso hoje é 15mm, 5mm mais baixo, e ninguém recalibrou o layout vertical pra essa diferença.

Com a calibração atual (rev.6, em `calibracao(dpi)`):
- `BARRA_Y` = 4.5mm, `BARRA_ALTURA` = 6mm → barra ocupa até ~10.5mm
- `SKU_Y` = 11mm, fonte ~2.5mm → SKU ocupa até ~13.5mm
- `PRECO_Y` = 13.8mm, fonte ~3.25mm → **preço ocupa até ~17mm**

Numa etiqueta real de 15mm, tudo que passa de 15mm cai fora da área física — e é quase todo o preço
(13.8mm a 17mm), exatamente o sintoma relatado.

Segundo problema, estrutural (não é a causa do bug de hoje, mas é por isso que ninguém conseguiu
corrigir isso sem mexer em código): **não existe nenhum campo em Configurações → Impressora de
Etiquetas pra largura/altura da etiqueta.** Só tem Impressora, DPI e Colunas no rolo. `larguraMm` e
`alturaMm` só existem como default hardcoded dentro das funções de geração de ZPL — trocar de rolo
físico (como aconteceu aqui) sempre vai exigir editar código e fazer deploy, em vez de ajustar uma
tela.

## O que fazer

### 1. Expor largura/altura da etiqueta como configuração (não mais hardcoded)
Em `carregarCfgImpressora`/`salvarCfgImpressora` (linha ~199-206), o objeto de config já guarda
`{ deviceName, dpi, colunas }` no `localStorage` (chave `lizzie_etiqueta_config`). Adicionar
`larguraMm` e `alturaMm` a esse objeto. Na tela de config (`renderConfigPanel`, linha ~341-373),
adicionar dois campos numéricos (`<input type="number" step="0.1">`) — "Largura da etiqueta (mm)" e
"Altura da etiqueta (mm)" — com default 30 e 15 (não mais 20 — ver seção seguinte) se não houver config
salva ainda. `etiquetasConfigSalvar` (linha ~375) passa a ler e gravar esses dois campos também.

Todo lugar que hoje chama `gerarZPLLote`/`gerarZPL` passando só `{ dpi, colunas }` (`etiquetasImprimir`
linha ~452, `etiquetasBaixarZpl` linha ~467, `etiquetasTeste` linha ~404, `dispositivoConfigurado`
linha ~384-391) passa a também repassar `larguraMm`/`alturaMm` vindos da config salva. Manter os
defaults internos de `gerarZPL`/`gerarZPLLinha` (`larguraMm = 30, alturaMm = 20`) como fallback só pra
quando não há config nenhuma ainda — mas na prática, com a config sempre presente, esse fallback não
deve mais ser o caminho normal.

### 2. Recalibrar o layout vertical pra caber em 15mm de verdade
Com altura real confirmada em 15mm, os números de `calibracao()` (linha ~46-62) — feitos pra 20mm —
não cabem. Precisa comprimir verticalmente. Ponto de partida sugerido (mesma lógica das revisões
anteriores: comprimir sem perder legibilidade, deixando folga de segurança embaixo em vez de colar no
limite):
- `BARRA_Y`: manter ~3mm (um pouco mais colado no topo que os 4.5mm atuais, já que sobra menos altura)
- `BARRA_ALTURA`: reduzir pra ~4.5mm (era 6mm — precisa perder algo; ver nota de leitura de código de
  barras abaixo)
- `SKU_Y`: ~8mm
- `SKU_FONTE`: pode manter 20 ou cair um pouco (18) se sobrar apertado
- `PRECO_Y`: ~10.5mm
- `PRECO_FONTE`: pode manter 26 ou cair pra 22-24 se estourar

Esses números são **ponto de partida, não a resposta final** — a mesma ressalva de todas as rodadas
anteriores (rev.2 a rev.6) se aplica: isso é calibração de hardware, só a etiqueta física impressa
confirma se está certo. Deixar as constantes nomeadas e comentadas como já é o padrão do arquivo, pra
serem fáceis de re-ajustar depois de um teste físico.

**Atenção ao código de barras**: reduzir `BARRA_ALTURA` de 6mm pra 4.5mm pode deixar a barra difícil de
ler no leitor do app. Se o teste físico mostrar isso, é melhor cortar da fonte do SKU/preço do que da
altura da barra — código de barras que não lê quebra o fluxo de estoque, texto pequeno só incomoda.
Comentar essa prioridade no código, do jeito que os comentários de calibração anteriores já fazem.

### 3. Não mexer na largura nem no `gapMm` entre colunas
30mm de largura por coluna já bate com a medida confirmada — o problema é só a altura. Não reabrir
`MARGEM_X`, `BARRA_MODULO` nem `gapMm` (2mm hoje) sem pedido explícito; são coisas que já passaram por
calibração e não têm relação com esse bug.

## ⚠️ Regra de ouro
Não mexer em `precificacao.js`, `produtos.js`, `consignados.js` nem `financeiro.js` além do necessário
pra repassar `larguraMm`/`alturaMm` nas chamadas já existentes de impressão. Não trocar a lógica de
`gerarZPLLinha`/multi-coluna, só os valores que ela recebe. Sem framework novo.

## Teste (obrigatório, físico — não dá pra validar isso só no lint/build)
1. `npm run lint` + `npm run build` verdes.
2. Configurações → Impressora de Etiquetas: confirmar que os novos campos de largura/altura aparecem,
   default 30×15mm quando não há config salva.
3. Imprimir etiqueta de teste (3 colunas, já que é o cenário real em uso) → **conferir na etiqueta
   física**: preço aparece inteiro? Código de barras lê no leitor do app? Nada estourando a lateral de
   cada coluna?
4. Se cortar ainda ou sobrar espaço demais, ajustar as constantes de `calibracao()` e testar de novo —
   é normal precisar de mais de uma rodada, como nas calibrações anteriores.
5. Depois de calibrado, trocar "Colunas no rolo" pra 1 e confirmar que o modo de coluna única (usado
   por quem tiver rolo simples) continua correto com a nova altura de 15mm — hoje as duas configs
   dividem a mesma `calibracao()`, então mudar a altura afeta os dois modos.

## Commits sugeridos
1. `feat(etiquetas): largura/altura da etiqueta configuráveis em Configurações (antes hardcoded)`
2. `fix(etiquetas): recalibra layout vertical pra 15mm — preço não corta mais no rolo de 3 colunas`
