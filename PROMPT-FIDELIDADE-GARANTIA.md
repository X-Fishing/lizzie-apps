# PROMPT (PLAN) — Programa de Fidelidade + Garantia automática no WhatsApp

> **Como usar:** rode em modo *plan* no VS Code. Primeiro produza o PLANO (arquivos, ordem, riscos) e só depois implemente, em FASES, com commit por fase.
> Projeto: `lizzie-apps` (Vite + JS puro + Supabase, PWA). Trabalhe numa branch: `git checkout -b feat-fidelidade`.
> ⚠️ Mexe no fluxo de VENDA que as revendedoras já usam em produção. Teste local antes de merge/push.

---

## 1. OBJETIVO

Substituir a cartelinha de papel por um programa de fidelidade automático, e disparar a garantia da compra por WhatsApp para a cliente final.

**Hoje:** a revendedora entrega uma cartelinha; a cada compra ≥ R$150 marca um X; com 10 X a cliente ganha R$300 em peças para retirar na loja da Lizzie.

**Queremos:** tudo automático no app, no momento em que a revendedora finaliza a venda.

---

## 2. REGRAS DE NEGÓCIO (definidas pelo dono — seguir à risca)

### 2.1 Selos
- **1 selo a cada R$150 cheios** do valor total da venda: `selos = floor(valor_total / 150)`.
  - R$150 → 1 selo · R$449 → 2 selos · R$450 → 3 selos · R$149 → 0 selos.
- Ao a cartela atingir **10 selos**: a cliente **conquista o benefício** (R$300 em peças, retirada na loja da Lizzie) e a cartela **zera**, começando uma cartela nova.
  - Implementar com a constante `EXCEDENTE_ACUMULA = false` (excedente é descartado, conforme regra atual). Deixar isolado para permitir mudar depois sem refatorar.
- Os selos são da **CLIENTE FINAL**, não da revendedora. A mesma cliente pode comprar com várias revendedoras e os selos **somam na mesma cartela**.

### 2.2 Identificação da cliente
- O **telefone (WhatsApp) é obrigatório** na venda e é a **chave única** da cliente.
- Normalizar o telefone (só dígitos, com DDI 55 + DDD) para não duplicar cadastro.

### 2.3 Quem pode consultar a fidelidade
- **Revendedora**: pode consultar a fidelidade **apenas das clientes para quem ela já vendeu**. (Se a cliente comprou com 3 revendedoras, as 3 conseguem consultar.)
- **Staff/gestor/admin**: vê tudo e faz o **resgate** do prêmio quando a cliente retira as peças na loja.

### 2.4 Avisos automáticos ao finalizar a venda
1. **Aviso de selo**: mensagem à cliente informando os selos ganhos e o progresso ("Você tem 7 de 10 selos").
2. **Prêmio conquistado**: quando fecha 10, mensagem avisando do benefício de R$300 e como retirar.
3. **Garantia**: enviar a **imagem de garantia** preenchida com os dados da(s) peça(s) compradas.

---

## 3. MODELO DE DADOS (novo arquivo `fidelidade-schema.sql`)

Seguir o padrão do projeto: SQL idempotente, RLS com os helpers já existentes (`is_staff()`, `is_gestor()`, `is_admin()` — ver `RLS-policies.sql`).

```sql
-- CLIENTES FINAIS (chave = telefone normalizado)
create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  telefone   text not null,               -- normalizado: 55DDDNNNNNNNNN
  nome       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clientes_telefone_uniq on public.clientes (telefone);

-- Vínculo da venda com a cliente (mantém nome_cliente legado)
alter table public.vendas add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
create index if not exists vendas_cliente_idx on public.vendas (cliente_id);

-- CARTELAS (uma aberta por cliente)
create table if not exists public.fidelidade_cartelas (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  numero        integer not null default 1,
  selos         integer not null default 0,     -- 0..10
  status        text not null default 'aberta', -- 'aberta' | 'completa'
  completada_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists cartela_uma_aberta
  on public.fidelidade_cartelas (cliente_id) where status = 'aberta';

-- SELOS por venda (auditoria + idempotência)
create table if not exists public.fidelidade_selos (
  id             uuid primary key default gen_random_uuid(),
  cartela_id     uuid not null references public.fidelidade_cartelas(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  venda_id       uuid not null references public.vendas(id) on delete cascade,
  revendedora_id uuid references public.profiles(id) on delete set null,
  quantidade     integer not null,
  valor_venda    numeric(12,2) not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists selos_venda_uniq on public.fidelidade_selos (venda_id);

-- PRÊMIOS (R$300 em peças)
create table if not exists public.fidelidade_premios (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  cartela_id   uuid not null references public.fidelidade_cartelas(id) on delete cascade,
  valor        numeric(12,2) not null default 300,
  status       text not null default 'disponivel', -- 'disponivel' | 'resgatado'
  gerado_at    timestamptz not null default now(),
  resgatado_at timestamptz,
  resgatado_por uuid references public.profiles(id)
);
```

