# Pendências — App Lizzie

> Arquivo de continuidade entre sessões. Atualizar conforme os itens forem resolvidos.
> Última atualização: 16/08/2026

---

## 🧰 COMO RODAR SQL DAQUI (descoberto em 16/08/2026)

Não precisa de Docker, nem de psql, nem da senha do banco. O CLI já está
autenticado e roda SQL pela Management API:

```
npx supabase db query --linked "select 1"
npx supabase db query --linked -f supabase/testes/0057-fidelidade-ciclo.sql
```

`begin … rollback` funciona por essa via (verificado), então os scripts de
`supabase/testes/` podem rodar contra a base real sem gravar nada. Confira
sempre um snapshot antes/depois:

```
select (select coalesce(sum(selos),0) from fidelidade_cartelas) as selos,
       (select count(*) from vendas) as vendas;
```

## ⚠️ LIÇÃO CARA (16/08/2026) — o banco não é o que o repo assume

A migração **0035** (`vendas.maleta_id`) **nunca tinha sido aplicada**, e
ninguém percebeu porque a 0057 aplicou **sem erro**: o Postgres não valida
referência a coluna dentro de corpo de função. A bomba ficou armada até a
primeira venda. Já foi corrigido (0035 aplicada, 315/318 vendas backfilladas).

**Regra que fica:** antes de publicar qualquer coisa que dependa de coluna
nova, confira no banco de verdade, não no repo:

```
select column_name from information_schema.columns
 where table_schema='public' and table_name='vendas' order by ordinal_position;
```

**Segunda lição, sobre janela de deploy:** a 0055/0057 derrubaram as
assinaturas antigas de `registrar_venda`, o que quebrou o app **publicado**
até o push sair. Migração que troca assinatura de RPC usada pelo front deve
deixar um atalho compatível com a assinatura antiga, ou a janela entre
migração e deploy fica com o app fora do ar.

---

## 🔴 URGENTE — próxima sessão

### 1. ✅ ESPECIFICADO (04/08/2026) — Impressão de etiqueta de produto
Especificação fechada com o Rondon. Prompt gerado: **`PROMPT-ETIQUETAS-ZEBRA.md`** — falta só rodar no VS Code.

- **Impressora:** Zebra, via SDK **Zebra Browser Print** (cobre USB local hoje e rede depois com a mesma integração). Pré-requisito de máquina: instalar o Zebra Browser Print no PC que vai imprimir (fora do código).
- **Tamanho:** 30 x 15mm.
- **Conteúdo:** código de barras (Code128, usa `codigo_barras` ou cai no SKU se vazio) + SKU em texto + preço.
- **De onde parte:** dos dois — Entrada de Mercadoria (lote inteiro, resolve o TODO que já existia em `precificacao.js` linha 622) e tela de Produtos (peça avulsa).
- **Achado no código:** já existe o TODO `// TODO etiquetas: quando a impressão (Zebra/Argox) existir...` em `precificacao.js`, e o campo `codigo_barras` já existe em `produtos`. Não é `window.print()` (padrão usado no resto do app) — etiqueta térmica precisa de ZPL nativo, ver prompt para o porquê.
- **Atenção física:** 30x15mm é apertado; o prompt já avisa que vai precisar de calibração na impressora real antes de ir pra produção.

---

## 🟡 Em andamento

### 2-A. ✅ RESOLVIDO (29/07/2026) — teste de escalada de privilégio
Testado autenticando como a revendedora de teste **"Claude Testes"** (`role=revendedora`, conta de teste, zero dados) via API REST. **Resultado: APROVADO.**

| Tentativa | Resultado |
|---|---|
| `pode_completar_vendas: true → false` | bloqueado — `P0001 Apenas admin altera a flag de revendedora...` |
| `role: revendedora → admin` | bloqueado — `P0001 Apenas admin pode alterar o nivel de acesso` |
| `is_revendedora: true → false` | bloqueado |
| alterar perfil de terceiro | 0 linhas afetadas (RLS filtrou) |
| perfil relido depois | **intacto** |

