// Edge Function: nuvemshop-criar-produtos
// Cria na Nuvemshop os produtos do catálogo do app que ainda não existem lá:
// ativos, com foto e sem nuvemshop_product_id. Processa em lote (LOTE por
// chamada) para respeitar o rate limit — a tela chama repetidas vezes até
// `restantes` zerar.
//
// Só modo manual (sem cron por enquanto): exige JWT de admin/func_completo.
// verify_jwt = false no config.toml — a checagem é feita aqui, como nas
// outras funções da Nuvemshop, para o erro sair legível em JSON.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SUPABASE_URL, SERVICE_KEY, ANON_KEY, cors, json,
  contaNuvemshop, apiNuvemshop, erroNuvemshop, type Conta,
} from '../_shared/nuvemshop.ts'

const LOTE = 20 // itens por execução (respeita o rate limit da Nuvemshop)

type Produto = {
  id: string
  nome: string
  sku: string | null
  preco_venda: number | null
  descricao_curta: string | null
  foto_url: string
  formato: string
}

type Variacao = {
  id: string
  produto_id: string
  atributo: string
  valor: string
  sku: string | null
  preco_venda: number | null
}

/** Monta o corpo do POST /products a partir de um produto (simples ou com variação). */
async function montarCorpo(admin: any, p: Produto, variacoes: Variacao[]) {
  const imagens = p.foto_url ? [{ src: p.foto_url }] : []

  if (p.formato !== 'variacao') {
    const { data: disponivel, error } = await admin.rpc('estoque_disponivel_site', { p_produto_id: p.id })
    if (error) return { erro: 'erro ao calcular o disponível: ' + error.message }
    return {
      corpo: {
        name: { pt: p.nome },
        description: { pt: p.descricao_curta || '' },
        variants: [{
          price: String(p.preco_venda ?? 0),
          sku: p.sku || null,
          stock: Math.max(0, Number(disponivel ?? 0)),
        }],
        images: imagens,
      },
    }
  }

  if (!variacoes.length) return { erro: 'produto marcado como variação, mas sem variações pendentes de vínculo' }

  const atributos = [...new Set(variacoes.map(v => v.atributo))]
  const variants = []
  for (const v of variacoes) {
    const { data: disponivel, error } = await admin.rpc('estoque_disponivel_site_variacao', { p_variacao_id: v.id })
    if (error) return { erro: `erro ao calcular o disponível da variação ${v.atributo}: ${v.valor}: ${error.message}` }
    variants.push({
      price: String(v.preco_venda ?? p.preco_venda ?? 0),
      sku: v.sku || null,
      stock: Math.max(0, Number(disponivel ?? 0)),
      values: [{ pt: v.valor }],
    })
  }
  return {
    corpo: {
      name: { pt: p.nome },
      description: { pt: p.descricao_curta || '' },
      attributes: atributos.map(a => ({ pt: a })),
      variants,
      images: imagens,
    },
  }
}

/** Marca produto (e, se houver, suas variações) como erro — nenhuma linha fica sem status. */
async function marcarErro(admin: any, p: Produto, variacoes: Variacao[], erro: string) {
  await admin.from('produtos').update({
    nuvemshop_sync_status: 'erro', nuvemshop_sync_erro: erro,
  }).eq('id', p.id)
  for (const v of variacoes) {
    await admin.from('produto_variacoes').update({
      nuvemshop_sync_status: 'erro', nuvemshop_sync_erro: erro,
    }).eq('id', v.id)
  }
}