### RLS
- `clientes`, `fidelidade_cartelas`, `fidelidade_selos`, `fidelidade_premios`:
  - **SELECT**: `public.is_staff()` **OU** existe venda da revendedora logada para aquela cliente:
    ```sql
    exists (select 1 from public.vendas v
            where v.cliente_id = <tabela>.cliente_id and v.revendedora_id = auth.uid())
    ```
    (para `clientes`, comparar `v.cliente_id = clientes.id`)
  - **INSERT/UPDATE**: cliente pode ser criado pela revendedora ao vender (`authenticated`); cartelas/selos/prêmios são escritos pelo **trigger/RPC** (SECURITY DEFINER) — não liberar escrita direta ao front.
  - **Resgate de prêmio (update status)**: só `is_gestor()`.

---

## 4. LÓGICA DOS SELOS (trigger no banco — à prova de falha)

Fazer no Postgres, não no front, para ser atômico e nunca "esquecer".

Criar `public.aplicar_fidelidade()` como **trigger AFTER INSERT on vendas**:
1. Se `new.cliente_id is null` → não faz nada.
2. `v_selos := floor(new.valor_total / 150)`; se 0 → não faz nada.
3. Pega (ou cria) a **cartela aberta** da cliente.
4. Registra em `fidelidade_selos` (idempotente pelo índice único de `venda_id`).
5. `novo_total := cartela.selos + v_selos`.
   - Se `novo_total >= 10`: marca cartela `completa` (`selos = 10`, `completada_at = now()`), cria `fidelidade_premios` (R$300, `disponivel`) e abre **nova cartela** com `selos = 0` e `numero = anterior + 1`. *(EXCEDENTE_ACUMULA = false → excedente descartado.)*
   - Senão: `update cartela set selos = novo_total`.
6. `SECURITY DEFINER` + `search_path = public`.

> Também criar uma função de leitura `public.fidelidade_status(p_cliente_id uuid)` retornando: selos atuais, número da cartela, prêmios disponíveis e histórico resumido — para a tela de consulta.

---

## 5. TELAS

### 5.1 Venda (revendedora) — `src/consignados.js` (fluxo de finalizar venda)

**Ordem dos campos (importante):** o **TELEFONE é o PRIMEIRO campo** da tela de dados da cliente, antes do nome. Ele é a chave única e o gatilho do autocomplete.

- Campo **Telefone da cliente (obrigatório)**, com máscara BR `(00) 00000-0000` e validação (10–11 dígitos + DDD). Normalizar para `55DDDNNNNNNNNN` ao gravar.
- **Autocomplete ao digitar o telefone** (a mesma cliente compra várias vezes ao longo do LTV — não pode ter que redigitar tudo):
  - Ao completar os dígitos, com **debounce de ~400ms**, buscar a cliente pelo telefone.
  - **Se encontrar**: preencher o **nome** automaticamente e mostrar um selo discreto tipo *"Cliente já cadastrada · 7/10 selos"*. O nome continua **editável** (se a revendedora corrigir, o cadastro é atualizado no save).
  - **Se não encontrar**: manter o nome vazio e indicar *"Nova cliente"*.
  - Enquanto busca, mostrar um estado de carregando discreto no campo.
