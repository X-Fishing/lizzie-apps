# Pendências — App Lizzie

> Arquivo de continuidade entre sessões. Atualizar conforme os itens forem resolvidos.
> Última atualização: 16/07/2026

---

## 🔴 URGENTE — próxima sessão

### 1. Impressão de etiqueta de produto
Precisa ser resolvido logo. Ainda **não está especificado** — na próxima sessão, definir antes de gerar o prompt:

- **Qual etiqueta?** Etiqueta de preço da peça (a que vai pendurada no produto, com código e preço) ou etiqueta de envio/identificação?
- **O que sai impresso?** Código/SKU, preço, nome da peça, código de barras (o app já usa `codigo_barras`), banho/categoria, logo Lizzie?
- **Impressora e formato:** térmica (Zebra/Elgin, etiqueta pequena em rolo) ou folha A4 com várias etiquetas por página? Dimensão da etiqueta (mm)?
- **De onde parte?** Da tela de Produtos (uma peça / seleção múltipla), da Entrada de Mercadoria (lote inteiro que acabou de entrar), ou do Lançar Mostruário?
- **Volume:** imprime 1 por vez ou o lote todo (ex.: os 134 produtos novos)?

**Contexto já existente no código** (não começar do zero): a palavra "etiqueta" já aparece em `src/produtos.js`, `src/precificacao.js` e `src/admin.js` — verificar o que já existe antes de implementar. O app também já tem dois padrões de impressão prontos para reaproveitar: `window.print()` com CSS `@media print` (usado no fechamento/conferência/contrato) e **jsPDF + autotable** (usado no PDF do mostruário).

---

## 🟡 Em andamento

### 2. Merge local ↔ origin + push
Divergência entre o agente local (7 commits: telas inteiras de conferência/fechamento, impressões repaginadas, recebimento com múltiplos pagamentos) e a `origin/main` (17 commits: fidelidade 0028–0033, certificado por WhatsApp, PWA auto-update, autocomplete por telefone, Contas a Pagar redesenhado, exclusão de maleta ativa).

**Ponto de atenção no merge:** o `Object.assign(window, { … })` do `main.js` é uma linha única gigante e **os dois lados adicionaram funções**. Resolução ruim ali **quebra `onclick` em silêncio** (não acusa no lint nem no build). Conferir que as funções dos DOIS lados sobreviveram e **testar clicando**. Segundo ponto: `financeiro.js` (recebimento múltiplo × Contas a Pagar) — testar receber maleta com 2 formas de pagamento e confirmar 2 lançamentos.

### 3. Redesign (PLANO-REDESIGN.md)
Branches abertas: `feat/redesign-fase0`, `fase1`, `fase2`, `fase3`. **Fase 4** (consignados + financeiro — a de maior risco) ainda não começou.

**Decisão a registrar no plano:** *fluxo denso = tela inteira, não modal.* Fechamento e Conferência já foram convertidos. Faltam converter, **cada um dentro da fase que já vai tocar o módulo** (para não conflitar com as branches abertas): `modal-bling`, `modal-detalhe-venda`, `modal-recebimento`, `modal-maleta`, `modal-divulgar`, `modal-detalhe-rev`.
**Continuam modais (corretos assim):** `confirma`, `install`, `foto-perfil`, `busca-peca`, `busca-produto`, `scanner`, `pos-venda`.

### 4. Migrações no Supabase
Confirmar que **todas** rodaram: `0007, 0010, 0022, 0023, 0026, 0027` (agente local) + `0028–0033` (fidelidade). Após adicionar colunas, rodar `pg_notify('pgrst','reload schema')`. Tela nova com migração faltando dá erro difícil de diagnosticar.

---

## 🟢 Backlog

### 5. Bling — importar produtos (`bling-produtos`)
Edge Function retorna `INVALID_CREDENTIALS` no portão do Supabase. Hipótese: **Verify JWT ligado** nela (as outras funções-proxy estão desligadas). Conferir com `supabase functions list` e, se for o caso, `verify_jwt = false` em `supabase/config.toml` + redeploy.
**Nota de segurança:** com verify off a função fica publicamente chamável — as proxies do Bling usam o token do Bling server-side, mas **não validam quem chamou**. Vale endurecer depois (ex.: header secreto validado dentro da função).

### 6. Catálogo (pasta Marketing — resolvido direto no Cowork, sem VS Code)
- **Subcategorias automáticas dos brincos:** os novos (21800+) caem todos em "Outros" porque a lista `SUBCATS` é fixa e manual. Fazer a subcategoria sair da descrição (Argola→Argolas, Coração→Corações…) — some a manutenção e o "Outros" para de lotar.
- **Preços faltando:** vários itens aparecem com "—". Ver `PENDENCIAS-CATALOGO.md` (gerado pelo build) e completar na origem.
- **Foto do brinco 20505:** não existe. A única foto do 20505 é a do **anel** `2050518` (mesma base de 5 dígitos). O brinco só entra no catálogo quando a foto dele for tirada/subida.

### 7. Processo
Dois agentes empurrando para a mesma `main` gerou a divergência atual. Combinar: **um agente por vez na `main`**, ou cada um em branch com PR.
