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

// Regra (pedido do dono): silenciar as mensagens de SUCESSO/CONFIRMAÇÃO — elas
// apareciam o tempo todo e incomodavam. Erros e avisos de validação continuam
// aparecendo para todos (a revendedora precisa deles). A classificação é por
// palavra-chave e ENVIESADA PARA MOSTRAR: na dúvida, aparece; só some quando é
// claramente uma confirmação. Para forçar exibir algo, passe tipo 'erro'.
const RE_ALERTA  = /erro|falh|inv[aá]lid|n[aã]o |sem |informe|preench|selecion|obrigat|tente|permit|escolh|digite|confir|limite|vazi|j[aá] existe|expir|negad|duplicat|nenhum|conex|precis|falta|inesperad/i;
const RE_SUCESSO = /salv|registrad|adicionad|exclu[ií]d|deletad|remov|enviad|atualizad|importad|copiad|conclu|aprovad|resgatad|movid|finalizad|encerrad|gerad|duplicad|criad|marcad|desativad|ativad/i;

export function toast(msg, tipo) {
  const t = document.getElementById('toast');
  if (!t) return;
  const m = String(msg || '');
  if (tipo !== 'erro') {
    const ehAlerta = RE_ALERTA.test(m);
    const ehSucesso = !ehAlerta && (RE_SUCESSO.test(m) || /!\s*$/.test(m));
    if (ehSucesso) return;   // silencia confirmações
  }
  t.textContent = m; t.classList.add('show');
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

// 'YYYY-MM-DD' de hoje em hora LOCAL (não UTC — evita o off-by-one perto da
// meia-noite que `new Date().toISOString()` causa, já que o Brasil é UTC-3).
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function mesLabel(ym) { const [y, m] = ym.split('-'); return `${MESES[+m - 1].toUpperCase()} ${y}`; }

export function mesRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { ini: `${ym}-01`, fim: `${ym}-${String(ult).padStart(2, '0')}` };
}

export function mesShift(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Avança uma data (ISO) em k períodos. Semanal = +7k dias; mensal/parcelado =
// +k meses; anual = +12k meses (clamp de fim de mês, 31→28/30); personalizada
// usa opts.intervalo (padrão 1) sobre opts.unidade ('dia'|'semana'|'mes'|'ano').
export const REC_LABEL = { mensal: 'Mensal', semanal: 'Semanal', anual: 'Anual', parcelado: 'Parcelado', personalizada: 'Personalizada' };

// Rótulo da unidade da recorrência personalizada, singular/plural pelo intervalo.
const UNIDADE_LABEL = { dia: ['dia', 'dias'], semana: ['semana', 'semanas'], mes: ['mês', 'meses'], ano: ['ano', 'anos'] };
export function rotuloUnidade(unidade, n) { const p = UNIDADE_LABEL[unidade]; return p ? p[n === 1 ? 0 : 1] : (unidade || ''); }

export function somarPeriodo(iso, tipo, k, opts = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  if (tipo === 'semanal') {
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + 7 * k);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  }
  if (tipo === 'personalizada') {
    const intervalo = Math.max(1, Number(opts.intervalo) || 1);
    const passo = intervalo * k;
    const unidade = opts.unidade || 'mes';
    if (unidade === 'dia' || unidade === 'semana') {
      const dias = unidade === 'semana' ? passo * 7 : passo;
      const base = new Date(y, m - 1, d);
      base.setDate(base.getDate() + dias);
      return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    }
    const meses = unidade === 'ano' ? passo * 12 : passo;
    const alvo = new Date(y, m - 1 + meses, 1);
    const ult = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    const dd = Math.min(d, ult);
    return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const meses = tipo === 'anual' ? 12 * k : k;
  const alvo = new Date(y, m - 1 + meses, 1);
  const ult = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  const dd = Math.min(d, ult);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Debounce simples para inputs de busca (~250ms).
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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

// ── Telefone / WhatsApp ────────────────────────────────────────────────
// ATENÇÃO: a MESMA regra vive no banco (migração 0038: tel_normalizado /
// tel_br_valido). Mudou aqui, mude lá — o telefone é a CHAVE de identidade
// da cliente (clientes.celular unique) e da cartela de fidelidade, então
// telefone falso funde pessoas diferentes na mesma cartela.
export function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

// DDDs válidos no Brasil (plano de numeração ANATEL).
const DDDS_BR = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

// Desligue se algum número REAL da base for reprovado por causa da faixa móvel.
const EXIGIR_FAIXA_MOVEL = true;

// Formato canônico: só dígitos, sem DDI 55. É o ÚNICO formato que gravamos —
// sem isso a mesma pessoa vira dois cadastros (um com 55, outro sem).
export function telNormalizado(tel) {
  const d = soDigitos(tel);
  if (d.length === 12 || d.length === 13) {
    if (d.slice(0, 2) === '55') return d.slice(2) || null;
  }
  return d || null;
}

const seqObvia = s => {
  let cres = true, decr = true;
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) + 1) cres = false;
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) - 1) decr = false;
  }
  return cres || decr;
};

// Telefone BR de verdade: 10 (fixo) ou 11 (celular) dígitos, DDD existente,
// nono dígito no celular, e sem os padrões clássicos de número inventado.
export function telValido(tel) {
  const d = telNormalizado(tel);
  if (!d || (d.length !== 10 && d.length !== 11)) return false;
  if (/^(\d)\1+$/.test(d)) return false;                 // 00000000000
  if (!DDDS_BR.has(d.slice(0, 2))) return false;         // DDD 00, 20, 23...

  const num = d.slice(2);
  let corpo;
  if (num.length === 9) {
    if (num[0] !== '9') return false;                    // nono dígito
    if (EXIGIR_FAIXA_MOVEL && !'6789'.includes(num[1])) return false;
    corpo = num.slice(1);
  } else {
    if (!'2345'.includes(num[0])) return false;          // fixo
    corpo = num;
  }
  if (/^(\d)\1+$/.test(corpo)) return false;             // (11) 90000-0000
  if (seqObvia(corpo)) return false;                     // (11) 91234-5678
  return true;
}

// Formata a partir do canônico (antes quebrava com números com DDI).
export function telFmt(tel) {
  const d = telNormalizado(tel);
  if (!d) return '—';
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// Número para o wa.me. Só devolve algo se o telefone for VÁLIDO — assim
// waMeLink (e todo mundo que depende dele) para de gerar link quebrado.
export function telWa55(tel) {
  if (!telValido(tel)) return null;
  return '55' + telNormalizado(tel);
}
export function waMeLink(tel, msg) {
  const n = telWa55(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(msg || '')}` : null;
}
