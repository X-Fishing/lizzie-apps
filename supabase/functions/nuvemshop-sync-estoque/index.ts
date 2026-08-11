// Edge Function: nuvemshop-sync-estoque
// Empurra para a Nuvemshop o estoque DISPONÍVEL de cada produto, isto é, o
// saldo central menos o que está em maleta ativa de revendedora (a conta mora
// nas RPCs estoque_disponivel_site / estoque_disponivel_site_variacao).
//
// Dois modos de disparo:
//   • CRON (sem parâmetros)      → processa até LOTE itens pendentes da fila.
//     Autentica com a service role key no header Authorization.
//   • MANUAL (?produto_id=<uuid>) → sincroniza um produto na hora (botão
//     "Sincronizar agora" do painel). Exige JWT de gestor/admin.
//
// verify_jwt = false no config.toml: a checagem é feita aqui, porque o cron
// não tem JWT de usuário.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SUPABASE_URL, SERVICE_KEY, ANON_KEY, cors, json,
  contaNuvemshop, apiNuvemshop, erroNuvemshop, type Conta,
} from '../_shared/nuvemshop.ts'

const LOTE = 20          // itens por execução do cron (respeita o rate limit)
const MAX_TENTATIVAS = 5

type Alvo = {
  produto_id: string
  variacao_id: string | null
  product_id: number | null
  variant_id: number | null
}

/** Calcula o disponível e faz o PUT na Nuvemshop. Retorna erro legível ou null. */
async function sincronizarAlvo(admin: any, conta: Conta, alvo: Alvo): Promise<string | null> {
  const tabela = alvo.variacao_id ? 'produto_variacoes' : 'produtos'
  const idLinha = alvo.variacao_id ?? alvo.produto_id

  // Sem vínculo: não chama a API, marca 'sem_par' e sai sem erro.
  if (!alvo.product_id || !alvo.variant_id) {
    await admin.from(tabela).update({
      nuvemshop_sync_status: 'sem_par',
      nuvemshop_sync_erro: null,
      nuvemshop_synced_at: new Date().toISOString(),
    }).eq('id', idLinha)
    return null
  }

  const { data: disponivel, error: errRpc } = alvo.variacao_id
    ? await admin.rpc('estoque_disponivel_site_variacao', { p_variacao_id: alvo.variacao_id })
    : await admin.rpc('estoque_disponivel_site', { p_produto_id: alvo.produto_id })

  if (errRpc) return 'erro ao calcular o disponível: ' + errRpc.message
  const stock = Math.max(0, Number(disponivel ?? 0))

  // NOTA (multi inventory): em lojas com estoque por local, a Nuvemshop marca
  // `stock` como deprecated em favor de `inventory_levels` com `location_id`.
  // A própria doc garante retrocompatibilidade — enviar só `stock` continua
  // funcionando e atualiza o primeiro local. Se a loja passar a usar vários
  // depósitos e o número divergir, é aqui que muda: trocar o corpo por
  // { inventory_levels: [{ location_id, stock }] }.
  const res = await apiNuvemshop(conta,
    `/products/${alvo.product_id}/variants/${alvo.variant_id}`,
    { method: 'PUT', body: JSON.stringify({ stock }) })

  if (!res.ok) return await erroNuvemshop(res)

  await admin.from(tabela).update({
    nuvemshop_sync_status: 'ok',
    nuvemshop_sync_erro: null,
    nuvemshop_synced_at: new Date().toISOString(),
  }).eq('id', idLinha)
  return null
}

/**
 * Expande um item da fila nos alvos concretos que precisam ir para a API.
 * Produto formato='variacao' vira uma linha por variação vinculada.
 */