Os bloqueios vêm do trigger `guard_profile_role` (migração 0039). Detalhes aprendidos, para não repetir erro em testes futuros:
- **O guard só dispara quando o valor MUDA** (`is distinct from`). Setar a flag para o valor que ela já tem é no-op e não gera erro — parece furo e não é. Sempre **inverter** o valor no teste.
- **Não testar com conta `role=admin`**: o guard legitimamente permite admin, e todas as tentativas "passam" (falso positivo). Pior, `is_revendedora=false` funcionaria de verdade e quebraria dado real.
- **`aprovada` não é protegida pelo guard** de propósito: `profiles_update_staff` permite que staff aprove revendedora. Sucesso ali é correto, não furo.
- Update sem permissão volta **HTTP 200 com lista vazia** (RLS filtra em silêncio), não erro — confira o dado, não só o status.

**Cuidado permanente ao re-rodar o `RLS-policies.sql`:** o arquivo está com o guard mesclado e a policy `profiles_update_own` congelando `pode_completar_vendas`. Se alguém colar uma versão antiga por cima, a proteção some silenciosamente.

### 2-B. `npm audit` — 5 vulnerabilidades pré-existentes (investigar)
Levantado em 29/07/2026, **sem relação** com `pg`/`playwright` (que entraram limpos). Todas são **transitivas de build/dev**, nenhuma no código do app:

| Pacote | Problema | Onde entra |
|---|---|---|
| `brace-expansion` ≤5.0.7 | DoS (expansão exponencial / OOM) | transitiva do eslint/filelist |
| `dompurify` ≤3.4.11 | — | transitiva do **jspdf** (certificado/PDF) |
| `esbuild` 0.27.3–0.28.0 | leitura arbitrária de arquivo **no dev server, Windows** | transitiva do **vite** |
| `fast-uri` 3.0.0–3.1.3 | host confusion | transitiva |
| `postcss` ≤8.5.17 | — | transitiva do vite |

`npm audit fix` promete resolver todas. **Não rodar às cegas:** o `esbuild`/`postcss` sobem junto com o Vite e podem quebrar o build; o `dompurify` vem do jspdf, que gera o certificado de garantia e o PDF do mostruário — testar os dois depois.

O `esbuild` é o único com impacto prático plausível: afeta **quem roda `npm run dev` no Windows** (a máquina de vocês). Não afeta produção, porque o dev server não vai para o Netlify.

**Como atacar:** rodar `npm audit fix` numa branch, conferir `npm run build` + gerar certificado + PDF do fechamento, e só então mesclar. Respeitar o protocolo de dependências (versões exatas, cooldown de 7 dias).

### 2. Merge local ↔ origin + push
Divergência entre o agente local (7 commits: telas inteiras de conferência/fechamento, impressões repaginadas, recebimento com múltiplos pagamentos) e a `origin/main` (17 commits: fidelidade 0028–0033, certificado por WhatsApp, PWA auto-update, autocomplete por telefone, Contas a Pagar redesenhado, exclusão de maleta ativa).

**Ponto de atenção no merge:** o `Object.assign(window, { … })` do `main.js` é uma linha única gigante e **os dois lados adicionaram funções**. Resolução ruim ali **quebra `onclick` em silêncio** (não acusa no lint nem no build). Conferir que as funções dos DOIS lados sobreviveram e **testar clicando**. Segundo ponto: `financeiro.js` (recebimento múltiplo × Contas a Pagar) — testar receber maleta com 2 formas de pagamento e confirmar 2 lançamentos.

### 3. Redesign (PLANO-REDESIGN.md)
Branches abertas: `feat/redesign-fase0`, `fase1`, `fase2`, `fase3`. **Fase 4** (consignados + financeiro — a de maior risco) ainda não começou.

**Decisão a registrar no plano:** *fluxo denso = tela inteira, não modal.* Fechamento e Conferência já foram convertidos. Faltam converter, **cada um dentro da fase que já vai tocar o módulo** (para não conflitar com as branches abertas): `modal-bling`, `modal-detalhe-venda`, `modal-recebimento`, `modal-maleta`, `modal-divulgar`, `modal-detalhe-rev`.
**Continuam modais (corretos assim):** `confirma`, `install`, `foto-perfil`, `busca-peca`, `busca-produto`, `scanner`, `pos-venda`.

