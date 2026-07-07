// Edge Function: bling-auth
// Callback OAuth do Bling. Registrar no app do Bling como URL de redirecionamento:
//   https://qoouzjntyfzcxnwjksiu.supabase.co/functions/v1/bling-auth
// Fluxo: usuário abre o link de convite/autorização do Bling → consente →
// Bling redireciona pra cá com ?code= → trocamos o code pelos tokens e
// gravamos em bling_tokens (id=1), a mesma linha que bling-pedidos/produtos usam.
// Segredos vêm do ambiente (Supabase secrets): BLING_CLIENT_ID,
// BLING_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY. Nada hardcoded.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BLING_CLIENT_ID = Deno.env.get('BLING_CLIENT_ID') ?? ''
const BLING_CLIENT_SECRET = Deno.env.get('BLING_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const html = (msg: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#F5EFE6;color:#1A1A1A;display:flex;align-items:center;justify-content:center;min-height:90vh"><div style="text-align:center;max-width:480px"><h2 style="font-weight:500">${msg}</h2></div></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (!code) return html('Faltou o parâmetro <code>?code=</code> — abra pelo link de autorização do Bling.', 400)

  // Troca o authorization code pelos tokens
  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    console.error('bling-auth: troca falhou', JSON.stringify(data))
    return html('A troca do código falhou (código expirado ou já usado). Gere um novo pelo link de autorização e tente de novo.', 500)
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  const { error } = await sb.from('bling_tokens').upsert({
    id: 1,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.error('bling-auth: erro ao gravar tokens', error.message)
    return html('Tokens obtidos, mas falhou ao gravar no banco. Veja os logs da função.', 500)
  }

  return html('✅ Bling conectado com sucesso — já com os escopos novos. Pode fechar esta aba e voltar pro app.')
})