async function alvosDoItem(admin: any, produtoId: string, variacaoId: string | null): Promise<Alvo[]> {
  if (variacaoId) {
    const { data: v } = await admin.from('produto_variacoes')
      .select('id, produto_id, nuvemshop_product_id, nuvemshop_variant_id')
      .eq('id', variacaoId).maybeSingle()
    if (!v) return []
    return [{
      produto_id: v.produto_id, variacao_id: v.id,
      product_id: v.nuvemshop_product_id, variant_id: v.nuvemshop_variant_id,
    }]
  }

  const { data: p } = await admin.from('produtos')
    .select('id, formato, nuvemshop_product_id, nuvemshop_variant_id')
    .eq('id', produtoId).maybeSingle()
  if (!p) return []

  if (p.formato !== 'variacao') {
    return [{
      produto_id: p.id, variacao_id: null,
      product_id: p.nuvemshop_product_id, variant_id: p.nuvemshop_variant_id,
    }]
  }

  const { data: vars } = await admin.from('produto_variacoes')
    .select('id, produto_id, nuvemshop_product_id, nuvemshop_variant_id')
    .eq('produto_id', p.id)
  if (!vars?.length) {
    // Produto marcado como variação mas sem variações cadastradas.
    return [{ produto_id: p.id, variacao_id: null, product_id: null, variant_id: null }]
  }
  return vars.map((v: any) => ({
    produto_id: v.produto_id, variacao_id: v.id,
    product_id: v.nuvemshop_product_id, variant_id: v.nuvemshop_variant_id,
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const url = new URL(req.url)
  const produtoId = url.searchParams.get('produto_id')
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  // ── Autorização ────────────────────────────────────────────────────
  if (produtoId) {
    // Manual: precisa ser gestor/admin de verdade.
    if (!auth) return json({ error: 'sem credencial' }, 401)
    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${auth}` } },
    })
    const { data: { user } } = await sbUser.auth.getUser()
    if (!user) return json({ error: 'sessão inválida' }, 401)
    const { data: quem } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!quem || !['admin', 'func_completo'].includes(quem.role)) {
      return json({ error: 'sem permissão para sincronizar' }, 403)
    }
  } else {
    // Cron: só com a service role key.
    if (auth !== SERVICE_KEY) return json({ error: 'apenas o agendador chama este modo' }, 403)
  }

  const conta = await contaNuvemshop(admin)
  if (!conta) return json({ error: 'Nuvemshop não conectada.' }, 401)

  // ── Modo manual ────────────────────────────────────────────────────
  if (produtoId) {
    const alvos = await alvosDoItem(admin, produtoId, null)
    if (!alvos.length) return json({ error: 'produto não encontrado' }, 404)

    const erros: string[] = []
    for (const alvo of alvos) {
      const erro = await sincronizarAlvo(admin, conta, alvo)
      if (erro) {
        erros.push(erro)
        const tabela = alvo.variacao_id ? 'produto_variacoes' : 'produtos'
        await admin.from(tabela).update({
          nuvemshop_sync_status: 'erro', nuvemshop_sync_erro: erro,
        }).eq('id', alvo.variacao_id ?? alvo.produto_id)
      }
    }
    if (erros.length) return json({ ok: false, error: erros[0], erros }, 502)
    return json({ ok: true, sincronizados: alvos.length })
  }

  // ── Modo cron: processa a fila ─────────────────────────────────────
  const { data: fila } = await admin.from('nuvemshop_sync_queue')
    .select('id, produto_id, produto_variacao_id, tentativas')
    .eq('processado', false)
    .order('criado_em', { ascending: true })
    .limit(LOTE)

  if (!fila?.length) return json({ ok: true, processados: 0, restantes: 0 })

  let processados = 0
  let falhas = 0

  for (const item of fila) {
    const alvos = await alvosDoItem(admin, item.produto_id, item.produto_variacao_id)

    let erro: string | null = null
    if (!alvos.length) {
      erro = null   // produto sumiu (cascade); só descarta o item.
    } else {
      for (const alvo of alvos) {
        const e = await sincronizarAlvo(admin, conta, alvo)
        if (e) { erro = e; break }
      }
    }

    if (!erro) {
      await admin.from('nuvemshop_sync_queue')
        .update({ processado: true, erro: null }).eq('id', item.id)
      processados++
      continue
    }

    falhas++
    const tentativas = (item.tentativas ?? 0) + 1
    if (tentativas >= MAX_TENTATIVAS) {
      // Desiste: marca erro no produto e tira da fila, senão trava o lote
      // e nada mais nunca sincroniza.
      await admin.from('nuvemshop_sync_queue')
        .update({ processado: true, tentativas, erro }).eq('id', item.id)
      for (const alvo of alvos) {
        const tabela = alvo.variacao_id ? 'produto_variacoes' : 'produtos'
        await admin.from(tabela).update({
          nuvemshop_sync_status: 'erro', nuvemshop_sync_erro: erro,
        }).eq('id', alvo.variacao_id ?? alvo.produto_id)
      }
    } else {
      await admin.from('nuvemshop_sync_queue')
        .update({ tentativas, erro }).eq('id', item.id)
    }
  }

  const { count: restantes } = await admin.from('nuvemshop_sync_queue')
    .select('id', { count: 'exact', head: true }).eq('processado', false)

  return json({ ok: true, processados, falhas, restantes: restantes ?? 0 })
})
