// Edge Function: bling-produtos
// Espelha a bling-pedidos (mesma auth OAuth + tabela bling_tokens + refresh).
// Proxy para a API de Produtos do Bling v3.
//   ?pagina=N        -> GET /produtos (lista paginada, limite 100)
//   ?id=IDPRODUTO    -> GET /produtos/{id} (detalhe, inclui midia/imagens)
// Segredos vêm do ambiente (Supabase secrets), não hardcoded:
//   BLING_CLIENT_ID, BLING_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BLING_CLIENT_ID = Deno.env.get('BLING_CLIENT_ID') ?? ''
const BLING_CLIENT_SECRET = Deno.env.get('BLING_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function refreshToken(sb: any, token: string) {
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`)
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token })
  })
  if (!res.ok) return null
  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await sb.from('bling_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  }).eq('id', 1)
  return data.access_token
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: tokenData } = await sb.from('bling_tokens').select('*').eq('id', 1).single()
  if (!tokenData?.access_token) {
    return new Response(JSON.stringify({ error: 'Bling não conectado.' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  let accessToken = tokenData.access_token
  if (new Date(tokenData.expires_at) <= new Date()) {
    accessToken = await refreshToken(sb, tokenData.refresh_token)
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Token expirado. Reconecte o Bling.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const pagina = url.searchParams.get('pagina') || '1'

  // Filtros opcionais repassados ao Bling (whitelist — datas no formato YYYY-MM-DD)
  const REPASSA = ['criterio', 'tipo', 'dataInclusaoInicial', 'dataInclusaoFinal',
                   'dataAlteracaoInicial', 'dataAlteracaoFinal', 'nome', 'idCategoria']
  const qs = new URLSearchParams({ pagina, limite: '100' })
  for (const k of REPASSA) {
    const v = url.searchParams.get(k)
    if (v) qs.set(k, v)
  }

  const blingUrl = id
    ? `https://www.bling.com.br/Api/v3/produtos/${encodeURIComponent(id)}`
    : `https://www.bling.com.br/Api/v3/produtos?${qs}`

  const blingRes = await fetch(blingUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!blingRes.ok) {
    const err = await blingRes.text()
    return new Response(JSON.stringify({ error: 'Erro Bling: ' + err }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const data = await blingRes.json()
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
