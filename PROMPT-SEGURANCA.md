# PROMPT-SEGURANCA.md — Correções de controle de acesso (financeiro)

> **Para o agente do VS Code (Claude/Copilot):** aplique as correções abaixo **na ordem**. Cada uma tem contexto, o problema real, e o passo a passo. Crie **uma nova migração** `supabase/migrations/0012_seguranca_financeiro.sql` (não edite migrações já rodadas — elas são histórico) e ajuste os módulos JS indicados. **Rode a migração no SQL Editor do Supabase** (ou via `supabase db push`) depois de revisar. Tudo é **idempotente**.
>
> Origem: auditoria de segurança (subagent `security-reviewer`). Prioridade: **1 = ALTO**, **2 e 3 = MÉDIO**.
>
> **Não** invente nomes de coluna/função: os que aparecem aqui foram conferidos contra o schema atual (`RLS-policies.sql`, `0008`, `0009`, `0011`) e `src/financeiro.js`.

---

## Contexto do modelo de autorização (leia antes)

Existem **dois** sistemas paralelos — não confunda:

| Sistema | Alimenta | Onde vale |
|---|---|---|
| `profiles.role` (`revendedora`/`func_basico`/`func_completo`/`admin`) | `is_staff()`, `is_gestor()`, `is_admin()` | **RLS real no banco** |
| `funcionarios` + `perfil_permissoes` + `fn_minhas_permissoes()`/`fn_is_admin()` | `PERMISSOES`, `IS_ADMIN` (menu.js) | **Só o menu/UI no front** |

A raiz do problema ALTO é essa divergência: a UI restringe por chave granular (`acao_estornar_recebimento`), mas o RLS libera qualquer `is_gestor()`. A correção move a checagem granular **para dentro do banco** via RPC.

---

## CORREÇÃO 1 — [ALTO] Estorno com checagem granular no banco (RPC SECURITY DEFINER)

### Problema
Hoje o estorno é um `UPDATE` direto na `financeiro_lancamentos` (`src/financeiro.js` → `estornarConfirmar`, linhas ~403-408). A policy `flan_write` (migração 0009, linha 58) é `for all using (is_gestor())` — ou seja, **qualquer `func_completo`/`admin`** pode estornar via API, mesmo sem a permissão `acao_estornar_recebimento` que a UI usa para esconder o botão. Pior: o campo de auditoria `estornado_por` vem de `state.currentUser.id` (cliente), então dá para **forjar o autor**.

### Objetivo
- Checagem da permissão granular **no servidor** (admin OU quem tem a chave `acao_estornar_recebimento`).
- `estornado_por` carimbado com `auth.uid()` **no banco** (não confiar no cliente).
- Toda a lógica de "devolver o valor à pendência do fechamento" feita **atomicamente** na RPC (hoje são 2-3 round-trips no cliente que podem falhar no meio).
- Restringir o `UPDATE`/estorno direto pela API para não-admins.

### Passo 1.1 — SQL: RPC de estorno (adicione em `0012_seguranca_financeiro.sql`)

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 0012 — Segurança do financeiro (estorno granular + teste + PIX admin)
-- Idempotente. Rodar no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════

