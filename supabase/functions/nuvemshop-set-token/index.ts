// Edge Function: nuvemshop-set-token
// Guarda store_id + access_token da Nuvemshop na tabela nuvemshop_tokens.
//
// Segurança: exige JWT (verify_jwt = true no config.toml) E confere no banco
// que quem chamou é admin. O token NUNCA volta para o client — a resposta é
// só { ok, conectado_em }. A tela do app também nunca reexibe o valor salvo.
// Interface: POST { store_id, access_token } → { ok: true, conectado_em }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SUPABASE_URL, SERVICE_KEY, ANON_KEY, cors, json,
  apiNuvemshop, erroNuvemshop,
} from '../_shared/nuvemshop.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  // 1) Quem está chamando? (JWT do app)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'sem credencial' }, 401)
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ error: 'sessão inválida' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // 2) É admin? (confere no banco — não confia em nada vindo do body)
  const { data: quem } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (quem?.role !== 'admin') return json({ error: 'só o admin conecta a loja' }, 403)

  // 3) Dados da loja
  let body: { store_id?: number | string; access_token?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const storeId = Number(body.store_id)
  const token = (body.access_token ?? '').trim()
  if (!Number.isInteger(storeId) || storeId <= 0) return json({ error: 'informe um store_id válido' }, 400)
  if (!token) return json({ error: 'informe o access_token' }, 400)

  // 4) Valida as credenciais antes de salvar — melhor recusar agora do que
  //    deixar a fila inteira falhar depois com token errado.
  const teste = await apiNuvemshop({ store_id: storeId, access_token: token }, '/store')
  if (!teste.ok) {
    return json({ error: 'a Nuvemshop recusou essas credenciais: ' + await erroNuvemshop(teste) }, 400)
  }

  const conectadoEm = new Date().toISOString()
  const { error } = await admin.from('nuvemshop_tokens').update({
    store_id: storeId,
    access_token: token,
    conectado_em: conectadoEm,
    updated_at: conectadoEm,
  }).eq('id', 1)
  if (error) return json({ error: 'não foi possível salvar: ' + error.message }, 500)

  // Nunca devolve o token.
  return json({ ok: true, conectado_em: conectadoEm })
})
