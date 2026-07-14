# PROMPT — Reestruturar o menu lateral (Estoque, Financeiro, Marketing, Configurações)

> Rodar no VS Code com a pasta **`D:\lizzie-apps`** aberta (só nela). Branch: `feat/menu-reestrutura`.
> Arquivos: **`src/menu.js`** (registry) e **`src/nav.js`** (lista de painéis). Mais o `index.html` só para o painel novo "Bônus".
> `npm run lint` + `npm run build` verdes antes do commit.

## ⚠️ REGRA DE OURO — NÃO MUDE NENHUMA `chave`
Cada item do `MENU` tem uma `chave` que é **a permissão gravada no banco** (`perfil_permissoes.chave_menu`). Se você renomear uma `chave` ao mover o item, **todos os perfis de funcionário perdem o acesso àquela tela**.

**Mover item de grupo é livre — a `chave` viaja junto, sem mudar.** Só o `label` e a posição mudam. O código já faz isso hoje (veja o comentário `// chave 'cad_garantias' mantida: perfis existentes seguem valendo`). Siga o mesmo princípio para **todos** os itens movidos.

Itens que mudam de lugar mas **mantêm a chave original**:
| Item | chave (NÃO MUDAR) | sai de | vai para |
|---|---|---|---|
| Produtos | `vendas_produtos` | Vendas | **Estoque** |
| Fornecedores | `cad_fornecedores` | Cadastros | **Estoque** |
| Categorias | `cad_categorias` | Cadastros | **Estoque** |
| Coleções | `cad_colecoes` | Cadastros | **Estoque** |
| Revendedoras | `cad_revendedoras` | Cadastros | **Vendas** |
| Clientes | `cad_clientes` | Cadastros | **Vendas** |
| Formas de Pagamento | `cad_formas_pagamento` | Cadastros | **Financeiro** |
| Categorias Financeiras | `cad_categorias_fin` | Cadastros | **Financeiro** |
| Raspadinha | `cad_raspadinha` | Cadastros | **Marketing** |
| Financeiro → vira "Lançamentos" | `financeiro` | item solto | **Financeiro** (grupo) |

## Estrutura final do `MENU`

```
Dashboard                                  chave: dashboard            panel: dashboard

Vendas            (grupo, IC.bag)
  Controle de Vendas      vendas_controle       consignados
  Revendedoras            cad_revendedoras      admin
  Clientes                cad_clientes          clientes            (em_breve)
  Lançar Mostruário       vendas_lancar         lancador
  Troca de Mostruário     vendas_troca          trocas
  Garantias               cad_garantias         garantias

Estoque           (grupo NOVO, IC.package)
  Fornecedores            cad_fornecedores      fornecedores
  Produtos                vendas_produtos       produtos
  Categorias              cad_categorias        categorias
  Coleções                cad_colecoes          colecoes

Financeiro        (vira grupo, IC.fin)
  Lançamentos             financeiro            financeiro          ← era o item solto "Financeiro"
  Formas de Pagamento     cad_formas_pagamento  formas-pagamento    (em_breve)
  Categorias Financeiras  cad_categorias_fin    categorias-financeiras (em_breve)

Calculadora                                calculadora   (em_breve)  ← INALTERADO

Marketing         (vira grupo, IC.mega)
  Raspadinha              cad_raspadinha        config-raspadinha   (admin_only)
  Bônus                   marketing_bonus       bonus               (em_breve, ITEM NOVO)

Configurações     (seção — era "Cadastros")
  Funcionários            cad_funcionarios      funcionarios        (admin_only)
  Faixas de Comissão      cad_faixas_comissao   faixas-comissao
```

## Detalhes de implementação

### 1. Ícones novos (adicionar no objeto `IC` de `menu.js`, mesma família Lucide)
```js
package: '<svg class="ico" viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
gift:    '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
```
- **Estoque** usa `IC.package`; **Bônus** usa `IC.gift`.
- **Financeiro** (grupo) usa o `IC.fin` que já existe; **Marketing** (grupo) usa o `IC.mega` que já existe.

### 2. Grupos vs seção (o registry tem os dois formatos — respeite)
- **Grupo com ícone** (como Vendas hoje): `{ grupo: 'grp_x', label: 'Nome', icon: IC.y, filhos: [...] }` → use para **Estoque**, **Financeiro** e **Marketing**.
- **Seção** (como Cadastros hoje): `{ secao: 'Cadastros', grupo: 'grp_cadastros', filhos: [...] }` → **Configurações** continua nesse formato: só troque `secao: 'Cadastros'` por `secao: 'Configurações'`. **Mantenha `grupo: 'grp_cadastros'`** (não invente id novo — evita resetar estado de colapso).

### 3. Item novo "Bônus"
- Entrada no MENU: `{ chave: 'marketing_bonus', panel: 'bonus', label: 'Bônus', icon: IC.gift, em_breve: true }`
- Em **`src/nav.js`**: adicionar `'bonus'` ao array **`PANEIS_STAFF`**.
- No `index.html`: criar o `div#panel-bonus` **seguindo exatamente o padrão dos outros painéis "em breve"** (ex.: `formas-pagamento`). Não invente tela — é só placeholder.
- A chave `marketing_bonus` é nova, então aparece automaticamente no checklist de permissões (via `todasChaves()`). Ninguém terá essa permissão até você marcar no perfil — é o esperado.

### 4. A chave `marketing` antiga
Hoje existe `{ chave: 'marketing', panel: 'marketing', label: 'Marketing', em_breve: true }` como item solto. Ao virar **grupo**, esse item deixa de existir.
- Remova o item e tire `'marketing'` do `PANEIS_STAFF` em `nav.js`.
- **Consequência (aceitável):** linhas em `perfil_permissoes` com `chave_menu = 'marketing'` viram dados órfãos — inofensivos, apenas ignorados (a tela era um placeholder "em breve", ninguém perde nada real). Não precisa migração de banco.

### 5. Não mexer
- `podeVer()`, `primeiroPanelInicial()`, `podeAcessarPanel()`, `carregarPermissoes()` e o `ACOES` continuam **iguais** — eles são genéricos e funcionam sozinhos com o registry novo.
- Nenhuma mudança em RLS, auth, PWA.

## Testes (obrigatórios — permissão é o risco aqui)
1. **Como admin:** o menu mostra a estrutura nova completa; todos os itens abrem a tela certa (clicar em cada um). Os "Em breve" aparecem desabilitados.
2. **Como funcionário com perfil restrito** (o teste que importa): pegue um perfil existente que tinha, por exemplo, permissão de **Produtos** e **Fornecedores**. Depois da mudança, essa pessoa **tem que continuar vendo Produtos e Fornecedores** — agora dentro de **Estoque**. Se sumiu, alguma `chave` foi alterada — corrija.
3. Um funcionário sem nenhuma permissão de Estoque **não deve ver o grupo Estoque** (o pai some sozinho quando não há filhos visíveis — comportamento já existente).
4. A tela de **Funcionários → permissões** lista as chaves novas (`marketing_bonus`) e não quebrou.
5. Console limpo; `npm run lint` e `npm run build` verdes.

## Commits sugeridos
1. `feat(menu): grupo Estoque (Produtos, Fornecedores, Categorias, Coleções)`
2. `feat(menu): Financeiro e Marketing viram menus pai; Cadastros vira Configurações`
3. `feat(menu): Revendedoras e Clientes movidos para Vendas + item Bônus (em breve)`
