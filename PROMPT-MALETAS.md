# PROMPT — Conceito de "Maleta" com regras (limite 2, ativa/aguardando/finalizada) + colunas

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> ⚠️ Mudança ESTRUTURAL: mexe no banco, no Lançador, no app da revendedora (catálogo) e no fechamento.
> **Trabalhe numa branch** (`git checkout -b feat-maletas`), **teste local** com `npm run dev` e só faça merge/push depois de validar. Faça commits por etapa.

## Conceito e regras (decisões do dono)
Hoje as peças ficam soltas em `consignados` (status `ativo`, marcadas por `pedido_numero`), sem uma entidade "maleta". Vamos criar a **maleta** como agrupamento com status:
- **ativa** — a que está COM a revendedora (no máximo 1 por revendedora).
- **aguardando** — já montada, esperando a troca.
- **finalizada** — encerrada (NÃO conta no limite).

Regras:
1. Uma revendedora pode ter no **máximo 2 maletas em aberto** (ativa + aguardando). Finalizadas não contam.
2. No máximo **1 ativa** por revendedora.
3. No **Lançador**, após escolher a revendedora: botões **"Continuar maleta"** (adiciona a uma maleta em aberto) e **"Nova maleta"** (cria; bloqueada se já houver 2 em aberto). Se houver 2 em aberto e o usuário escolher "Continuar", perguntar em qual (ativa ou aguardando).
4. **App da revendedora**: o catálogo mostra **apenas a maleta ativa** dela.
5. **Fechamento**: ao finalizar o catálogo da revendedora, a maleta **ativa** vira **finalizada**; se existir uma **aguardando**, ela passa a **ativa** (a troca).

---

## ETAPA 1 — Banco (novo arquivo `maletas-schema.sql`, rodar no Supabase)
Crie o arquivo `maletas-schema.sql` na raiz com o conteúdo abaixo e rode no Supabase (SQL Editor). Idempotente.

```sql
-- Maletas (agrupamento de consignados por revendedora) + regras
create table if not exists public.maletas (
  id             uuid primary key default gen_random_uuid(),
  revendedora_id uuid not null references public.profiles(id) on delete cascade,
  numero         integer,
  status         text not null default 'ativa',  -- 'ativa' | 'aguardando' | 'finalizada'
  created_at     timestamptz not null default now(),
  finalizada_at  timestamptz
);
create index if not exists maletas_rev_status_idx on public.maletas (revendedora_id, status);
-- no máximo 1 ativa por revendedora
create unique index if not exists maletas_uma_ativa
  on public.maletas (revendedora_id) where status = 'ativa';

-- vínculo da peça à maleta
alter table public.consignados
  add column if not exists maleta_id uuid references public.maletas(id) on delete set null;

-- limite de 2 em aberto (ativa+aguardando) por revendedora
create or replace function public.guard_max_maletas()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status in ('ativa','aguardando') then
    select count(*) into n from public.maletas
      where revendedora_id = new.revendedora_id
        and status in ('ativa','aguardando')
        and id <> new.id;
    if n >= 2 then
      raise exception 'Revendedora já tem 2 maletas em aberto (limite atingido).';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_max_maletas_trg on public.maletas;
create trigger guard_max_maletas_trg before insert or update on public.maletas
  for each row execute function public.guard_max_maletas();

-- MIGRAÇÃO: envolve os consignados 'ativo' atuais (sem maleta) numa maleta ativa por revendedora
do $$
declare r record; m uuid;
begin
  for r in select distinct revendedora_id from public.consignados
           where status = 'ativo' and maleta_id is null loop
    insert into public.maletas (revendedora_id, status, numero)
      values (r.revendedora_id, 'ativa', 1) returning id into m;
    update public.consignados set maleta_id = m
      where revendedora_id = r.revendedora_id and status = 'ativo' and maleta_id is null;
  end loop;
end $$;

-- RLS
alter table public.maletas enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='maletas' loop
    execute format('drop policy if exists %I on public.maletas', r.policyname);
  end loop; end $$;
create policy maletas_select on public.maletas for select to authenticated
  using ( revendedora_id = auth.uid() or public.is_staff() );
create policy maletas_insert on public.maletas for insert to authenticated
  with check ( public.is_gestor() );
create policy maletas_update on public.maletas for update to authenticated
  using ( public.is_gestor() ) with check ( public.is_gestor() );
create policy maletas_delete on public.maletas for delete to authenticated
  using ( public.is_gestor() );
```