-- ── Helper: o usuário atual tem uma chave de permissão? (staff granular)
-- Reusa fn_minhas_permissoes()/fn_is_admin() já existentes (migração 0011).
create or replace function public.tem_permissao(p_chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.fn_is_admin()
      or exists (select 1 from public.fn_minhas_permissoes() where chave_menu = p_chave);
$$;
revoke all on function public.tem_permissao(text) from public;
grant execute on function public.tem_permissao(text) to authenticated;

-- ── RPC de estorno: checa permissão granular, carimba autor no servidor,
--    marca o lançamento e devolve o valor à pendência do fechamento.
create or replace function public.estornar_recebimento(p_lanc_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lanc  public.financeiro_lancamentos%rowtype;
  v_pend  public.financeiro_lancamentos%rowtype;
begin
  -- 1) autorização no banco (não confia na UI)
  if not public.tem_permissao('acao_estornar_recebimento') then
    raise exception 'Sem permissao para estornar recebimento' using errcode = '42501';
  end if;

  -- 2) trava a linha e valida estado
  select * into v_lanc from public.financeiro_lancamentos
    where id = p_lanc_id for update;
  if not found then raise exception 'Lancamento nao encontrado'; end if;
  if v_lanc.tipo <> 'receber' or v_lanc.pago is not true or v_lanc.estornado is true then
    raise exception 'Lancamento nao pode ser estornado (nao pago ou ja estornado)';
  end if;

  -- 3) marca o estorno — autor = auth.uid() (servidor), nunca o cliente
  update public.financeiro_lancamentos set
    estornado = true,
    pago = false,
    estornado_em = now(),
    estornado_por = auth.uid(),
    estorno_motivo = p_motivo
  where id = p_lanc_id;

  -- 4) devolve o valor à pendência do mesmo fechamento (soma numa aberta ou cria)
  if v_lanc.fechamento_id is not null then
    select * into v_pend from public.financeiro_lancamentos
      where fechamento_id = v_lanc.fechamento_id and pago = false and estornado = false
      order by created_at limit 1 for update;
    if found then
      update public.financeiro_lancamentos
        set valor = round((v_pend.valor + v_lanc.valor)::numeric, 2)
        where id = v_pend.id;
    else
      insert into public.financeiro_lancamentos
        (tipo, descricao, pessoa_id, pessoa_nome, categoria, origem,
         fechamento_id, maleta_ref, valor, pago, vencimento, forma_pagamento)
      values
        (v_lanc.tipo, v_lanc.descricao, v_lanc.pessoa_id, v_lanc.pessoa_nome,
         v_lanc.categoria, v_lanc.origem, v_lanc.fechamento_id, v_lanc.maleta_ref,
         v_lanc.valor, false, (now() + interval '15 days')::date, null);
    end if;
  end if;
end;
$$;
revoke all on function public.estornar_recebimento(uuid, text) from public;
grant execute on function public.estornar_recebimento(uuid, text) to authenticated;
```

> **Nota sobre colunas do insert:** o `insert` acima usa só colunas garantidas pela 0009. Se as colunas de referência da 0010 (`numero_interno`, `fechamento_data`) já existirem e você quiser copiá-las para a nova pendência, adicione-as ao `insert`/`values` — são opcionais para o funcionamento do estorno.

### Passo 1.2 — SQL: fechar o estorno direto pela API (opcional, recomendado)

A policy `flan_write` continua permitindo `UPDATE` genérico (usada pelo fluxo de recebimento). Para impedir que um gestor sem a chave granular estorne "na mão" burlando a RPC, adicione um trigger que bloqueia a **transição para estornado** fora da RPC:

```sql
-- Bloqueia marcar estornado=true via UPDATE direto sem a permissao granular.
-- A RPC estornar_recebimento roda como SECURITY DEFINER (owner) e passa livre;
-- um UPDATE do app (SECURITY INVOKER) cai na checagem.
create or replace function public.guard_estorno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estornado is true and old.estornado is distinct from true then
    if not public.tem_permissao('acao_estornar_recebimento') then
      raise exception 'Estorno so via funcao estornar_recebimento' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists guard_estorno_trg on public.financeiro_lancamentos;
create trigger guard_estorno_trg before update on public.financeiro_lancamentos
  for each row execute function public.guard_estorno();
