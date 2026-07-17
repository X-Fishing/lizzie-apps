# PROMPT — Corrigir "revendedora sem maleta" (backfill + anexar maleta nos caminhos legados)

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> Causa: catálogos existentes (importados do Bling ou criados fora do Lançador) ficam com `consignados.maleta_id = NULL` e sem linha em `maletas`. Por isso o Lançador diz "sem maletas em aberto".
> Objetivo: (A) backfill imediato no banco; (B) garantir que TODO caminho que cria peças ativas para uma revendedora anexe/crie a maleta ativa.

## PARTE A — Backfill no Supabase (rodar 1x no SQL Editor)
Cria/vincula a maleta ATIVA para toda revendedora que tem peças ativas sem maleta. Seguro e idempotente (respeita o índice de "1 ativa"):

```sql
do $$
declare r record; m uuid;
begin
  for r in select distinct revendedora_id from public.consignados
           where status = 'ativo' and maleta_id is null loop
    select id into m from public.maletas
      where revendedora_id = r.revendedora_id and status = 'ativa' limit 1;
    if m is null then
      insert into public.maletas (revendedora_id, status, numero)
        values (r.revendedora_id, 'ativa', 1) returning id into m;
    end if;
    update public.consignados set maleta_id = m
      where revendedora_id = r.revendedora_id and status = 'ativo' and maleta_id is null;
  end loop;
end $$;
```
Depois de rodar, o diagnóstico abaixo deve voltar **0 linhas**:
```sql
select count(*) from public.consignados where status='ativo' and maleta_id is null;
```

## PARTE B — Código: anexar/criar maleta ativa nos caminhos legados
Enquanto ainda se importa do Bling, todo insert de `consignados` ativo para uma revendedora precisa ter `maleta_id`. Crie um helper e use nos pontos abaixo.

### B1. Helper (em `src/consignados.js`, exportado)
```js
// Garante que a revendedora tenha uma maleta ATIVA e devolve o id.
// Usa a existente; se não houver, cria. (Só gestor/staff insere — respeita RLS.)
export async function garantirMaletaAtiva(revId) {
  const { data } = await sbQ(sb.from('maletas').select('id').eq('revendedora_id', revId).eq('status', 'ativa').limit(1));
  if (data && data.length) return data[0].id;
  const { data: nova, error } = await sb.from('maletas').insert({ revendedora_id: revId, status: 'ativa', numero: 1 }).select('id').single();
  if (error) { console.error('garantirMaletaAtiva', error); return null; }
  return nova?.id || null;
}
```
Exponha no `window` em `src/main.js` se algum outro módulo precisar chamar via handler.

### B2. Importação do Bling (`src/bling.js` → `importarItensBling`)
Antes do `insert` em `consignados`, obtenha a maleta ativa e inclua `maleta_id` em cada linha:
```js
import { garantirMaletaAtiva } from './consignados.js';
// ...
const maletaId = await garantirMaletaAtiva(revId);
const { error } = await sb.from('consignados').insert(
  itens.map(it => ({ /* ...campos atuais... */, maleta_id: maletaId }))
);
```

### B3. Novo consignado manual (`src/consignados.js` → `salvarConsignado`)
No `insert`, incluir `maleta_id: await garantirMaletaAtiva(revId)`.

### B4. Sincronização de maleta (RPC `sincronizar_maleta` em `db-functions.sql`)
A função insere em `consignados` sem `maleta_id`. Ajustar para vincular à maleta ativa da revendedora (criando se não existir), e **rodar o `db-functions.sql` atualizado no Supabase**. No corpo, antes do loop, resolver a maleta ativa:
```sql
-- dentro de sincronizar_maleta, após validar is_gestor():
declare v_maleta uuid;
-- ...
select id into v_maleta from maletas where revendedora_id = p_revendedora_id and status = 'ativa' limit 1;
if v_maleta is null then
  insert into maletas (revendedora_id, status, numero) values (p_revendedora_id, 'ativa', 1) returning id into v_maleta;
end if;
```
E no `insert into consignados (...)` da função, acrescentar a coluna `maleta_id` com valor `v_maleta`.

### B5. Lançador resiliente (opcional, defensivo) — `src/lancador.js`
Em `lancadorSelecionarRev`, se `maletasAbertas` vier vazio mas a revendedora tiver peças ativas, dá para chamar `garantirMaletaAtiva(revId)` e recarregar — mas com o backfill (Parte A) + B2/B4 isso não deve mais acontecer. Deixe apenas se for trivial.

## Validar / commitar / publicar
```bash
npm run lint
npm run build
git add -A
git commit -m "fix(maletas): backfill de maletas e anexo de maleta_id nos caminhos legados (bling/novo/sincronizar)"
git push origin main
```
E rode no Supabase de produção: (1) o backfill da Parte A; (2) o `db-functions.sql` atualizado (B4).

## Teste
- Rodar o diagnóstico → 0 peças ativas sem maleta.
- No Lançador, escolher uma revendedora que já tem catálogo → aparece **"Continuar Ativa #1"** (não mais "sem maletas em aberto").
- Importar um pedido do Bling para uma revendedora → as peças entram vinculadas à maleta ativa; o Lançador reconhece.
