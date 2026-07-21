// Envio de WhatsApp — adaptador trocável, começando no modo GRÁTIS (wa.me).
// Modo 'none' (padrão): não usa provedor pago; monta o link wa.me e abre o
// WhatsApp para a revendedora só apertar enviar. Para migrar p/ envio automático
// (Meta Cloud API / Z-API), mudar WHATSAPP_PROVIDER aqui E a env WHATSAPP_PROVIDER
// da Edge Function whatsapp-enviar — nenhum outro código muda.
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { toast, waMeLink } from './utils.js';

export const WHATSAPP_PROVIDER = 'none'; // 'none' | 'meta' | 'zapi' (espelho do env da função)

// Abre o WhatsApp com a mensagem pronta. No modo 'none' é 100% client-side e
// SÍNCRONO (precisa ser chamado direto do clique p/ o navegador não bloquear o popup).
// Retorna { ok, waLink }.
export function enviarWhatsApp({ telefone, mensagem, midiaUrl }) {
  const texto = midiaUrl ? `${mensagem}\n${midiaUrl}` : mensagem;

  if (WHATSAPP_PROVIDER === 'none') {
    const link = waMeLink(telefone, texto);
    if (!link) { toast('Telefone da cliente inválido'); return { ok: false }; }
    const win = window.open(link, '_blank');
    if (!win) toast('Permita popups para abrir o WhatsApp');
    return { ok: !!win, waLink: link };
  }

  // Provedor pago: dispara pela Edge Function (assíncrono).
  (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}` },
        body: JSON.stringify({ telefone, mensagem, midiaUrl }),
      });
      const j = await resp.json();
      if (!resp.ok || j.error) { toast('Falha no envio: ' + (j.error || resp.status)); return; }
      if (j.waLink) window.open(j.waLink, '_blank');
      else toast('Mensagem enviada no WhatsApp!');
    } catch (e) { console.error('enviarWhatsApp', e); toast('Erro ao enviar WhatsApp'); }
  })();
  return { ok: true };
}

// Fluxos que precisam de await (ex.: gerar imagem) antes do link: abre uma aba
// vazia no clique síncrono e só depois aponta a URL — driblando o popup blocker.
export async function abrirWhatsAppAposAsync(promiseDoLink) {
  const win = window.open('', '_blank');
  try {
    const link = await promiseDoLink;
    if (!link) throw new Error('sem link');
    if (win) win.location = link; else window.open(link, '_blank');
    return true;
  } catch (e) {
    console.error('abrirWhatsAppAposAsync', e);
    if (win) win.close();
    return false;
  }
}
