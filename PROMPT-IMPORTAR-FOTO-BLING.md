# PROMPT — Botão "Importar foto do Bling" por produto (casando pelo SKU)

> Cole no Copilot/Cursor com a pasta `lizzie-apps` aberta.
> Cria uma Edge Function nova + um botão no formulário de produto. Deploy da função + push. Teste local.
> Objetivo: dentro de cada produto, um botão "Importar foto do Bling". Se o **SKU** bater com o `codigo` de um produto no Bling, importa **a imagem principal** só daquele produto (não em massa).

## Contexto técnico (já existe)
- Bling v3 via OAuth, token em `bling_tokens` (id=1), com refresh — ver `supabase/functions/bling-produtos/index.ts`.
- `bling-produtos` já suporta `?pagina=N` (lista) e `?id=ID` (detalhe, inclui `midia.imagens`).
- Storage: bucket `lizzie-fotos` (já usado em consignados/garantias).
- `src/bling.js` chama funções com `BLING_HEADERS = { apikey, Authorization: Bearer <anon> }` em `${SUPABASE_URL}/functions/v1/<fn>`.

## PARTE 1 — Nova Edge Function `bling-produto-foto`
Crie `supabase/functions/bling-produto-foto/index.ts`. Ela: (1) acha o produto no Bling por `codigo=SKU`; (2) pega o detalhe e extrai o link da imagem principal; (3) baixa e sobe no bucket `lizzie-fotos`; (4) retorna `{ publicUrl }`. Reaproveita o padrão de auth/refresh da `bling-produtos`.

```ts
// Edge Function: bling-produto-foto
// Dado ?sku=CODIGO, acha o produto no Bling (v3) por codigo, baixa a imagem
// principal e sobe no bucket lizzie-fotos; devolve { publicUrl }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BLING_CLIENT_ID = Deno.env.get('BLING_CLIENT_ID') ?? ''
const BLING_CLIENT_SECRET = Deno.env.get('BLING_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function refreshToken(sb: any, token: string) {
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`) },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token })
  })
  if (!res.ok) return null
  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await sb.from('bling_tokens').update({ access_token: data.access_token,
    refresh_token: data.refresh_token, expires_at: expiresAt,
    updated_at: new Date().toISOString() }).eq('id', 1)
  return data.access_token
}

