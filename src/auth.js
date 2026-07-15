// Autenticacao, sessao, papeis de acesso e cadastro/recuperacao de senha.
import { sb } from './supabase.js';
import { state } from './state.js';
import { sbQ, showMsg, toast, handleSupabaseError, openModal, closeModal } from './utils.js';
import { carregarPermissoes, renderSidebar } from './menu.js';
import { iniciarRoteamento } from './nav.js';
export function mostrarRecovery() {
  state.recoveryAtiva = true;
  document.getElementById('splash').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('recovery-screen').style.display = 'flex';
  setTimeout(() => { const el = document.getElementById('recovery-senha'); if (el) el.focus(); }, 100);
}

// ── Níveis de acesso ──────────────────────────────────────────────
// revendedora | func_basico | func_completo | admin
export const ROLE_LABELS = {
  revendedora:   'Revendedora',
  func_basico:   'Funcionário – básico',
  func_completo: 'Funcionário – completo',
  admin:         'Admin total'
};

export function ehAdmin()  { return state.currentProfile?.role === 'admin'; }

export function ehGestor() { return ['admin','func_completo'].includes(state.currentProfile?.role); }

export function ehStaff()  { return ['admin','func_completo','func_basico'].includes(state.currentProfile?.role); }

export async function loadUser(user) {
  state.currentUser = user;
  let { data: profile } = await sbQ(sb.from('profiles').select('*').eq('id', user.id).single());

  if (!profile) { showSplash(); return; }

  // Funcionário: no 1º login o profile nasce como 'revendedora' pendente
  // (handle_new_user). Vincula pelo e-mail e promove o papel ANTES do gate de
  // aprovação, pra não travar na tela "aguardando" nem cair na lista de
  // Revendedoras. Não-funcionário: RPC retorna null e segue o fluxo normal.
  if (profile.role === 'revendedora') {
    const { data: novoRole } = await sbQ(sb.rpc('fn_vincular_funcionario'));
    if (novoRole && novoRole !== 'revendedora') profile = { ...profile, role: novoRole, aprovada: true };
  }
  state.currentProfile = profile;

  if (profile.role === 'revendedora' && !profile.aprovada) {
    document.getElementById('splash').style.display = 'none';
    document.getElementById('pending-screen').style.display = 'flex';
    return;
  }

  document.getElementById('splash').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.flexDirection = 'column';

  const ehRevendedora = profile.role === 'revendedora';
  const icone = '';
  const nomeBadge = ehRevendedora ? profile.nome.split(' ')[0] : (ROLE_LABELS[profile.role] || profile.nome.split(' ')[0]);
  document.getElementById('user-badge').textContent = nomeBadge;

  // Visibilidade por nível. Pagamentos/Histórico são do próprio (só revendedora).
  document.getElementById('btn-bling-sync').style.display = (ehRevendedora || ehGestor()) ? 'block' : 'none';
  document.getElementById('btn-pdf-mostruario').style.display = (ehRevendedora || ehGestor()) ? 'inline-flex' : 'none';
  document.getElementById('btn-novo-consig').style.display = ehGestor() ? 'block' : 'none';
  document.getElementById('nav-admin').style.display = ehGestor() ? 'flex' : 'none';
  document.getElementById('nav-trocas').style.display = ehStaff() ? 'flex' : 'none';
  document.getElementById('nav-pagamentos').style.display = ehRevendedora ? 'flex' : 'none';
  document.getElementById('nav-historico').style.display = ehRevendedora ? 'flex' : 'none';
  // Dashboard PC (barra lateral) só para staff; o CSS faz o resto em telas >=900px.
  document.getElementById('app').classList.toggle('staff-desktop', ehStaff());

  // Permissões por perfil ANTES de montar a sidebar (uma vez por login).
  if (ehStaff()) await carregarPermissoes();
  renderSidebar();

  // Liga o roteador por hash e resolve a URL atual: se veio de um link
  // direto/F5 (#/produtos), abre aquela tela (com guard de papel); se não,
  // cai no painel inicial permitido. Faz o "voltar" do navegador funcionar.
  iniciarRoteamento();

  // Primeiro acesso de revendedora sem telefone: pede o WhatsApp (trocas).
  if (ehRevendedora && !(profile.telefone && profile.telefone.trim())) {
    abrirComplementoCadastro();
  }
}

export function maskTelBR(el) {
  const v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 6)      el.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  else if (v.length > 2) el.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
  else if (v.length > 0) el.value = `(${v}`;
  else                   el.value = '';
}

export function abrirComplementoCadastro() {
  document.getElementById('comp-tel').value = state.currentProfile.telefone || '';
  document.getElementById('comp-cidade').value = state.currentProfile.cidade || '';
  openModal('modal-complemento');
}

export async function salvarComplemento(btn) {
  const tel = document.getElementById('comp-tel').value.trim();
  const cidade = document.getElementById('comp-cidade').value.trim();
  if (tel.replace(/\D/g, '').length < 10) { toast('Informe um WhatsApp válido com DDD'); return; }
  btn.disabled = true; btn.textContent = 'Salvando...';
  const { error } = await sbQ(sb.from('profiles').update({ telefone: tel, cidade: cidade || null }).eq('id', state.currentUser.id));
  btn.disabled = false; btn.textContent = 'Salvar e continuar';
  if (await handleSupabaseError(error, 'Erro ao salvar')) return;
  state.currentProfile.telefone = tel;
  state.currentProfile.cidade = cidade || null;
  closeModal('modal-complemento');
  toast('Tudo certo!');
}

