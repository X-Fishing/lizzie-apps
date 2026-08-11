// Edge Function: nuvemshop-webhook-pedido
// Recebe o webhook `order/paid` da Nuvemshop e dá baixa em estoque_qtd das
// peças vendidas direto no site — senão o app venderia peça que já saiu pela
// loja. O UPDATE dispara o trigger da fila, então o site se ressincroniza
// sozinho logo em seguida.
//
// Registrar no admin da Nuvemshop (Configurações → Notificações):
//   URL: {SUPABASE_URL}/functions/v1/nuvemshop-webhook-pedido
//   Evento: order/paid   (NÃO order/created — evita descontar pedido não pago)
//
// Endpoint público (verify_jwt = false): a Nuvemshop não manda JWT do
// Supabase. A autenticidade vem do HMAC-SHA256 assinado com o client secret
// da app, quando o secret NUVEMSHOP_CLIENT_SECRET está configurado.
//
// Idempotência: o par (order_id, evento) é reivindicado em
// nuvemshop_pedidos_log antes de processar. Reenvio da Nuvemshop não desconta
// duas vezes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SUPABASE_URL, SERVICE_KEY, cors, json,
  contaNuvemshop, apiNuvemshop, erroNuvemshop,
} from '../_shared/nuvemshop.ts'

const CLIENT_SECRET = Deno.env.get('NUVEMSHOP_CLIENT_SECRET') ?? ''

/** Confere o HMAC-SHA256 que a Nuvemshop manda no header. */
async function assinaturaValida(corpo: string, assinatura: string): Promise<boolean> {
  if (!assinatura) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(corpo))
  const esperado = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  // Comparação em tempo constante.
  if (esperado.length !== assinatura.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ assinatura.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  const bruto = await req.text()

  // Falha FECHADA de propósito. O endpoint é público (a Nuvemshop não manda
  // JWT do Supabase); sem a assinatura, qualquer um que descubra a URL
  // dispararia baixa de estoque à vontade. Configure o secret antes:
  //   npx supabase secrets set NUVEMSHOP_CLIENT_SECRET=...
  if (!CLIENT_SECRET) {
    console.error('NUVEMSHOP_CLIENT_SECRET não configurado — webhook recusado.')
    return json({ error: 'webhook não configurado' }, 503)
  }
  const assinatura = req.headers.get('x-linkedstore-hmac-sha256') ?? ''
  if (!await assinaturaValida(bruto, assinatura)) {
    return json({ error: 'assinatura inválida' }, 401)
  }

  let evt: { id?: number; event?: string; store_id?: number }
  try { evt = JSON.parse(bruto) } catch { return json({ error: 'JSON inválido' }, 400) }

  const orderId = Number(evt.id)
  const evento = evt.event ?? ''
  if (!Number.isInteger(orderId) || orderId <= 0) return json({ error: 'sem id de pedido' }, 400)

  // Só o evento de pagamento mexe em estoque. Qualquer outro: 200 e ignora
  // (200 evita a Nuvemshop ficar reenviando).
  if (evento !== 'order/paid') return json({ ok: true, ignorado: evento })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // Lê o pedido ANTES de reivindicar. Se a leitura falhar, nada foi marcado
  // e a Nuvemshop pode reenviar sem risco de perder o evento.
  const conta = await contaNuvemshop(admin)
  if (!conta) return json({ error: 'Nuvemshop não conectada.' }, 503)

  const res = await apiNuvemshop(conta, `/orders/${orderId}`)
  if (!res.ok) {
    return json({ error: 'não foi possível ler o pedido: ' + await erroNuvemshop(res) }, 502)
  }
  const pedido = await res.json()

  // Linha sem variant_id utilizável (produto apagado, item personalizado)
  // segue para a RPC mesmo assim — lá ela cai no ramo "sem vínculo" e entra
  // no aviso do log. Filtrar aqui deixaria a gestão sem rastro da diferença
  // de estoque.
  const itens = (pedido?.products ?? []).map((item: any) => {
    const variantId = Number(item?.variant_id)
    return {
      variant_id: Number.isInteger(variantId) ? variantId : null,
      qtd: Number(item?.quantity) || 0,
      nome: String(item?.name ?? 'item'),
    }
  })

  // Reivindicação + baixa de TODOS os itens numa transação só. Tem que ser
  // atômico: descontar item a item daqui de fora deixava o pedido pela
  // metade se um item falhasse — e o reenvio da Nuvemshop descontava de novo
  // os que já tinham passado.
  const { data, error } = await admin.rpc('nuvemshop_processar_pedido', {
    p_order_id: orderId, p_evento: evento, p_itens: itens,
  })
  if (error) return json({ error: 'falha ao processar o pedido: ' + error.message }, 500)

  if (data?.ja_processado) return json({ ok: true, jaProcessado: true })

  const semVinculo: string[] = data?.sem_vinculo ?? []
  if (semVinculo.length) {
    // Vendido no site sem vínculo no app: não deveria acontecer, mas fica
    // no log (nuvemshop_pedidos_log.aviso) para a gestão conferir à mão.
    console.warn(`Pedido ${orderId} — itens sem vínculo: ${semVinculo.join('; ')}`)
  }

  return json({ ok: true, baixados: data?.baixados ?? 0, semVinculo: semVinculo.length })
})