- **Como buscar sem furar a RLS** — atenção: a policy só deixa a revendedora ver clientes para quem ela já vendeu, mas o autocomplete precisa achar também cliente que comprou com **outra** revendedora. Portanto **NÃO** fazer `select` direto na tabela. Criar uma RPC restrita:
  ```sql
  -- Busca EXATA por telefone (não lista, não faz busca parcial).
  -- Devolve só o mínimo necessário para o autocomplete do PDV.
  create or replace function public.buscar_cliente_por_telefone(p_telefone text)
  returns table (id uuid, nome text, selos integer, cartela_numero integer)
  language sql stable security definer set search_path = public as $$
    select c.id, c.nome,
           coalesce(f.selos, 0), coalesce(f.numero, 1)
    from public.clientes c
    left join public.fidelidade_cartelas f
      on f.cliente_id = c.id and f.status = 'aberta'
    where c.telefone = p_telefone
    limit 1;
  $$;
  revoke all on function public.buscar_cliente_por_telefone(text) from public;
  grant execute on function public.buscar_cliente_por_telefone(text) to authenticated;
  ```
  Só faz **match exato** do telefone completo (quem não souber o número não descobre nada) e devolve apenas nome + progresso da cartela. Sem listagem, sem busca parcial.
- Mostrar o progresso da cartela já **antes** de fechar a venda é proposital: ajuda a revendedora a incentivar ("faltam 2 selos para você ganhar R$300").
- Ao finalizar: **upsert** em `clientes` por telefone (atualiza nome se mudou) → salvar `cliente_id` na venda.
- Após gravar, mostrar um resumo: "Cliente ganhou **2 selos** · agora tem **7/10**" e, se completou, destacar "🎉 Cartela completa — R$300 em peças!". (sem emoji se o padrão do app for sem emoji — seguir `PROMPT-LAYOUT.md`, usar ícones de linha)
- Disparar os envios de WhatsApp (seção 6).

### 5.2 Consulta de Fidelidade (revendedora) — novo `src/fidelidade.js` + painel
- Novo painel `panel-fidelidade` + item na navegação (visível para revendedora e staff).
- Busca por **telefone ou nome**; lista as clientes que a revendedora pode ver (RLS já garante).
- Detalhe da cliente: cartela atual com **10 casinhas** (selos preenchidos vs vazios, visual de cartelinha), total de compras, prêmios disponíveis/resgatados e histórico de selos (data, valor, revendedora).

### 5.3 Staff — resgate do prêmio
- Na área de gestão, listar **prêmios disponíveis** (cliente, telefone, data, valor) com botão **"Marcar como resgatado"** (só gestor). Registrar `resgatado_at` e `resgatado_por`.

---

## 6. WHATSAPP (adaptador trocável + fallback grátis)

**Não acoplar a um provedor.** Criar Edge Function `supabase/functions/whatsapp-enviar/index.ts` com adaptador escolhido por env `WHATSAPP_PROVIDER`:
- `meta` → WhatsApp Cloud API oficial (usa templates aprovados; envs: `META_TOKEN`, `META_PHONE_ID`).
- `zapi` → Z-API/Evolution (envs: `ZAPI_URL`, `ZAPI_TOKEN`).
- `none` (**padrão**) → **não envia**; devolve `{ waLink }` com `https://wa.me/<telefone>?text=<mensagem>` para o app abrir e a revendedora só apertar enviar.

Interface única:
```ts
POST /whatsapp-enviar
{ telefone, mensagem, imagemUrl? }
→ { enviado: boolean, waLink?: string, erro?: string }
```
Adicionar em `supabase/config.toml`:
```toml
[functions.whatsapp-enviar]
verify_jwt = false
```

No front, um helper `enviarWhatsApp({telefone, mensagem, imagemUrl})` que: chama a função; se voltar `waLink`, abre `window.open(waLink)`.

> **Custos:** verificar preços atuais antes de contratar (Meta cobra por conversa/utility; Z-API cobra mensalidade). Começar com `none` (grátis) e migrar depois só trocando a env — nenhum código muda.

### Mensagens (textos base, ajustáveis)
- **Selo:** "Oi {nome}! Sua compra de {valor} na Lizzie Semijoias rendeu {n} selo(s). Você já tem {selos}/10 na sua cartela. Faltam {faltam} para ganhar R$300 em peças!"
- **Prêmio:** "Parabéns, {nome}! Você completou a cartela e ganhou **R$300 em peças** para retirar na loja da Lizzie. Fale com sua consultora para combinar."
- **Garantia:** enviar a imagem + legenda curta com a validade.

---

## 7. IMAGEM DE GARANTIA (preencher o modelo do dono)

