// Edge Function: nuvemshop-buscar-produtos
// Busca produtos na loja da Nuvemshop para a tela de vínculo manual do admin.
//   GET ?query=texto  → { produtos: [{ id, nome, variantes: [{ id, sku, nome }] }] }
//
// Exige JWT de gestor/admin (verify_jwt = false no config.toml; a checagem é
// feita aqui, igual à sync-estoque, para o erro sair legível em JSON).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SUPABASE_URL, SERVICE_KEY, ANON_KEY, cors, json,
  contaNuvemshop, apiNuvemshop, erroNuvemshop,
} from '../_shared/nuvemshop.ts'

/** Nome da Nuvemshop vem como string ou objeto multi-idioma ({ pt: "..." }). */
function nomeI18n(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>
    return o.pt ?? o.pt_BR ?? o.es ?? o.en ?? Object.values(o)[0] ?? ''
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!auth) return json({ error: 'sem credencial' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth}` } },
  })
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ error: 'sessão inválida' }, 401)
  const { data: quem } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!quem || !['admin', 'func_completo'].includes(quem.role)) {
    return json({ error: 'sem permissão' }, 403)
  }

  const query = (new URL(req.url).searchParams.get('query') ?? '').trim()
  if (!query) return json({ error: 'informe o texto da busca' }, 400)

  const conta = await contaNuvemshop(admin)
  if (!conta) return json({ error: 'Nuvemshop não conectada.' }, 401)

  const res = await apiNuvemshop(conta, `/products?q=${encodeURIComponent(query)}&per_page=50`)
  if (!res.ok) return json({ error: 'Erro Nuvemshop: ' + await erroNuvemshop(res) }, 502)

  const lista = await res.json()
  const produtos = (Array.isArray(lista) ? lista : []).map((p: any) => ({
    id: p.id,
    nome: nomeI18n(p.name),
    variantes: (p.variants ?? []).map((v: any) => ({
      id: v.id,
      sku: v.sku ?? '',
      // Nome da variante = valores dos atributos ("Dourado / M"); produto
      // simples vem com values vazio.
      nome: (v.values ?? []).map((x: any) => nomeI18n(x)).filter(Boolean).join(' / '),
      stock: v.stock,
    })),
  }))

  return json({ produtos })
})