export function showSplash() {
  document.getElementById('splash').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
}

export function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='cadastro')));
  document.getElementById('tab-login').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('tab-cadastro').style.display = tab === 'cadastro' ? 'flex' : 'none';
}

export async function fazerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const msg = document.getElementById('login-msg');
  if (!email || !senha) { showMsg(msg, 'Preencha todos os campos', 'error'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) { showMsg(msg, 'E-mail ou senha incorretos', 'error'); }
}

// Mostra o painel embutido de recuperacao (sem prompt, que e bloqueado em PWA).
export function mostrarRecuperar() {
  document.getElementById('tab-login').style.display = 'none';
  document.getElementById('tab-cadastro').style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'none';
  document.getElementById('tab-recuperar').style.display = 'flex';
  document.getElementById('rec-msg').style.display = 'none';
  document.getElementById('rec-email').value = document.getElementById('login-email').value.trim();
  setTimeout(() => document.getElementById('rec-email').focus(), 50);
}

export function voltarLogin() {
  document.getElementById('tab-recuperar').style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'flex';
  switchTab('login');
}

export async function loginGoogle() {
  // O retorno do OAuth volta no hash (#access_token) e e processado pelo
  // supabase-js -> evento SIGNED_IN -> loadUser. O codigo de recovery so
  // intercepta type=recovery, entao nao conflita.
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) toast('Erro ao conectar com o Google');
}

export async function enviarLinkRecuperacao(btn) {
  const msg = document.getElementById('rec-msg');
  const email = document.getElementById('rec-email').value.trim();
  if (!email) { showMsg(msg, 'Digite seu e-mail', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  btn.disabled = false; btn.textContent = 'Enviar link de recuperação';
  if (error) { showMsg(msg, 'Erro ao enviar. Confira o e-mail e tente de novo.', 'error'); return; }
  showMsg(msg, 'Link enviado para ' + email + '. Confira sua caixa de entrada (e o spam).', 'success');
}

// Chamado na tela de nova senha (apos clicar no link do e-mail de recuperacao).
export async function salvarNovaSenha(btn) {
  const msg = document.getElementById('recovery-msg');
  const nova = document.getElementById('recovery-senha').value;
  if (nova.length < 6) { showMsg(msg, 'A senha deve ter ao menos 6 caracteres', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Salvando...';
  const { error } = await sb.auth.updateUser({ password: nova });
  btn.disabled = false; btn.textContent = 'Salvar nova senha';
  if (error) {
    showMsg(msg, 'Erro ao salvar a senha. O link pode ter expirado — peça um novo.', 'error');
    return;
  }
  // Limpa o hash de recuperacao da URL e entra no app com a nova senha.
  history.replaceState(null, '', location.pathname);
  state.recoveryAtiva = false;
  document.getElementById('recovery-screen').style.display = 'none';
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await loadUser(session.user); }
  else { showSplash(); showMsg(document.getElementById('login-msg'), 'Senha alterada! Entre com a nova senha.', 'success'); }
}

export async function fazerCadastro() {
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim();
  const tel = document.getElementById('cad-tel').value.trim();
  const cidade = document.getElementById('cad-cidade').value.trim();
  const senha = document.getElementById('cad-senha').value;
  const msg = document.getElementById('cad-msg');

  if (!nome || !email || !senha) { showMsg(msg, 'Preencha nome, e-mail e senha', 'error'); return; }
  if (senha.length < 6) { showMsg(msg, 'Senha deve ter ao menos 6 caracteres', 'error'); return; }

  // Manda nome/telefone/cidade nos metadados: o trigger handle_new_user
  // (db-functions.sql) cria o profile mesmo sem sessao (confirmacao de e-mail).
  const { data, error } = await sb.auth.signUp({
    email, password: senha,
    options: { data: { nome, telefone: tel, cidade } }
  });
  if (error) { showMsg(msg, error.message, 'error'); return; }

  // Fallback: se houver sessao (confirmacao de e-mail desligada), garante o
  // profile pelo cliente. ignoreDuplicates evita conflito com o trigger.
  if (data.user) {
    const { error: pErr } = await sb.from('profiles').upsert({
      id: data.user.id, role: 'revendedora', is_revendedora: true,
      nome, telefone: tel, cidade, aprovada: false
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (pErr && !data.session) {
      // Sem sessao: o trigger e quem cria o profile; erro de RLS aqui e esperado.
      console.warn('Profile via cliente falhou (trigger deve criar):', pErr.message);
    } else if (pErr) {
      console.error('Erro ao criar profile:', pErr.message);
      showMsg(msg, 'Conta criada, mas houve um problema no cadastro. Fale com a Lizzie.', 'error');
      return;
    }
  }
  showMsg(msg, 'Cadastro enviado! Aguarde aprovação da Lizzie.', 'success');
}