1. Subir o modelo (PNG/JPG do dono) no Storage: bucket `lizzie-fotos`, caminho `templates/garantia.png`.
2. Gerar a imagem **no navegador com Canvas** (sem dependência nova):
   - carregar o template, desenhar por cima: **nome da cliente**, **data da compra**, **lista de peças** (descrição + código), **prazo/validade da garantia**.
   - exportar `toBlob('image/png')` → upload em `garantias/{venda_id}.png` no `lizzie-fotos` → pegar `publicUrl`.
3. **Posições configuráveis**: criar `src/garantia-template.js` exportando um objeto com coordenadas/fontes de cada campo, ex.:
   ```js
   export const GARANTIA_LAYOUT = {
     largura: 1080, altura: 1350,
     cliente:  { x: 80,  y: 420, font: 'bold 42px DM Sans', cor: '#1a0a2e' },
     data:     { x: 80,  y: 480, font: '32px DM Sans', cor: '#5a4a60' },
     pecas:    { x: 80,  y: 560, font: '30px DM Sans', cor: '#1a0a2e', lineHeight: 40, maxLinhas: 8 },
     validade: { x: 80,  y: 980, font: 'bold 34px DM Sans', cor: '#c9748a' },
   };
   ```
   Assim o dono ajusta a posição sem mexer na lógica.
4. Enviar via `enviarWhatsApp({ telefone, mensagem, imagemUrl })`.
5. Se der erro na geração/envio, **a venda NÃO pode falhar** — registrar o erro e oferecer botão "reenviar garantia" no detalhe da venda.

---

## 8. FASES DE ENTREGA (1 commit por fase, testando entre elas)

1. **Banco**: `fidelidade-schema.sql` + trigger + RLS. Rodar no Supabase e conferir.
2. **Venda com cliente**: telefone obrigatório + upsert de `clientes` + `cliente_id` na venda. (Selos já passam a contar pelo trigger.)
3. **Tela de consulta de fidelidade** (revendedora) + visual da cartelinha.
4. **Staff**: lista de prêmios + resgate.
5. **WhatsApp**: Edge Function com adaptador + modo `none` (wa.me) + mensagens de selo/prêmio.
6. **Garantia em imagem**: canvas + template + envio + botão de reenvio.

---

## 9. CUIDADOS / RISCOS (tratar no plano)

- **Não quebrar a venda existente**: o fluxo atual funciona em produção; telefone obrigatório muda o formulário — validar bem e manter `nome_cliente` legado preenchido.
- **Vendas antigas** não têm `cliente_id` → não geram selos retroativos (documentar; se o dono quiser retroativo, é um script à parte).
- **Idempotência**: índice único em `fidelidade_selos.venda_id` evita selo duplicado se a venda for reprocessada.
- **Venda excluída/editada**: definir o que acontece com os selos (sugestão: `on delete cascade` já remove; alterações de valor NÃO recalculam — documentar).
- **Telefone duplicado com nome diferente**: o telefone manda; atualizar o nome no cadastro e avisar na tela.
- **Privacidade**: revendedora só enxerga clientes dela (RLS). Não expor telefone de cliente de outra revendedora.
- **LGPD**: é dado pessoal — enviar mensagem só relacionada à compra (utility), sem marketing sem consentimento.

---

## 10. TESTES (fazer antes do merge)

1. Venda de R$149 → 0 selos. R$150 → 1. R$450 → 3.
2. Cliente com 9 selos + venda de R$450 → cartela completa, prêmio R$300 criado, **nova cartela em 0**.
3. Mesma cliente (mesmo telefone) comprando com **duas revendedoras** → selos somam na mesma cartela; ambas conseguem consultar.
4. Revendedora **não** consegue ver cliente com quem nunca vendeu.
5. Modo `none`: ao finalizar a venda abre o wa.me com a mensagem certa e a imagem gerada no storage.
6. Falha no WhatsApp não impede a venda de ser gravada.
7. Staff resgata o prêmio → status vira `resgatado` com data e responsável.
8. **Autocomplete**: digitar o telefone de uma cliente já existente preenche o nome sozinho e mostra o progresso da cartela; telefone novo mostra "Nova cliente" e deixa o nome vazio.
9. **Autocomplete entre revendedoras**: cliente cadastrada por OUTRA revendedora também é encontrada pelo telefone exato (via RPC), mas a revendedora continua **sem** conseguir listar/ver clientes com quem nunca vendeu.
10. Corrigir o nome no autocomplete e salvar → o cadastro da cliente é atualizado (telefone continua sendo a chave).
