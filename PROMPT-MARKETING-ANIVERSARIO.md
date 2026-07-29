# PROMPT — Marketing › "Aniversário Revendedoras" (Em breve)

## Objetivo
Adicionar um novo item ao grupo **Marketing** do menu chamado **Aniversário Revendedoras**, marcado como **"Em breve"** (badge, não clicável), reaproveitando a mecânica de `em_breve` que já existe.

## Arquivo a editar
`src/menu.js`

## Passo 1 — (opcional, recomendado) adicionar um ícone de bolo
No objeto de ícones `IC` (por volta das linhas 19–31, junto de `mega`, `tag`, `gift`), adicione uma entrada `cake`:

```js
  cake:      '<svg class="ico" viewBox="0 0 24 24"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3"/><path d="M7 4h.01M12 4h.01M17 4h.01"/></svg>',
```

> Se preferir não criar ícone novo, pode reutilizar `IC.gift` no Passo 2.

## Passo 2 — adicionar o item no grupo Marketing
No array do grupo Marketing (hoje):

```js
  { grupo: 'grp_marketing', label: 'Marketing', icon: IC.mega, filhos: [
      { chave: 'cad_raspadinha',  panel: 'config-raspadinha', label: 'Raspadinha', icon: IC.tag, admin_only: true },
      { chave: 'marketing_bonus', panel: 'bonus',             label: 'Bônus',      icon: IC.gift, em_breve: true },
  ]},
```

Adicione uma nova linha em `filhos` (após o Bônus):

```js
      { chave: 'marketing_aniversario', panel: 'aniversario-revendedoras', label: 'Aniversário Revendedoras', icon: IC.cake, em_breve: true },
```

Ficando assim:

```js
  { grupo: 'grp_marketing', label: 'Marketing', icon: IC.mega, filhos: [
      { chave: 'cad_raspadinha',        panel: 'config-raspadinha',      label: 'Raspadinha',              icon: IC.tag,  admin_only: true },
      { chave: 'marketing_bonus',       panel: 'bonus',                  label: 'Bônus',                   icon: IC.gift, em_breve: true },
      { chave: 'marketing_aniversario', panel: 'aniversario-revendedoras', label: 'Aniversário Revendedoras', icon: IC.cake, em_breve: true },
  ]},
```

## Observações
- **Não precisa criar painel/rota nem permissão**: como `em_breve: true`, o menu já:
  - renderiza o item com o badge `Em breve` (`<span class="badge-soon">Em breve</span>`);
  - torna o item não navegável (`canSee`/`isNavigable` retornam `false` para `em_breve`);
  - ignora o item ao escolher o primeiro painel visível.
- O `panel: 'aniversario-revendedoras'` é apenas um placeholder para quando a feature for implementada; pode manter esse valor.
- Se optou por não criar o ícone `cake`, troque `icon: IC.cake` por `icon: IC.gift`.

## Teste rápido
1. `npm run dev`.
2. Abrir o menu lateral › grupo **Marketing**.
3. Confirmar que aparece **Aniversário Revendedoras** com o selo **Em breve** e que **não é clicável**.
