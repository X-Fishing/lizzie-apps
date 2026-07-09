// Cadastro de Funcionários + Perfis & Permissões (só admin).
// Aba 1: funcionários (nome, e-mail, perfil, admin, ativo).
// Aba 2: perfis com checklist das chaves do MENU (granularidade só-ver-menu).
import { sb } from './supabase.js';
import { esc, toast, sbQ, confirmarAcao, handleSupabaseError, openModal, closeModal } from './utils.js';
import { MENU, ACOES, IS_ADMIN } from './menu.js';

const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_EMPTY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
const IC_LOCK  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

// Erro do Supabase sempre visível (toast + console), nunca engolido.
// RLS negada = o admin logado não está vinculado em funcionarios (ver
// comentário "Diagnóstico" no fim da migração 0001).
async function surfarErro(error, contexto) {
  if (!error) return false;
  console.error(contexto, error);
  if (/row-level security/i.test(error.message || '')) {
    toast(contexto + ': acesso negado (RLS). Seu usuário admin não está vinculado em funcionarios — veja o diagnóstico na migração 0001.');
    return true;
  }
  return handleSupabaseError(error, `${contexto}: ${error.message || 'erro inesperado'}`);
}

let FUNCS = [], PERFIS = [];
let tabAtual = 'func';
let perfilAberto = null;          // id do perfil com checklist aberto
let permsPerfil = new Set();      // chaves marcadas do perfil aberto

const panel = () => document.getElementById('panel-funcionarios');

export async function loadFuncionarios() {
  if (!IS_ADMIN) {
    panel().innerHTML = '<div class="empty-state"><div class="empty-icon">' + IC_LOCK + '</div><p>Área restrita ao administrador.</p></div>';
    return;
  }
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const [fRes, pRes] = await Promise.all([
    sbQ(sb.from('funcionarios').select('*').order('nome')),
    sbQ(sb.from('perfis').select('*').order('nome')),
  ]);
  if (fRes.error || pRes.error) {
    panel().innerHTML = '<div class="empty-state"><div class="empty-icon">' + IC_EMPTY + '</div><p>Erro ao carregar. Já rodou a migração <b>0001_perfis_permissoes.sql</b> no Supabase?</p></div>';
    return;
  }
  FUNCS = fRes.data || [];
  PERFIS = pRes.data || [];
  render();
}

export function funcTab(tab) { tabAtual = tab; perfilAberto = null; render(); }

