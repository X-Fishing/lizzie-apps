// Helpers puros e utilitarios compartilhados. Sem logica de dominio.
import { sb } from './supabase.js';
import { state } from './state.js';

// Escapa dados do banco/Bling antes de interpolar em innerHTML (anti-XSS).
// Use SEMPRE que jogar texto vindo de usuario/Bling dentro de template string.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── REGRA CENTRAL: métricas de faturamento/receita/ranking/estoque IGNORAM
// revendedoras TESTE (profiles.teste = true). Toda agregação nova deve usar
// este helper. As telas individuais da revendedora teste seguem funcionando.
export function ehRevTeste(revId) {
  return state.revTesteSet?.has(String(revId)) || false;
}
export function marcarRevsTeste(profiles) {
  state.revTesteSet = new Set((profiles || []).filter(p => p.teste).map(p => String(p.id)));
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

// Helpers de data (BR<->ISO), dinheiro e foto (puros).
// Date BR helpers: input mask dd/mm/aaaa <-> ISO yyyy-mm-dd
export function maskDateBR(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 8);
  if (v.length >= 5) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2);
  input.value = v;
}

// Máscara dd/mm (sem ano) — usada na data combinada do fiado.
export function maskDiaMes(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2);
  input.value = v;
}

// dd/mm -> ISO yyyy-mm-dd, inferindo o ano da PRÓXIMA ocorrência (hoje ou futuro).
export function diaMesParaISO(s) {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const hojeISO = new Date().toISOString().slice(0, 10);
  const iso = y => `${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  let ano = Number(hojeISO.slice(0, 4));
  if (iso(ano) < hojeISO) ano += 1;
  return iso(ano);
}

export function brToISO(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), yy = m[3];
  return `${yy}-${mm}-${dd}`;
}

export function isoToBR(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

export function hojeBR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// CPF 000.000.000-00
export function maskCpf(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  input.value = v;
}

// CEP 00000-000
export function maskCep(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  input.value = v;
}

// Validação de CPF (dígito verificador). Só para AVISAR — não bloqueia salvar.
export function cpfValido(cpf) {
  const c = String(cpf || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = base => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}

// Busca de endereço por CEP (ViaCEP — grátis, sem chave). Falha → null.
export async function buscarCep(cep) {
  const limpo = (cep || '').replace(/\D/g, '');
  if (limpo.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return { logradouro: d.logradouro, bairro: d.bairro, cidade: d.localidade, estado: d.uf };
  } catch { return null; }
}

// Máscara monetária: dígitos vão andando, sempre 2 casas decimais
export function maskMoneyBR(input) {
  let v = (input.value || '').replace(/\D/g, '');
  if (!v) { input.value = ''; return; }
  v = v.replace(/^0+/, '') || '0';
  while (v.length < 3) v = '0' + v;
  const inteiro = v.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  input.value = inteiro + ',' + v.slice(-2);
}

export function parseMoneyBR(s) {
  if (!s) return 0;
  const t = String(s).replace(/\./g, '').replace(',', '.');
  return parseFloat(t) || 0;
}

export function moneyToInput(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function previewFoto(input, previewId, placeholderId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById(previewId);
    prev.src = e.target.result;
    prev.style.display = 'block';
    document.getElementById(placeholderId).style.display = 'none';
  };
  reader.readAsDataURL(file);
}
