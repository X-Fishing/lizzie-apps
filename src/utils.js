// Helpers puros e utilitarios compartilhados. Sem logica de dominio.
import { sb } from './supabase.js';
import { state } from './state.js';

// Escapa dados do banco/Bling antes de interpolar em innerHTML (anti-XSS).
// Use SEMPRE que jogar texto vindo de usuario/Bling dentro de template string.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Quantidade disponivel de uma peca (trata campos null para nao gerar NaN).
export function qtdDisp(c) {
  return (c.quantidade_enviada || 0) - (c.quantidade_vendida || 0) - (c.quantidade_devolvida || 0);
}

// Wrapper com timeout para queries Supabase (evita travar indefinidamente)
export function sbQ(query, ms = 12000) {
  return Promise.race([
    query,
    new Promise((_, reject) =>
      setTimeout(() => reject({ timeout: true }), ms)
    )
  ]).catch(e => {
    if (e && e.timeout) return { data: null, error: { message: 'timeout' } };
    return { data: null, error: e };
  });
}

export function isAuthError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('jwt') ||
         msg.includes('refresh token') ||
         msg.includes('not authenticated') ||
         msg.includes('invalid') && msg.includes('token') ||
         error.status === 401 ||
         error.code === 'PGRST301';
}

// Returns true if an error was handled (caller should bail out).
export async function handleSupabaseError(error, fallbackMsg = 'Erro inesperado') {
  if (!error) return false;
  if (isAuthError(error)) {
    toast('Sessão expirada. Faça login novamente.');
    await sb.auth.signOut().catch(() => {});
    setTimeout(() => location.reload(), 1500);
    return true;
  }
  toast(fallbackMsg);
  return true;
}

export function showMsg(el, text, type) {
  el.textContent = text; el.className = 'auth-msg ' + type; el.style.display = 'block';
}

// Busca TODAS as linhas paginando de 1000 em 1000 (o Supabase/PostgREST corta
// em 1000 por requisição; sem isso, catálogos grandes "somem" peças antigas).
export async function fetchPaginado(makeQuery, pageSize = 1000) {
  let from = 0; const todas = [];
  while (true) {
    const { data, error } = await sbQ(makeQuery().range(from, from + pageSize - 1));
    if (error) return { data: null, error };
    todas.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: todas, error: null };
}

export const CAT_LABEL = { anel:'Anel', colar:'Colar', brinco:'Brinco', pulseira:'Pulseira', outro:'Outro' };

export function detectarCategoria(descricao) {
  const d = (descricao || '').toLowerCase();
  if (d.includes('brinco')) return 'brinco';
  if (d.includes('colar') || d.includes('corrente') || d.includes('escapulario') || d.includes('escapulário') || d.includes('gargantilha')) return 'colar';
  if (d.includes('anel')) return 'anel';
  if (d.includes('pulseira') || d.includes('bracelete')) return 'pulseira';
  return 'outro';
}

export function fmtBRL(n) {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function openModal(id) { document.getElementById(id).classList.add('show'); }

export function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// Confirmação embutida (PWA-safe) — substitui confirm()/prompt() nativos.
export function confirmarAcao(titulo, msg, textoBotao, onConfirm) {
  document.getElementById('confirma-titulo').textContent = titulo;
  document.getElementById('confirma-msg').textContent = msg;
  document.getElementById('confirma-ok').textContent = textoBotao || 'Confirmar';
  state._confirmaCb = onConfirm;
  openModal('modal-confirma');
}

export function fecharConfirma(ok) {
  closeModal('modal-confirma');
  const cb = state._confirmaCb; state._confirmaCb = null;
  if (ok && cb) cb();
}

export function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('T')[0].split('-');
  return `${day}/${m}/${y}`;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