function extrairLink(prod: any): string | null {
  const m = prod?.midia?.imagens
  const cand = (m?.internas?.[0]?.link) || (m?.externas?.[0]?.link) || prod?.imagemURL || null
  return cand || null
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: any, s = 200) => new Response(JSON.stringify(o),
    { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const sku = new URL(req.url).searchParams.get('sku')?.trim()
  if (!sku) return json({ error: 'sku obrigatório' }, 400)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: tk } = await sb.from('bling_tokens').select('*').eq('id', 1).single()
  if (!tk?.access_token) return json({ error: 'Bling não conectado.' }, 401)
  let token = tk.access_token
  if (new Date(tk.expires_at) <= new Date()) {
    token = await refreshToken(sb, tk.refresh_token)
    if (!token) return json({ error: 'Token expirado. Reconecte o Bling.' }, 401)
  }
  const H = { Authorization: `Bearer ${token}` }

  // 1) achar produto por codigo (SKU)
  const busca = await fetch(`https://www.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(sku)}&limite=5`, { headers: H })
  if (!busca.ok) return json({ error: 'Erro Bling (busca): ' + await busca.text() }, 500)
  const lista = await busca.json()
  const achado = (lista?.data || []).find((p: any) => String(p.codigo) === String(sku)) || (lista?.data || [])[0]
  if (!achado?.id) return json({ error: 'SKU não encontrado no Bling: ' + sku }, 404)

  // 2) detalhe -> link da imagem
  const det = await fetch(`https://www.bling.com.br/Api/v3/produtos/${achado.id}`, { headers: H })
  if (!det.ok) return json({ error: 'Erro Bling (detalhe): ' + await det.text() }, 500)
  const prod = (await det.json())?.data
  const link = extrairLink(prod)
  if (!link) return json({ error: 'Produto sem imagem no Bling.' }, 404)

  // 3) baixar imagem
  const img = await fetch(link)
  if (!img.ok) return json({ error: 'Falha ao baixar a imagem do Bling.' }, 500)
  const bytes = new Uint8Array(await img.arrayBuffer())
  const ct = img.headers.get('content-type') || 'image/jpeg'
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
  const path = `produtos/bling-${sku}-${Date.now()}.${ext}`

  // 4) upload no storage
  const up = await sb.storage.from('lizzie-fotos').upload(path, bytes, { contentType: ct, upsert: true })
  if (up.error) return json({ error: 'Falha no upload: ' + up.error.message }, 500)
  const { data: pub } = sb.storage.from('lizzie-fotos').getPublicUrl(path)
  return json({ publicUrl: pub.publicUrl })
})
```

### config.toml
Adicione o portão sem JWT (como as outras funções Bling):
```toml
[functions.bling-produto-foto]
verify_jwt = false
```

### Deploy da função (terminal)
```bash
supabase functions deploy bling-produto-foto
```
(Os secrets BLING_CLIENT_ID/SECRET e SERVICE_ROLE já existem no projeto — a função reaproveita.)

## PARTE 2 — Botão no formulário de produto (`src/produtos.js`)
Na seção **Imagem** do formulário (`abrirForm`), abaixo do `foto-upload`, adicione um botão que só funciona se o produto tiver **SKU**:
```js
// dentro do template, logo após o bloco .foto-upload:
`<button type="button" class="btn-secondary btn-sm" style="margin-top:8px" onclick="produtoImportarFotoBling()">
   ${IC_CAM} Importar foto do Bling (pelo SKU)
 </button>
 <div style="font-size:11px;color:var(--muted);margin-top:4px">Usa o Código (SKU) para achar a peça no Bling e traz a imagem principal.</div>`
```
Handler (exportar e expor no `window` via `main.js`):
```js
export async function produtoImportarFotoBling() {
  const sku = document.getElementById('p-sku').value.trim();
  if (!sku) { toast('Preencha o Código (SKU) primeiro'); return; }
  toast('Buscando foto no Bling...');
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/bling-produto-foto?sku=${encodeURIComponent(sku)}`, { headers: BLING_HEADERS });
    const j = await resp.json();
    if (!resp.ok || !j.publicUrl) { toast(j.error || 'Não foi possível importar a foto'); return; }
    // preenche o preview; o save do produto grava foto_url normalmente
    const prev = document.getElementById('p-foto-preview');
    const ph = document.getElementById('p-foto-placeholder');
    prev.src = j.publicUrl; prev.style.display = 'block'; if (ph) ph.style.display = 'none';
    toast('Foto importada! Clique em Salvar para confirmar.');
  } catch (e) { console.error(e); toast('Erro ao importar foto'); }
}
```
- Importar no topo de `produtos.js`: `import { SUPABASE_URL } from './supabase.js';` e `import { BLING_HEADERS } from './bling.js';` (BLING_HEADERS já é exportado em bling.js).
- No `produtoSalvar`, o `foto_url` já é lido do `p-foto-preview` (src) — então após importar e Salvar, a URL do Bling fica gravada. Confirme que essa lógica existe; se hoje ele só sobe arquivo do input, ajuste para usar o `src` do preview quando não houver arquivo novo (provavelmente já faz).
- Expor `produtoImportarFotoBling` no `Object.assign(window, {...})` do `main.js`.

## Validar / commitar / publicar
```bash
npm run lint
npm run build
git add -A
git commit -m "feat(produtos): importar foto do Bling por SKU (edge function + botao no produto)"
git push origin main
supabase functions deploy bling-produto-foto
```

## Teste
- Produto com SKU que existe no Bling e tem imagem → botão traz a foto pro preview; Salvar grava.
- SKU inexistente no Bling → toast "SKU não encontrado no Bling".
- Produto no Bling sem imagem → toast "Produto sem imagem no Bling".
- Produto sem SKU preenchido → toast pedindo o SKU.
```
```
