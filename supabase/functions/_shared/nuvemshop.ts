// Helpers compartilhados das funções da Nuvemshop.
// O CLI do Supabase empacota os arquivos importados junto com cada função,
// então isto vale para as quatro (set-token, sync-estoque, buscar-produtos,
// webhook-pedido) sem precisar duplicar.

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// Base da API. Loja brasileira usa api.nuvemshop.com.br; o domínio
// internacional (api.tiendanube.com) responde igual. Deixe sobrescrevível
// por secret caso a loja seja de outro país.
export const API_BASE = Deno.env.get('NUVEMSHOP_API_BASE') ?? 'https://api.nuvemshop.com.br/v1'

// A Nuvemshop EXIGE User-Agent identificando a aplicação e um e-mail de
// contato — requisições sem isso são recusadas.
export const USER_AGENT = Deno.env.get('NUVEMSHOP_USER_AGENT')
  ?? 'Lizzie Semijoias App (rondoncoutinho@gmail.com)'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

export type Conta = { store_id: number; access_token: string }

/** Lê a conta conectada. Retorna null se a loja ainda não foi configurada. */
export async function contaNuvemshop(admin: any): Promise<Conta | null> {
  const { data } = await admin.from('nuvemshop_tokens')
    .select('store_id, access_token').eq('id', 1).maybeSingle()
  if (!data?.access_token || !data?.store_id) return null
  return { store_id: data.store_id, access_token: data.access_token }
}

/**
 * Chamada à API da Nuvemshop.
 * Atenção ao header: a Nuvemshop usa `Authentication: bearer <token>`,
 * NÃO o `Authorization` de sempre.
 */
export async function apiNuvemshop(
  conta: Conta,
  caminho: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${API_BASE}/${conta.store_id}${caminho}`, {
    ...init,
    headers: {
      'Authentication': `bearer ${conta.access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...(init.headers ?? {}),
    },
  })
}

/** Mensagem de erro legível a partir de uma resposta da Nuvemshop. */
export async function erroNuvemshop(res: Response): Promise<string> {
  let corpo = ''
  try { corpo = await res.text() } catch { /* sem corpo */ }
  return `HTTP ${res.status}${corpo ? ' — ' + corpo.slice(0, 500) : ''}`
}