```

> Isso ainda deixa quem TEM a permissão estornar direto, mas sem forjar autor via trigger separado seria mais complexo — o ganho principal (autor no servidor + lógica atômica) vem da RPC. Se quiser travar 100%, mova todo estorno para a RPC e no trigger bloqueie **qualquer** transição para `estornado=true` que não venha da RPC (ex.: usando uma variável de sessão `set local` setada dentro da RPC). Deixe como está salvo se a equipe achar suficiente.

### Passo 1.3 — JS: trocar o UPDATE manual pela RPC em `src/financeiro.js`

Em `estornarConfirmar` (linhas ~397-437), **substitua** todo o corpo que faz o `update` + devolução manual da pendência (passos "1)" e "2)") por **uma chamada à RPC**. A UI-guard `podeEstornar()` pode continuar (esconde o botão), mas a segurança real agora está no banco.

Novo corpo sugerido:

```js
export async function estornarConfirmar(lancId) {
  const l = finLancamentos.find(x => String(x.id) === String(lancId));
  if (!l) return;
  const motivo = document.getElementById('est-motivo')?.value.trim() || null;

  const { error } = await sbQ(sb.rpc('estornar_recebimento', { p_lanc_id: lancId, p_motivo: motivo }));
  if (error) {
    console.error('Estorno:', error);
    const dica = /permissao|42501/i.test(error.message || '') ? ' (sem permissão)' :
                 /estornar_recebimento|function|schema cache/i.test(error.message || '') ? ' Rode a migração 0012.' : '';
    toast(`Erro ao estornar: ${error.message}.${dica}`);
    return;
  }

  closeModal('modal-cadastro');
  toast(`Recebimento de ${fmtBRL(l.valor)} estornado — valor voltou para "A receber".`);
  loadFinanceiro();
}
```

- Remova o `import { state }` se ele passar a não ser mais usado em `financeiro.js` (era usado só para `state.currentUser.id` no estorno — confira antes de remover).
- **Não** altere `estornarRecebimento` (o modal de confirmação) nem `podeEstornar()`.

---

## CORREÇÃO 2 — [MÉDIO] `WITH CHECK` pinando a coluna `teste` em `profiles_update_own`

### Problema
A policy `profiles_update_own` (`RLS-policies.sql`, linhas 78-85) só pina `role` e `aprovada` no `WITH CHECK`. A coluna `profiles.teste` (migração 0008) fica **gravável pela própria revendedora**. Como o isolamento de contas de teste é só no front (`ehRevTeste` filtra o dashboard e trava o lançamento), uma revendedora pode rodar `update({ teste: true })` na própria linha e **sumir do "A receber"** da gestão, escondendo a própria dívida.

### Objetivo
Impedir a revendedora de alterar `teste` (e, de quebra, `bling_id`) na própria linha — só admin/gestor muda isso via `profiles_update_gestor`.

### Passo 2.1 — SQL: recriar a policy (adicione em `0012_seguranca_financeiro.sql`)

```sql
-- ── profiles_update_own: pinar teste e bling_id ao valor atual ────────
-- Revendedora edita só dados próprios (nome/telefone/cidade); nao muda
-- teste/role/aprovada/bling_id na propria linha.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role     = (select role     from public.profiles where id = auth.uid())
    and aprovada = (select aprovada from public.profiles where id = auth.uid())
    and teste    is not distinct from (select teste    from public.profiles where id = auth.uid())
    and bling_id is not distinct from (select bling_id from public.profiles where id = auth.uid())
  );
