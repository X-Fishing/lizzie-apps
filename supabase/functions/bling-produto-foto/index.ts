// Edge Function: bling-produto-foto
// Dado ?sku=CODIGO, acha o produto no Bling (v3) por codigo, baixa a imagem
// principal e sobe no bucket lizzie-fotos; devolve { publicUrl }.
// Reaproveita o padrão de auth/refresh da bling-produtos (tabela bling_tokens id=1).
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
