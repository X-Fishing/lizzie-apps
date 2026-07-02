// Divulgar maleta: link público exclusivo por revendedora no site-catálogo
// (lizzie-catalogo.netlify.app/maleta?t=<share_token>). O token vem de
// profiles.share_token e a página pública lê via RPC maleta_publica (anon).
import { sb } from './supabase.js';
import { state } from './state.js';
import { toast, sbQ, confirmarAcao, openModal } from './utils.js';
import { ehStaff } from './auth.js';

const MALETA_PUBLICA_URL = 'https://lizzie-catalogo.netlify.app/maleta?t=';
let divulgarCtx = { token: null, propria: false };

function montarDivulgar(nome, token, propria) {
  divulgarCtx = { token, propria };
  const url = MALETA_PUBLICA_URL + token;
  document.getElementById('div-rev-nome').textContent = nome;
  document.getElementById('div-link').value = url;
  const msg = `Oi! Esse é o meu catálogo Lizzie Semijoias com as peças disponíveis: ${url}`;
  document.getElementById('div-wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  document.getElementById('div-qr').style.display = 'none';
  document.getElementById('div-qr').innerHTML = '';
  // "Gerar novo link" só para a própria dona do token (RPC regenera o próprio).
  document.getElementById('div-regen-wrap').style.display = propria ? 'block' : 'none';
  openModal('modal-divulgar');
}

// Revendedora: usa o próprio token. Admin/gestor: busca o token da revendedora.
export async function abrirDivulgarMaleta(revId) {
  if (!revId || revId === state.currentUser.id) {
    let token = state.currentProfile.share_token;
    if (!token) {
      // Profile carregado antes da coluna existir: rebusca.
      const { data } = await sbQ(sb.from('profiles').select('share_token').eq('id', state.currentUser.id).single());
      token = data && data.share_token;
      if (token) state.currentProfile.share_token = token;
    }
    if (!token) { toast('Link indisponível — rode db-functions.sql no Supabase.'); return; }
    montarDivulgar(state.currentProfile.nome.split(' ')[0], token, true);
    return;
  }
  if (!ehStaff()) { toast('Sem permissão'); return; }
  const { data, error } = await sbQ(sb.from('profiles').select('nome,share_token').eq('id', revId).single());
  if (error || !data || !data.share_token) { toast('Link indisponível — rode db-functions.sql no Supabase.'); return; }
  montarDivulgar((data.nome || '').split(' ')[0], data.share_token, false);
}

export async function copiarLinkMaleta(btn) {
  const input = document.getElementById('div-link');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select(); document.execCommand('copy');   // fallback (http/local)
  }
  btn.textContent = 'Copiado!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
}

export async function mostrarQrMaleta(btn) {
  const box = document.getElementById('div-qr');
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  btn.disabled = true;
  try {
    // uqr (unjs, MIT) — carregada sob demanda só aqui; ~5 KB gzip na rede.
    const uqr = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/uqr@0.1.2/dist/index.min.mjs');
    const svg = uqr.renderSVG(document.getElementById('div-link').value, { ecc: 'M', border: 2 });
    box.innerHTML = `<div style="background:#fff;display:inline-block;padding:10px;border-radius:12px;border:1px solid var(--border);max-width:230px">${svg}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Aponte a câmera do celular</div>`;
    box.style.display = 'block';
  } catch (e) {
    console.warn('QR indisponível:', e);
    toast('Não deu pra gerar o QR agora — use o link ou o WhatsApp.');
  }
  btn.disabled = false;
}

export function regenerarLinkMaleta() {
  if (!divulgarCtx.propria) return;
  confirmarAcao('Gerar novo link',
    'O link atual vai PARAR de funcionar (quem tiver o antigo verá "link inválido"). Gerar um novo?',
    'Gerar novo link', async () => {
      const { data, error } = await sbQ(sb.rpc('regenerar_share_token'));
      if (error || !data) { toast('Erro ao gerar novo link'); return; }
      state.currentProfile.share_token = data;
      toast('Novo link gerado — o antigo foi desativado');
      montarDivulgar(state.currentProfile.nome.split(' ')[0], data, true);
    });
}
