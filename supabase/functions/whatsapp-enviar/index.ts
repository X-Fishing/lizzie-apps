// Edge Function: whatsapp-enviar
// Adaptador de envio de WhatsApp escolhido por env WHATSAPP_PROVIDER:
//   none  (padrão) → NÃO envia; devolve { ok, waLink } com o link wa.me para o
//                     app abrir (modo grátis; a revendedora só aperta enviar).
//   meta            → WhatsApp Cloud API oficial (WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_ID).
//   zapi            → Z-API/Evolution (WHATSAPP_ZAPI_URL, WHATSAPP_ZAPI_TOKEN).
// Interface: POST { telefone, mensagem, midiaUrl? } → { ok, waLink?, erro? }.
const PROVIDER = Deno.env.get('WHATSAPP_PROVIDER') ?? 'none'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function tel55(tel: string): string | null {
  const d = String(tel || '').replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length <= 11 ? '55' + d : d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  let body: { telefone?: string; mensagem?: string; midiaUrl?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const numero = tel55(body.telefone ?? '')
  const mensagem = (body.mensagem ?? '').trim()
  if (!numero) return json({ error: 'telefone inválido' }, 400)
  if (!mensagem) return json({ error: 'mensagem vazia' }, 400)
  const texto = body.midiaUrl ? `${mensagem}\n${body.midiaUrl}` : mensagem

  // Modo grátis: só devolve o link wa.me (inofensivo — não gasta crédito).
  if (PROVIDER === 'none') {
    return json({ ok: true, provider: 'none', waLink: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` })
  }

  if (PROVIDER === 'meta') {
    const token = Deno.env.get('WHATSAPP_META_TOKEN')
    const phoneId = Deno.env.get('WHATSAPP_META_PHONE_ID')
    if (!token || !phoneId) return json({ error: 'Meta não configurado (WHATSAPP_META_TOKEN/PHONE_ID)' }, 501)
    const payload = body.midiaUrl
      ? { messaging_product: 'whatsapp', to: numero, type: 'image', image: { link: body.midiaUrl, caption: mensagem } }
      : { messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensagem } }
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return json({ error: 'Meta: ' + await r.text() }, 502)
    return json({ ok: true, provider: 'meta' })
  }

  if (PROVIDER === 'zapi') {
    const url = Deno.env.get('WHATSAPP_ZAPI_URL')     // ex.: https://api.z-api.io/instances/ID/token/TK
    const clientToken = Deno.env.get('WHATSAPP_ZAPI_TOKEN')
    if (!url) return json({ error: 'Z-API não configurado (WHATSAPP_ZAPI_URL)' }, 501)
    const endpoint = body.midiaUrl ? `${url}/send-image` : `${url}/send-text`
    const payload = body.midiaUrl
      ? { phone: numero, image: body.midiaUrl, caption: mensagem }
      : { phone: numero, message: mensagem }
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(clientToken ? { 'Client-Token': clientToken } : {}) },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return json({ error: 'Z-API: ' + await r.text() }, 502)
    return json({ ok: true, provider: 'zapi' })
  }

  return json({ error: 'WHATSAPP_PROVIDER desconhecido: ' + PROVIDER }, 500)
})