### 4-C. RODAR: `0049_categoria_verniz_padrao.sql` (06/08/2026)
Entrada de Mercadoria invertida: **categoria vira o campo do topo do lote** (as meninas lançam por categoria), e **fornecedor passa a ser por linha**. Banho e verniz agora são configuráveis por categoria em **Estoque > Precificação** (novo card "Banho e verniz por categoria") — banho já existia (`categorias.banho_padrao`, migração 0015), verniz é novo (`categorias.verniz_padrao`, default **390** para todas). A migração também tenta casar os 11 valores de banho passados pelo Rondon (brinco 2, anel 5, resto 3) por nome — **confira o `select` final da migração no SQL Editor** pra ver quais categorias casaram e quais precisam de ajuste manual na tela.

O campo "Banho padrão" saiu do cadastro de Categorias (Estoque > Categorias) — fica só em Precificação agora, pra não ter duas telas com valor divergente.

Enquanto a 0049 não roda: a tela funciona, mas o verniz padrão sempre cai em 390 no front-end (fallback local) e salvar o card novo em Precificação mostra aviso pra rodar a migração.

### 4-B. RODAR: `0048_financeiro_anexos.sql` (06/08/2026)
Cria `financeiro_anexos` — comprovantes de pagamento em Contas a Receber, **vários por lançamento** (um acerto costuma ser pago em mais de um PIX). Reaproveita o bucket privado `documentos` da 0026, sem bucket nem policy de storage nova. Enquanto não rodar, a tela **funciona normal** e só não mostra os comprovantes (o erro cai num `console.warn`, não quebra o financeiro).

### 4-A. RODAR: `0047_produtos_delete_admin.sql` (04/08/2026)
A grid de Produtos ganhou **exclusão em massa**, e o botão de excluir (linha e barra de massa) só aparece pro **admin**. Isso é trava de **UI** — a policy de delete de `produtos`/`produto_variacoes` ainda é `is_gestor()`, então **func_completo consegue apagar chamando a API direto**. A migração 0047 troca essa policy pra `is_admin()`. O `produtos-schema.sql` já foi alinhado junto (um re-run dele não reabre o delete).

**Atenção na numeração:** `0043`–`0046` já foram rodadas no Supabase pela outra sessão (Contas a Receber, conciliação bancária, histórico de conciliação, admin recebe) e **não estão versionadas neste repo** — o `supabase/migrations/` pula de 0042 pra 0047. Vale trazer esses 4 arquivos pro repo, senão um ambiente novo nasce sem eles.

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

### 8. Fornecedores misturados — financeiro × peças (04/08/2026)
Reportado pelo Rondon: o dropdown "Fornecedor do lote" da **Entrada de Mercadoria** mistura fornecedores de **peça** de verdade (Adonai, Ana Maria, Araujo Brutos, Boa Vista, Fabiana Brutos...) com beneficiários do **financeiro** (Claro, Estacionamento, INSS, Imobiliaria, Loreto Contabilidade, "Casa do Bolo"...). Precisamos de duas listas separadas — poucos fornecedores de peça devem aparecer nos dois menus.

**Causa raiz:** uma única tabela `fornecedores` alimenta dois selects diferentes:
- Entrada de Mercadoria / Produtos / Precificação (fornecedor de **peça**).
- Contas a Pagar, via quick-add (`cadNovo('fornecedores')` em `contas-a-pagar.js`) — deixa cadastrar **qualquer** beneficiário de conta a pagar (aluguel, telefone, contador...) direto nessa mesma tabela.

**Caminho mais barato (evita mexer nas FKs):** adicionar uma coluna `tipo` (ou `categoria`) em `fornecedores` com valores `peca` | `financeiro` | `ambos`, e cada tela filtra pelo tipo dela. Resolve "poucos aparecem nos dois" com `ambos`, sem precisar migrar dados nem duplicar `fornecedor_id` em `produtos`/`contas_a_pagar` (que hoje apontam pra mesma tabela). Alternativa mais invasiva: tabela nova `fornecedores_financeiro` separada — mais trabalho de migração, só vale se um dia precisar de campos bem diferentes entre os dois tipos.