```

> `is not distinct from` trata `NULL` corretamente (ex.: `bling_id` nulo). Se `bling_id` **não** existir na sua tabela `profiles`, remova as duas linhas de `bling_id`. Confirme com `\d public.profiles` ou pelo painel antes de rodar. A linha de `teste` é a essencial desta correção.
>
> `profiles_update_gestor` (linhas 89-92) continua permitindo gestor/admin alterar qualquer profile — inclusive `teste` — então o fluxo legítimo de marcar conta de teste segue funcionando pela gestão.

### Passo 2.2 — Nenhuma mudança de JS necessária
O front não deveria estar setando `teste` no update da própria revendedora. Se houver algum `sb.from('profiles').update({...teste...})` disparado por revendedora, isso passará a falhar — o que é o comportamento desejado. Faça um grep por `.update(` em cadastros de perfil da revendedora e confirme que nenhum envia `teste`.

---

## CORREÇÃO 3 — [MÉDIO] Chave PIX restrita a `is_admin()` + auditoria

### Problema
`config_pix` (linha única, id=1) guarda a chave PIX que **recebe todos os acertos**. A policy `cpix_write` (migração 0009, linhas 54-55) libera escrita a **qualquer `is_gestor()`**, sem trilha de quem/quando alterou. Um `func_completo` rogue troca a chave por `pixConfigSalvar` (`financeiro.js:475`) e desvia todos os pagamentos, sem rastro.

### Objetivo
- Só **admin** grava a chave PIX.
- Registrar **quem** e **quando** alterou (auditoria).

### Passo 3.1 — SQL: colunas de auditoria + policy admin (em `0012_seguranca_financeiro.sql`)

```sql
-- ── config_pix: auditoria + escrita so admin ─────────────────────────
alter table public.config_pix
  add column if not exists updated_by uuid;

-- Trigger carimba updated_by/updated_at no servidor a cada escrita.
create or replace function public.stamp_config_pix()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists stamp_config_pix_trg on public.config_pix;
create trigger stamp_config_pix_trg before insert or update on public.config_pix
  for each row execute function public.stamp_config_pix();

-- Leitura segue staff; escrita passa a exigir admin.
drop policy if exists cpix_write on public.config_pix;
create policy cpix_write on public.config_pix for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );
```

> `cpix_select` (staff lê) permanece — o front precisa da chave para montar o QR mesmo para gestor/staff comum. Só a **escrita** foi restringida a admin.

### Passo 3.2 — JS: refletir na UI (`src/financeiro.js` + botão de config)

1. Em `loadFinanceiro` (linha ~361), o botão **Config PIX** hoje aparece para `ehGestor()`. Troque para admin, para não mostrar um botão que vai falhar no RLS:
   - Localize a função `ehGestor` usada aqui e verifique se existe um equivalente de admin no módulo (ex.: `IS_ADMIN` já é importado de `menu.js`, linha 8).
   - Substitua a condição do botão de `${ehGestor() ? ...Config PIX... : ''}` por `${IS_ADMIN ? ...Config PIX... : ''}`.
2. Em `pixConfigSalvar` (linha ~481), **remova** `updated_at: new Date().toISOString()` do `upsert` — o trigger agora carimba `updated_at`/`updated_by` no servidor. Deixe só `{ id: 1, chave_pix, nome_recebedor: nome, cidade }`.
3. O tratamento de erro de `pixConfigSalvar` já usa `handleSupabaseError` — se um não-admin tentar salvar, o RLS retorna erro e a UI mostra a mensagem. Opcionalmente melhore a dica: se `error.code === '42501'`/mensagem de permissão, mostrar "Apenas administrador pode alterar a chave PIX."

> **Verifique `IS_ADMIN`:** confirme em `src/menu.js` que `IS_ADMIN` reflete `profiles.role='admin'` (e não só `funcionarios.is_admin`). Se `IS_ADMIN` vier de `fn_is_admin()` (perfil de funcionário) e **não** de `profiles.role`, então a UI e o RLS podem divergir de novo: o botão apareceria para um "admin de funcionário" que não é admin no `profiles`, e o save falharia. Se for esse o caso, alinhe — o mais seguro é a UI checar o mesmo critério do RLS (`profiles.role='admin'`). **Sinalize ao usuário se encontrar essa divergência** em vez de mascarar com try/catch.

---

## Ordem de execução e teste

1. Criar `supabase/migrations/0012_seguranca_financeiro.sql` juntando os blocos SQL das 3 correções (helper `tem_permissao` → RPC estorno → trigger guard_estorno → policy `profiles_update_own` → auditoria `config_pix`). Rodar no SQL Editor.
2. Aplicar os ajustes de JS (`estornarConfirmar` via RPC; botão/`pixConfigSalvar` de PIX).
3. **Testes manuais mínimos:**
   - **Estorno:** como `func_completo` **sem** a chave `acao_estornar_recebimento`, tentar `sb.rpc('estornar_recebimento', {...})` → deve dar erro `42501`. Com a chave (ou admin) → estorna e o valor volta para "A receber". Conferir que `estornado_por` = uid do autor real.
   - **Teste:** logada como revendedora, `sb.from('profiles').update({teste:true}).eq('id', <meu_uid>)` → deve **falhar** no RLS.
   - **PIX:** como `func_completo` (não admin), abrir/salvar Config PIX → botão não aparece; se forçar `upsert` via API → erro. Como admin → salva e `updated_by`/`updated_at` preenchidos.
4. Commit sugerido: `fix(seguranca): estorno granular no banco, pin de profiles.teste e PIX so-admin com auditoria`.

## Fora de escopo deste prompt (não fazer agora)
- Correção BAIXO/MÉDIO de `pagamentos.js` (valor_pago/status calculados no cliente).
- `perfil_permissoes` com `SELECT using(true)` (adicionar `to authenticated`).
- Verificar visibilidade do bucket `lizzie-fotos` no Storage.

Se sobrar tempo, peça um PROMPT-SEGURANCA-2 para esses itens.