/** Cria um produto na Nuvemshop e grava o vínculo de volta. Retorna erro legível ou null. */
async function criarProduto(admin: any, conta: Conta, p: Produto, variacoes: Variacao[]): Promise<string | null> {
  const montado = await montarCorpo(admin, p, variacoes)
  if (montado.erro) {
    await marcarErro(admin, p, variacoes, montado.erro)
    return montado.erro
  }

  const res = await apiNuvemshop(conta, '/products', { method: 'POST', body: JSON.stringify(montado.corpo) })
  if (!res.ok) {
    const erro = await erroNuvemshop(res)
    await marcarErro(admin, p, variacoes, erro)
    return erro
  }

  const resp = await res.json()
  const agora = new Date().toISOString()

  if (p.formato !== 'variacao') {
    await admin.from('produtos').update({
      nuvemshop_product_id: resp.id,
      nuvemshop_variant_id: resp.variants?.[0]?.id ?? null,
      nuvemshop_sync_status: 'ok', nuvemshop_sync_erro: null, nuvemshop_synced_at: agora,
    }).eq('id', p.id)
    return null
  }

  // Produto com variação: o próprio produto guarda o nuvemshop_product_id;
  // cada linha de produto_variacoes guarda o variant_id correspondente. A
  // Nuvemshop preserva a ordem dos `variants` enviados na resposta.
  await admin.from('produtos').update({
    nuvemshop_product_id: resp.id,
    nuvemshop_sync_status: 'ok', nuvemshop_sync_erro: null, nuvemshop_synced_at: agora,
  }).eq('id', p.id)

  for (let i = 0; i < variacoes.length; i++) {
    const variantId = resp.variants?.[i]?.id ?? null
    await admin.from('produto_variacoes').update({
      nuvemshop_product_id: resp.id,
      nuvemshop_variant_id: variantId,
      nuvemshop_sync_status: variantId ? 'ok' : 'erro',
      nuvemshop_sync_erro: variantId ? null : 'a loja não devolveu o id desta variação',
      nuvemshop_synced_at: agora,
    }).eq('id', variacoes[i].id)
  }
  return null
}

// `.select()` só pode ser chamado uma vez por builder — os dois pontos que
// precisam do mesmo filtro (buscar o lote e depois contar os restantes)
// aplicam este filtro em cima de um `.select()` próprio, cada um o seu.
function filtroCandidatos(qb: any) {
  return qb.eq('ativo', true).not('foto_url', 'is', null).neq('foto_url', '').is('nuvemshop_product_id', null)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Autorização: JWT de admin/func_completo (igual ao modo manual da sync-estoque) ──
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!auth) return json({ error: 'sem credencial' }, 401)
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth}` } },
  })
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ error: 'sessão inválida' }, 401)
  const { data: quem } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!quem || !['admin', 'func_completo'].includes(quem.role)) {
    return json({ error: 'sem permissão para criar produtos na loja' }, 403)
  }

  const conta = await contaNuvemshop(admin)
  if (!conta) return json({ error: 'Nuvemshop não conectada.' }, 401)

  const { data: produtos, error: errProdutos } = await filtroCandidatos(
    admin.from('produtos').select('id, nome, sku, preco_venda, descricao_curta, foto_url, formato'),
  ).order('created_at', { ascending: true }).limit(LOTE)
  if (errProdutos) return json({ error: 'erro ao buscar candidatos: ' + errProdutos.message }, 500)

  let criados = 0
  let falhas = 0
  const erros: string[] = []

  for (const p of (produtos ?? []) as Produto[]) {
    let variacoes: Variacao[] = []
    if (p.formato === 'variacao') {
      const { data: vars } = await admin.from('produto_variacoes')
        .select('id, produto_id, atributo, valor, sku, preco_venda')
        .eq('produto_id', p.id)
        .is('nuvemshop_variant_id', null)
      variacoes = (vars ?? []) as Variacao[]
    }

    const erro = await criarProduto(admin, conta, p, variacoes)
    if (erro) { falhas++; erros.push(`${p.nome}: ${erro}`) }
    else criados++
  }

  const { count: restantes } = await filtroCandidatos(
    admin.from('produtos').select('id', { count: 'exact', head: true }),
  )

  return json({ ok: true, criados, falhas, erros, restantes: restantes ?? 0 })
})