function render() {
  const tabs = `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-sm ${tabAtual === 'func' ? 'btn-primary' : 'btn-secondary'}" onclick="funcTab('func')">Funcionários</button>
      <button class="btn-sm ${tabAtual === 'perfis' ? 'btn-primary' : 'btn-secondary'}" onclick="funcTab('perfis')">Perfis &amp; Permissões</button>
    </div>`;
  panel().innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <div class="section-title">Funcionários</div>
        <div class="section-subtitle">Cadastro de funcionários e níveis de acesso</div>
      </div>
      ${tabAtual === 'func'
        ? `<button class="btn-primary btn-sm" onclick="funcNovo()">${IC_PLUS} Novo funcionário</button>`
        : `<button class="btn-primary btn-sm" onclick="perfilNovo()">${IC_PLUS} Novo perfil</button>`}
    </div>
    ${tabs}
    ${tabAtual === 'func' ? renderFuncs() : renderPerfis()}`;
}

// ── Aba Funcionários ─────────────────────────────────────────────────
function renderFuncs() {
  const opcoesPerfil = f => `<option value="">— sem perfil —</option>` +
    PERFIS.map(p => `<option value="${p.id}" ${f.perfil_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
  const rows = FUNCS.length ? FUNCS.map(f => `
    <tr class="ciclo-row" style="${f.ativo ? '' : 'opacity:.55'}">
      <td class="ciclo-td"><span class="ciclo-desc">${esc(f.nome)}</span>${f.auth_user_id ? '' : ' <span class="badge badge-aberta" style="font-size:10px" title="Vincula no 1º login com este e-mail">não vinculado</span>'}</td>
      <td class="ciclo-td">${esc(f.email || '—')}</td>
      <td class="ciclo-td"><select class="form-control" style="padding:5px 8px;font-size:12.5px;width:auto" ${f.is_admin ? 'disabled title="Admin tem acesso total"' : ''}
        onchange="funcUpdate('${f.id}','perfil_id',this.value||null)">${opcoesPerfil(f)}</select></td>
      <td class="ciclo-td" style="text-align:center"><input type="checkbox" ${f.is_admin ? 'checked' : ''} onchange="funcUpdate('${f.id}','is_admin',this.checked)"></td>
      <td class="ciclo-td" style="text-align:center"><input type="checkbox" ${f.ativo ? 'checked' : ''} onchange="funcUpdate('${f.id}','ativo',this.checked)"></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="funcEditar('${f.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="funcExcluir('${f.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="6"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhum funcionário ainda</p></div></td></tr>`;
  return `<div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Nome</th><th class="pag-th">E-mail</th><th class="pag-th">Perfil</th>
      <th class="pag-th" style="text-align:center">Admin</th><th class="pag-th" style="text-align:center">Ativo</th>
      <th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function abrirFormFunc(f) {
  const r = f || {};
  document.getElementById('cad-modal-titulo').textContent = f ? 'Editar funcionário' : 'Novo funcionário';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="func-f-nome" class="form-control" value="${esc(r.nome || '')}"></div>
    <div class="form-group"><label class="form-label">E-mail (o mesmo do login) *</label>
      <input type="text" id="func-f-email" class="form-control" value="${esc(r.email || '')}"></div>
    <div class="form-group"><label class="form-label">Perfil</label>
      <select id="func-f-perfil" class="form-control"><option value="">— sem perfil —</option>
      ${PERFIS.map(p => `<option value="${p.id}" ${r.perfil_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
    <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="func-f-admin" ${r.is_admin ? 'checked' : ''} style="width:auto"> Admin (acesso total)</label>
    <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="func-f-ativo" ${(r.ativo ?? true) ? 'checked' : ''} style="width:auto"> Ativo</label>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `funcSalvar(${f ? `'${r.id}'` : 'null'})`);
  openModal('modal-cadastro');
}

export function funcNovo() { abrirFormFunc(null); }
export function funcEditar(id) { abrirFormFunc(FUNCS.find(x => x.id === id)); }

export async function funcSalvar(id) {
  const nome = document.getElementById('func-f-nome').value.trim();
  const email = document.getElementById('func-f-email').value.trim().toLowerCase() || null;
  if (!nome) { toast('Nome é obrigatório'); return; }
  if (!email) { toast('E-mail é obrigatório (é por ele que o acesso é vinculado)'); return; }
  const payload = {
    nome, email,
    perfil_id: document.getElementById('func-f-perfil').value || null,
    is_admin: document.getElementById('func-f-admin').checked,
    ativo: document.getElementById('func-f-ativo').checked,
  };
  const q = id ? sb.from('funcionarios').update(payload).eq('id', id) : sb.from('funcionarios').insert(payload);
  const { error } = await sbQ(q);
  if (error) {
    if (/duplicate key|unique/i.test(error.message || '')) { toast('Já existe funcionário com esse e-mail.'); return; }
    if (await surfarErro(error, 'Erro ao salvar')) return;
  }
  toast('Salvo!');
  closeModal('modal-cadastro');
  loadFuncionarios();
}

// Atualização rápida direto da lista (perfil / admin / ativo).
export async function funcUpdate(id, campo, valor) {
  const { error } = await sbQ(sb.from('funcionarios').update({ [campo]: valor }).eq('id', id));
  if (error) { if (await surfarErro(error, 'Erro ao salvar')) { loadFuncionarios(); return; } }
  const f = FUNCS.find(x => x.id === id);
  if (f) f[campo] = valor;
  if (campo === 'is_admin') render();   // trava/destrava o select de perfil
  toast('Salvo!');
}

export function funcExcluir(id) {
  const f = FUNCS.find(x => x.id === id);
  confirmarAcao('Excluir funcionário', `Excluir "${f?.nome || ''}"? Isso não pode ser desfeito.`, 'Excluir', async () => {
    const { error } = await sbQ(sb.from('funcionarios').delete().eq('id', id));
    if (error) { if (await surfarErro(error, 'Erro ao excluir')) return; }
    toast('Excluído.');
    loadFuncionarios();
  });
}

// ── Aba Perfis & Permissões ──────────────────────────────────────────
function renderPerfis() {
  const lista = PERFIS.length ? PERFIS.map(p => `
    <tr class="ciclo-row">
      <td class="ciclo-td" style="cursor:pointer" onclick="perfilAbrir('${p.id}')">
        <span class="ciclo-desc">${esc(p.nome)}</span>
        ${p.is_sistema ? ` <span class="badge badge-aberta" style="font-size:10px">${IC_LOCK} sistema</span>` : ''}
        ${p.descricao ? `<div style="font-size:12px;color:var(--muted)">${esc(p.descricao)}</div>` : ''}
      </td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        ${p.is_sistema ? '' : `
          <button class="btn-icon" title="Renomear" onclick="perfilEditar('${p.id}')" style="color:var(--rose)">${IC_EDIT}</button>
          <button class="btn-icon" title="Excluir" onclick="perfilExcluir('${p.id}')" style="color:var(--danger)">${IC_TRASH}</button>`}
        <button class="btn-secondary btn-sm" onclick="perfilAbrir('${p.id}')">Permissões</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="2"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhum perfil ainda</p></div></td></tr>`;
  return `<div class="pag-wrap"><table class="pag-table"><tbody>${lista}</tbody></table></div>
    <div id="perfil-checklist" style="margin-top:16px">${perfilAberto ? '<div class="loading"><div class="spinner">⟳</div></div>' : ''}</div>`;
}

// Checklist agrupado seguindo o MENU (Vendas, Cadastros...).
function renderChecklist(perfil) {
  const bloqueado = perfil.is_sistema;
  const grupos = [];
  let soltos = [];
  MENU.forEach(m => {
    if (m.filhos) {
      if (soltos.length) { grupos.push({ titulo: 'Geral', itens: soltos }); soltos = []; }
      grupos.push({ titulo: m.secao || m.label, itens: m.filhos });
    } else soltos.push(m);
  });
  if (soltos.length) grupos.push({ titulo: 'Geral', itens: soltos });
  grupos.push({ titulo: 'Ações especiais', itens: ACOES });

  const check = i => `
    <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:4px 0">
      <input type="checkbox" data-chave="${i.chave}" ${permsPerfil.has(i.chave) ? 'checked' : ''}
        ${bloqueado || i.admin_only ? 'disabled' : ''} style="width:auto">
      ${i.label}${i.em_breve ? ' <span class="badge-soon">Em breve</span>' : ''}${i.admin_only ? ' <span class="badge-soon">Só admin</span>' : ''}
    </label>`;

  document.getElementById('perfil-checklist').innerHTML = `
    <div class="dash-card">
      <h3>Permissões — ${esc(perfil.nome)} ${bloqueado ? `<span class="badge-soon">${IC_LOCK} perfil de sistema (acesso total, não editável)</span>` : ''}</h3>
      <div class="dash-sub">Marque o que este perfil pode ver no menu.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:12px">
        ${grupos.map(g => `<div><div style="font-weight:600;font-size:12px;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">${esc(g.titulo)}</div>${g.itens.map(check).join('')}</div>`).join('')}
      </div>
      ${bloqueado ? '' : `<div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn-primary btn-sm" onclick="perfilSalvarPermissoes('${perfil.id}')">Salvar permissões</button>
        <button class="btn-secondary btn-sm" onclick="funcTab('perfis')">Fechar</button>
      </div>`}
    </div>`;
}

export async function perfilAbrir(id) {
  perfilAberto = id;
  const perfil = PERFIS.find(p => p.id === id);
  if (!perfil) return;
  if (!document.getElementById('perfil-checklist')) render();
  const { data, error } = await sbQ(sb.from('perfil_permissoes').select('chave_menu').eq('perfil_id', id));
  if (error) { if (await surfarErro(error, 'Erro ao carregar permissões')) return; }
  permsPerfil = new Set((data || []).map(r => r.chave_menu));
  renderChecklist(perfil);
}

export async function perfilSalvarPermissoes(perfilId) {
  const chaves = [...document.querySelectorAll('#perfil-checklist input[data-chave]:checked')].map(c => c.dataset.chave);
  const { error: e1 } = await sbQ(sb.from('perfil_permissoes').delete().eq('perfil_id', perfilId));
  if (e1) { if (await surfarErro(e1, 'Erro ao salvar permissões')) return; }
  if (chaves.length) {
    const { error: e2 } = await sbQ(sb.from('perfil_permissoes')
      .insert(chaves.map(c => ({ perfil_id: perfilId, chave_menu: c }))));
    if (e2) { if (await surfarErro(e2, 'Erro ao salvar permissões')) return; }
  }
  toast('Permissões salvas! Valem no próximo login do funcionário.');
}

function abrirFormPerfil(p) {
  const r = p || {};
  document.getElementById('cad-modal-titulo').textContent = p ? 'Editar perfil' : 'Novo perfil';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="perfil-f-nome" class="form-control" value="${esc(r.nome || '')}"></div>
    <div class="form-group"><label class="form-label">Descrição</label>
      <input type="text" id="perfil-f-desc" class="form-control" value="${esc(r.descricao || '')}"></div>
    <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="perfil-f-ativo" ${(r.ativo ?? true) ? 'checked' : ''} style="width:auto"> Ativo</label>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `perfilSalvar(${p ? `'${r.id}'` : 'null'})`);
  openModal('modal-cadastro');
}

export function perfilNovo() { abrirFormPerfil(null); }
export function perfilEditar(id) {
  const p = PERFIS.find(x => x.id === id);
  if (p?.is_sistema) { toast('Perfil de sistema não pode ser editado.'); return; }
  abrirFormPerfil(p);
}

export async function perfilSalvar(id) {
  const nome = document.getElementById('perfil-f-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório'); return; }
  const payload = {
    nome,
    descricao: document.getElementById('perfil-f-desc').value.trim() || null,
    ativo: document.getElementById('perfil-f-ativo').checked,
  };
  const q = id ? sb.from('perfis').update(payload).eq('id', id) : sb.from('perfis').insert(payload);
  const { error } = await sbQ(q);
  if (error) {
    if (/duplicate key|unique/i.test(error.message || '')) { toast('Já existe um perfil com esse nome.'); return; }
    if (await surfarErro(error, 'Erro ao salvar perfil')) return;
  }
  toast('Salvo!');
  closeModal('modal-cadastro');
  loadFuncionarios();
}

export function perfilExcluir(id) {
  const p = PERFIS.find(x => x.id === id);
  if (p?.is_sistema) { toast('Perfil de sistema não pode ser excluído.'); return; }
  const emUso = FUNCS.filter(f => f.perfil_id === id).length;
  const aviso = emUso
    ? ` ${emUso} funcionário${emUso > 1 ? 's ficam' : ' fica'} SEM permissões até receber outro perfil.`
    : ' Funcionários com esse perfil ficam sem permissões.';
  confirmarAcao('Excluir perfil', `Excluir "${p?.nome || ''}"?${aviso}`, 'Excluir', async () => {
    const { error } = await sbQ(sb.from('perfis').delete().eq('id', id).eq('is_sistema', false));
    if (error) { if (await surfarErro(error, 'Erro ao excluir')) return; }
    toast('Excluído.');
    loadFuncionarios();
  });
}
