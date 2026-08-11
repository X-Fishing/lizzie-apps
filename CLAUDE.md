# Instruções para o Claude (Cowork) — Projeto Lizzie Apps

## REGRA PRINCIPAL — NÃO CODAR AQUI
É **proibido editar/criar arquivos de código diretamente nesta pasta** pelo Cowork.

O Claude do Cowork deve **sempre gerar um PROMPT** para ser executado pelo **Claude/Copilot dentro do VS Code**. O fluxo é:

1. Entender o pedido e planejar.
2. Entregar um **arquivo PROMPT** (estilo `PROMPT-LAYOUT.md` / `PROMPT-PRODUTOS.md`) com instruções claras, passo a passo, para o agente do VS Code aplicar.
3. Não usar Write/Edit em arquivos `.js`, `.html`, `.css`, `.sql` etc. da feature. A implementação acontece no VS Code.

Exceção: arquivos de **documentação/instrução/PROMPT** (como este `CLAUDE.md`, o `CHANGELOG.md` e os `PROMPT-*.md`) podem ser criados pelo Cowork.

---

## Contexto do projeto
- App PWA de gestão da Lizzie Semijoias (Vite + JS puro + Supabase).
- Dois públicos por papel: funcionários/gestão e revendedoras.
- Migração gradual para fora do Bling (catálogo de produtos próprio).
- Deploy: Netlify (push em `origin/main` publica). Variáveis `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` ficam no Netlify e no `.env` local (não commitar `.env`).

---

## REGRAS OPERACIONAIS (importantes — valem para toda sessão)

### Banco de dados
- **O Supabase é um projeto único: dev = produção** (`qoouzjntyfzcxnwjksiu`). Não existe base de teste separada.
  - Consequência: rodar uma migration no SQL Editor **já vale para produção**.
  - Consequência: testar no `localhost` mexe em **dados reais** — usar revendedora/cliente de teste.

### Deploy
- **Push só com autorização explícita do Rondon** ("pode deploiar"). Nunca fazer push por conta própria.
- Push em `origin/main` → Netlify publica automaticamente.
- **Edge Functions têm deploy manual**: `npx supabase functions deploy <nome>` — só quando pedido.
- O Supabase CLI está como devDependency (usar via `npx supabase ...`).

### Antes de mexer no disco/máquina
- Conferir que está tudo commitado e no GitHub.
- **Fazer backup do `.env`** (ele é gitignored e contém as chaves do Supabase).

---

## REGRAS DE NEGÓCIO CONSOLIDADAS

### Programa de Fidelidade (cliente final)
- **1 selo a cada R$150 cheios** da venda: `floor(total / 150)`. R$450 = 3 selos; R$449 = 2.
- Cartela de **10 selos**; ao completar, a cliente ganha **R$300 em peças** (retirada na loja da Lizzie).
- **O excedente ACUMULA** na cartela nova. Ex.: 9 selos + venda de R$450 (3 selos) → completa a cartela, gera o prêmio e a nova cartela começa com **2**.
  - *Racional:* seria injusto a cliente perder selos justamente por ter comprado mais.
- **Chave da cliente = telefone** (normalizado `55DDDNNNNNNNNN`). A cartela é da cliente e **soma entre revendedoras diferentes**.
- **Privacidade:** a revendedora só enxerga clientes para quem ela já vendeu (RLS). O autocomplete do PDV usa a RPC `buscar_cliente_por_telefone` (match **exato**, sem listagem) para achar cliente cadastrada por outra revendedora sem vazar a base.
- **Resgate do prêmio:** só gestor/admin.

### Maletas
- Status: **ativa** (com a revendedora) · **aguardando** (montada, esperando troca) · **finalizada**.
- **Máximo 2 em aberto** por revendedora (ativa + aguardando). Finalizadas não contam. **Máximo 1 ativa**.
- Ao lançar, o sistema **sempre pergunta**: continuar maleta existente ou criar nova.
- A revendedora enxerga **só a maleta ativa** no catálogo dela.
- Ao finalizar o catálogo: a ativa vira finalizada e a aguardando vira ativa (a troca).
- **"Excluir maleta aguardando" nunca toca a maleta ativa** (ela está com a revendedora, no app dela).

### Lançador (bipe)
- **Cada bipe = 1 linha com 1 unidade** — nunca somar quantidade.
- Campo de bipe fica como "última linha" (estilo Bling), com auto-scroll e foco mantido (leitor USB).

---

## Convenções de código (seguir nos prompts)
- Sem emojis na interface: usar ícones de linha SVG (classe `.ico`) — ver `PROMPT-LAYOUT.md`.
- Funções chamadas via `on*` no HTML precisam ser expostas no `Object.assign(window, {...})` do `src/main.js` (o ESLint deriva os globais daí — **não colocar comentários dentro desse objeto**, quebra o parser).
- Toda tabela nova precisa de **RLS + policies** antes de ir pro ar (helpers `is_staff()`, `is_gestor()`, `is_admin()`).
- Escapar dados de usuário/Bling com `esc()` antes de interpolar em `innerHTML`.