---

## ETAPA 2 — Lançador (`src/lancador.js`)
1. **Colunas da tabela** do carrinho: deixar **Descrição · Código · Quantidade · Preço un · Preço total** + botão remover. (Hoje tem Peça/Qtd/Subtotal — renomear "Subtotal" para "Preço total", adicionar coluna "Código" com o `referencia`/SKU, e "Preço un" separado. Tirar nada além disso.)
2. **Fluxo de maleta** após escolher a revendedora (`#lan-rev`):
   - Ao selecionar a revendedora, consultar as maletas dela em aberto: `select id,status,numero,created_at from maletas where revendedora_id = :id and status in ('ativa','aguardando') order by created_at`.
   - Mostrar um resumo ("Ela tem X maleta(s) em aberto") e dois botões:
     - **Continuar maleta**: se houver 1 em aberto, usa ela; se houver 2, abrir um seletor (ativa / aguardando) para escolher.
     - **Nova maleta**: se já houver 2 em aberto, **desabilitar** com aviso "Limite de 2 maletas atingido". Senão, ao enviar, criar a maleta: `status = (tem ativa ? 'aguardando' : 'ativa')`.
   - Guardar em estado a `maletaDestino` escolhida (id existente) ou a flag "criar nova".
3. **Enviar** (`lancadorEnviar`):
   - Se "nova maleta": primeiro `insert into maletas (...) returning id` (respeitando o status acima); tratar erro do trigger (limite) com toast claro.
   - Inserir os `consignados` com `maleta_id` = destino e `produto_id` (como já faz), `status:'ativo'`.
4. Bloquear envio se nenhuma maleta de destino estiver definida.

## ETAPA 3 — App da revendedora (catálogo) — `src/consignados.js`
- Onde o catálogo/ciclo da revendedora carrega os `consignados` ativos dela, **restringir à maleta ativa**: somente peças cujo `maleta_id` pertence à maleta com `status='ativa'` daquela revendedora.
  - Ex.: buscar antes `select id from maletas where revendedora_id = :me and status='ativa'` e filtrar `consignados.maleta_id = :ativaId` (ou `.in('maleta_id', [...])`).
- O lado staff/admin pode continuar vendo todas as maletas (não restringir para staff).
- Compatibilidade: após a migração da Etapa 1, todas as peças ativas já têm `maleta_id` numa maleta ativa, então nada some.

## ETAPA 4 — Fechamento — `src/consignados.js`
- No fluxo de **fechamento do catálogo** (finalizar), além do que já faz hoje:
  1. `update maletas set status='finalizada', finalizada_at=now() where id = :maletaAtivaId`.
  2. Se existir maleta `aguardando` da mesma revendedora: `update maletas set status='ativa' where id = :aguardandoId` (a troca). Como há índice único de 1 ativa, isso só roda após a anterior virar finalizada.
- Garantir que isso rode dentro do mesmo fluxo, com tratamento de erro.

## ETAPA 5 — Validar / commitar
```bash
npm run lint
npm run build
git add -A
git commit -m "feat(maletas): entidade maleta com regras (limite 2, ativa/aguardando/finalizada), lancador e fechamento"
```
Teste local TODO o fluxo antes de merge/push (ver abaixo). Só então:
```bash
git checkout main && git merge feat-maletas && git push origin main
```
E rode `maletas-schema.sql` no Supabase de produção ANTES de o deploy ir pro ar.

## Teste (npm run dev)
1. Revendedora sem maleta: Lançador → "Nova maleta" cria uma **ativa**; peças aparecem no catálogo dela.
2. Mesma revendedora: criar **outra** maleta (vira **aguardando**); a revendedora continua vendo só a **ativa**.
3. Tentar criar a **3ª** → bloqueado (botão desabilitado e/ou erro do trigger).
4. "Continuar maleta" com 2 abertas → pede para escolher ativa/aguardando e adiciona certo.
5. Fechar o catálogo (maleta ativa) → ativa vira **finalizada** e a **aguardando** vira **ativa**; agora ela pode ter mais 1 em aberto.
6. Colunas do lançador: Descrição · Código · Quantidade · Preço un · Preço total · remover.
```
```
