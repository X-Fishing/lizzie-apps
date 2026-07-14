// Revendedoras: cadastro completo (grid + formulário criar/editar) e gestão
// (aprovar/revogar/papéis/Bling/teste/excluir). Dados sensíveis (CPF/RG/
// nascimento/fiador) vivem em revendedora_docs (RLS só gestor — LGPD).
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, toast, handleSupabaseError,
         maskCpf, maskCep, cpfValido, buscarCep, maskDateBR, isoToBR, brToISO, hojeBR } from './utils.js';
import { ROLE_LABELS, maskTelBR } from './auth.js';
import { carregarProximasTrocas, compararPorTroca, atualizarBadgesTroca } from './trocas.js';

const IC_PLUS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

const panelAdmin = () => document.getElementById('panel-admin');

// Cadastro considerado incompleto p/ contrato: falta CPF, nascimento ou endereço.
function revIncompleta(r) {
  const d = r._doc || {};
  return !d.cpf || !d.data_nascimento || !(r.logradouro && r.cidade);
}
// Gancho p/ "Gerar Contrato" (Prompt 2): true quando tem o essencial.
export function cadastroCompletoParaContrato(r, doc) {
  const d = doc || r?._doc || {};
  return !!(r?.nome && d.cpf && r?.logradouro && r?.cidade);
}

export async function loadAdmin() {
  panelAdmin().innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <div class="section-title">Revendedoras</div>
        <div class="section-subtitle">Cadastro e gestão de acesso</div>
      </div>
      ${ehGestor() ? `<button class="btn-primary btn-sm" onclick="novaRevendedora()">${IC_PLUS} Nova revendedora</button>` : ''}
    </div>
    <div id="pendentes-list"></div>
    <div id="rev-list"><div class="loading"><div class="spinner">⟳</div><br>Carregando...</div></div>`;

  const [{ data: pendentes, error: e1 }, { data: aprovadas, error: e2 }, { data: funcs }, { data: docs }] = await Promise.all([
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',false).order('created_at')),
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',true).order('nome')),
    sbQ(sb.from('funcionarios').select('auth_user_id')),
    // Só gestor/admin recebem (RLS). func_basico → erro/vazio → sem selo, sem quebrar.
    sbQ(sb.from('revendedora_docs').select('profile_id,cpf,data_nascimento')),
  ]);
  if (e1 || e2) {
    const msg = (e1||e2).message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar revendedoras.';
    document.getElementById('rev-list').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }

  const funcIds = new Set((funcs || []).map(f => f.auth_user_id).filter(Boolean));
  const docMap = new Map((docs || []).map(d => [String(d.profile_id), d]));
  const prep = lista => (lista || []).filter(r => !funcIds.has(r.id)).map(r => ({ ...r, _doc: docMap.get(String(r.id)) || null }));
  const pendentesRev = prep(pendentes);

  const pendDiv = document.getElementById('pendentes-list');
  if (pendentesRev.length) {
    pendDiv.innerHTML = `<div class="alert alert-warning"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> ${pendentesRev.length} cadastro${pendentesRev.length>1?'s':''} aguardando aprovação</div>` +
      pendentesRev.map(r => renderRevCard(r, true)).join('');
  } else pendDiv.innerHTML = '';

  state.aprovadasCache = prep(aprovadas);
  await renderAprovadas();
}

export async function renderAprovadas() {
  const revDiv = document.getElementById('rev-list');
  if (!revDiv) return;
  if (!state.aprovadasCache.length) {
    revDiv.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><p>Nenhuma revendedora aprovada</p></div>';
    return;
  }
  if (state.ordemTrocaProxima && !state.proximaTrocaCarregado) {
    revDiv.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando próximas trocas...</div>';
    await carregarProximasTrocas();
  }
  const lista = state.ordemTrocaProxima ? [...state.aprovadasCache].sort(compararPorTroca) : state.aprovadasCache;
  const btnLabel = state.ordemTrocaProxima ? '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg> Ordem alfabética' : '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Trocas próximas';
  revDiv.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">
        ${state.aprovadasCache.length} revendedora${state.aprovadasCache.length!==1?'s':''} ativas<span id="troca-count"></span>
      </div>
      <button class="btn-secondary btn-sm" style="font-size:11px;white-space:nowrap" onclick="toggleOrdemTroca()">${btnLabel}</button>
    </div>` +
    lista.map(r => renderRevCard(r, false)).join('');
  atualizarBadgesTroca();
}

export function renderRevCard(r, pendente) {
  const inicial = r.nome.charAt(0).toUpperCase();
  const local = [r.cidade, r.estado].filter(Boolean).join('/') || 'Cidade não informada';
  const trocaSlot = pendente ? '' : `<div data-troca-bling-id="${r.bling_contato_id || ''}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><span style="font-size:11px;color:var(--muted)">Carregando próxima troca...</span></div>`;
  const seloIncompleto = revIncompleta(r)
    ? '<span class="badge-soon" style="background:var(--warning);color:#fff;margin-left:6px" title="Falta CPF, nascimento ou endereço">Cadastro incompleto</span>' : '';
  return `<div class="card rev-card" onclick="abrirFormRev('${r.id}')">
    <div class="rev-header">
      <div class="rev-avatar">${inicial}</div>
      <div>
        <div class="rev-nome">${esc(r.nome)}${r.teste ? ' <span class="badge-soon" style="background:var(--warning);color:#fff">TESTE</span>' : ''}${seloIncompleto}</div>
        <div class="rev-cidade">${esc(local)} · ${esc(r.telefone || '—')}</div>
      </div>
      <div class="rev-status">
        ${pendente ? '<span class="badge badge-pendente"><span class="pending-dot"></span>Pendente</span>' : '<span class="badge badge-ativo"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Ativa</span>'}
      </div>
    </div>
    ${trocaSlot}
  </div>`;
}

// ── Formulário criar/editar ─────────────────────────────────────────
const secH = txt => `<div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:14px;color:var(--plum);margin:22px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border)">${txt}</div>`;
const grpTxt = (id, label, val, extra = '') => `<div class="form-group"><label class="form-label">${label}</label><input type="text" id="${id}" class="form-control" value="${esc(val || '')}" ${extra}></div>`;

export function novaRevendedora() { abrirFormRev(null); }

export async function abrirFormRev(id) {
  if (id && !ehGestor()) { toast('Sem permissão'); return; }
  let r = {}, doc = {};
  if (id) {
    const [{ data: p }, { data: d }] = await Promise.all([
      sbQ(sb.from('profiles').select('*').eq('id', id).single()),
      sbQ(sb.from('revendedora_docs').select('*').eq('profile_id', id).maybeSingle()),
    ]);
    if (!p) { toast('Revendedora não encontrada'); return; }
    r = p; doc = d || {};
  }
  const gestor = ehGestor();

  const secaoDocs = gestor ? `
    ${secH('Dados pessoais')}
    <div class="form-grid">
      ${grpTxt('rev-cpf', 'CPF', doc.cpf, 'inputmode="numeric" placeholder="000.000.000-00" oninput="maskCpf(this)"')}
      ${grpTxt('rev-rg', 'RG', doc.rg)}
      ${grpTxt('rev-nasc', 'Data de nascimento', isoToBR(doc.data_nascimento), 'inputmode="numeric" placeholder="dd/mm/aaaa" oninput="maskDateBR(this)"')}
    </div>` : '';

  const secaoFiador = gestor ? `
    <details style="margin-top:18px"><summary style="cursor:pointer;font-weight:600;font-size:14px;color:var(--plum);padding:6px 0">Fiador (opcional)</summary>
    <div class="form-grid" style="margin-top:10px">
      ${grpTxt('rev-fnome', 'Nome do fiador', doc.fiador_nome)}
      ${grpTxt('rev-fcpf', 'CPF do fiador', doc.fiador_cpf, 'inputmode="numeric" placeholder="000.000.000-00" oninput="maskCpf(this)"')}
      ${grpTxt('rev-frg', 'RG do fiador', doc.fiador_rg)}
      ${grpTxt('rev-fend', 'Endereço do fiador', doc.fiador_endereco)}
      ${grpTxt('rev-femail', 'E-mail do fiador', doc.fiador_email)}
      ${grpTxt('rev-ftel', 'Telefone do fiador', doc.fiador_telefone, 'inputmode="numeric" oninput="maskTelBR(this)"')}
    </div></details>` : '';

  panelAdmin().innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;gap:10px">
      <button class="btn-voltar-ciclo" onclick="loadAdmin()">← Voltar</button>
      <div class="section-title" style="font-size:19px">${id ? 'Editar revendedora' : 'Nova revendedora'}</div>
    </div>

    ${secH('Identificação')}
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Nome *</label>
        <input type="text" id="rev-nome" class="form-control" value="${esc(r.nome || '')}"></div>
      ${grpTxt('rev-tel', 'Telefone celular', r.telefone, 'inputmode="numeric" placeholder="(00) 00000-0000" oninput="maskTelBR(this)"')}
      ${grpTxt('rev-email', 'E-mail', r.email, 'inputmode="email"')}
    </div>
    ${secaoDocs}

    ${secH('Endereço')}
    <div class="form-grid">
      ${grpTxt('rev-cep', 'CEP', r.cep, 'inputmode="numeric" placeholder="00000-000" oninput="maskCep(this)" onblur="revCepBlur()"')}
      ${grpTxt('rev-logradouro', 'Logradouro', r.logradouro)}
      ${grpTxt('rev-numero', 'Número', r.numero)}
      ${grpTxt('rev-complemento', 'Complemento', r.complemento)}
      ${grpTxt('rev-bairro', 'Bairro', r.bairro)}
      ${grpTxt('rev-cidade', 'Cidade', r.cidade)}
      ${grpTxt('rev-estado', 'Estado (UF)', r.estado)}
    </div>

    ${secH('Cadastro')}
    <div class="form-grid">
      ${grpTxt('rev-created', 'Data do cadastro', isoToBR(r.created_at) || hojeBR(), 'inputmode="numeric" placeholder="dd/mm/aaaa" oninput="maskDateBR(this)"')}
    </div>
    ${secaoFiador}

    <button class="btn-primary" style="width:100%;margin-top:22px" onclick="salvarRevendedora(${id ? `'${id}'` : 'null'})">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${id ? 'Salvar alterações' : 'Salvar revendedora'}</button>

    ${id && gestor ? renderGestao(r) : ''}`;
}

// Bloco de gestão dentro do form (mesmas permissões de sempre).
function renderGestao(r) {
  return `
    ${secH('Gestão')}
    <div class="form-group">
      <label class="form-label">ID do contato no Bling</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="rev-bling-id" class="form-control" placeholder="Ex: 12587268646" value="${r.bling_contato_id || ''}">
        <button class="btn-secondary btn-sm" style="white-space:nowrap" onclick="salvarBlingId('${r.id}')">Salvar</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px">
        <div style="font-size:11px;color:var(--muted)">Cole o ID que aparece ao lado do nome dela na lista de pedidos do Bling</div>
        <button class="btn-secondary btn-sm" style="white-space:nowrap;font-size:11px" data-rev-nome="${esc(r.nome || '')}" onclick="detectarBlingId('${r.id}', this.dataset.revNome)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> Detectar pelo Bling</button>
      </div>
      <div id="bling-candidatos" style="margin-top:10px"></div>
    </div>
    <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px">
      <input type="checkbox" ${r.teste ? 'checked' : ''} style="width:auto" onchange="marcarRevTeste('${r.id}', this.checked)">
      Conta de teste (não afeta faturamento/estoque)
    </label>
    ${ehAdmin() ? `
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">Nível de acesso</label>
      <select id="rev-role" class="form-control" onchange="definirPapel('${r.id}', this.value)">
        ${Object.entries(ROLE_LABELS).map(([v,l]) => `<option value="${v}" ${r.role===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="detail-actions" id="rev-actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      ${!r.aprovada
        ? `<button class="btn-primary" onclick="aprovarRev('${r.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Aprovar acesso</button>`
        : `<button class="btn-danger" onclick="revogarRev('${r.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg> Revogar acesso</button>`}
      ${ehAdmin() ? `<button class="btn-danger" data-rev-nome="${esc(r.nome || '')}" onclick="confirmarExclusaoRev('${r.id}', this)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Excluir revendedora</button>` : ''}
    </div>`;
}

// Compat: onclicks antigos (verRevendedora / Cancelar da exclusão) abrem o form.
export function verRevendedora(id) { abrirFormRev(id); }

// ViaCEP no blur do CEP — preenche só o que estiver vazio.
export async function revCepBlur() {
  const cep = document.getElementById('rev-cep')?.value;
  const info = await buscarCep(cep);
  if (!info) return;
  const setSe = (id, val) => { const el = document.getElementById(id); if (el && !el.value.trim() && val) el.value = val; };
  setSe('rev-logradouro', info.logradouro);
  setSe('rev-bairro', info.bairro);
  setSe('rev-cidade', info.cidade);
  setSe('rev-estado', info.estado);
}

export async function salvarRevendedora(id) {
  const val = elId => (document.getElementById(elId)?.value || '').trim();
  const nome = val('rev-nome');
  if (!nome) { toast('Nome é obrigatório'); return; }
  const gestor = ehGestor();

  const btn = panelAdmin().querySelector('.btn-primary[onclick^="salvarRevendedora"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  const nb = v => v || null;
  const profilePayload = {
    nome,
    telefone: nb(val('rev-tel')), email: nb(val('rev-email')),
    cep: nb(val('rev-cep')), logradouro: nb(val('rev-logradouro')), numero: nb(val('rev-numero')),
    complemento: nb(val('rev-complemento')), bairro: nb(val('rev-bairro')),
    cidade: nb(val('rev-cidade')), estado: nb(val('rev-estado')),
  };
  // Data do cadastro: só grava se o usuário mexeu (meio-dia p/ não deslizar fuso).
  const createdISO = brToISO(val('rev-created'));
  if (createdISO) profilePayload.created_at = createdISO + 'T12:00:00';

  const desfazerBtn = () => { if (btn) { btn.disabled = false; btn.textContent = id ? 'Salvar alterações' : 'Salvar revendedora'; } };

  let profileId = id;
  if (id) {
    const { error } = await sbQ(sb.from('profiles').update(profilePayload).eq('id', id));
    if (error) { desfazerBtn(); if (await handleSupabaseError(error, 'Erro ao salvar')) return; toast('Erro ao salvar'); return; }
  } else {
    const { data, error } = await sbQ(sb.from('profiles').insert({ role: 'revendedora', aprovada: true, ...profilePayload }).select('id').single());
    if (error || !data) { desfazerBtn(); if (await handleSupabaseError(error, 'Erro ao criar')) return; toast('Erro ao criar'); return; }
    profileId = data.id;
  }

  // Documentos sensíveis (só gestor). Upsert reflete o estado do form.
  if (gestor) {
    const cpf = val('rev-cpf');
    if (cpf && !cpfValido(cpf)) toast('Atenção: o CPF digitado parece inválido — salvo mesmo assim.');
    const docPayload = {
      profile_id: profileId,
      cpf: nb(cpf), rg: nb(val('rev-rg')), data_nascimento: brToISO(val('rev-nasc')),
      fiador_nome: nb(val('rev-fnome')), fiador_cpf: nb(val('rev-fcpf')), fiador_rg: nb(val('rev-frg')),
      fiador_endereco: nb(val('rev-fend')), fiador_email: nb(val('rev-femail')), fiador_telefone: nb(val('rev-ftel')),
      updated_at: new Date().toISOString(),
    };
    const { error: dErr } = await sbQ(sb.from('revendedora_docs').upsert(docPayload, { onConflict: 'profile_id' }));
    if (dErr) {
      console.error('revendedora_docs:', dErr);
      if (/revendedora_docs/i.test(dErr.message || '') && /relation|does not exist|schema cache/i.test(dErr.message || '')) {
        toast('Dados básicos salvos. CPF/RG não gravaram — rode a migração 0016 no Supabase.');
      } else { toast('Dados básicos salvos, mas houve erro nos documentos: ' + (dErr.message || '')); }
    }
  }

  toast('Revendedora salva!');
  loadAdmin();
}

// ── Gestão (aprovar/revogar/papel/teste/excluir) ────────────────────
export async function aprovarRev(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ aprovada: true }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao aprovar revendedora')) return;
  toast('Revendedora aprovada!');
  loadAdmin();
}

export async function revogarRev(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ aprovada: false }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao revogar acesso')) return;
  toast('Acesso revogado');
  loadAdmin();
}

// Liga/desliga a conta de teste (só gestor/admin).
export async function marcarRevTeste(id, teste) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ teste }).eq('id', id));
  if (error) {
    console.error('Conta de teste:', error);
    if (/teste/.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
      toast('Coluna "teste" não existe — rode a migração 0008 no Supabase.');
    } else if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) { /* já avisou */ }
    return;
  }
  if (teste) state.revTesteSet.add(String(id)); else state.revTesteSet.delete(String(id));
  toast(teste ? 'Marcada como conta de TESTE — fora dos totais.' : 'Conta voltou a contar nos totais.');
}

export async function definirPapel(id, novoPapel) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ role: novoPapel }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao definir papel')) return;
  toast('Nível atualizado: ' + (ROLE_LABELS[novoPapel] || novoPapel));
  state.blingRevs = []; state.aprovadasCache = [];
  loadAdmin();
}

export function confirmarExclusaoRev(id, btn) {
  const nome = (btn && btn.dataset.revNome) || 'esta revendedora';
  const actions = document.getElementById('rev-actions');
  if (!actions) return;
  actions.innerHTML = `
    <div style="width:100%;background:rgba(224,85,85,0.08);border:1px solid var(--danger);border-radius:12px;padding:12px;font-size:13px;color:var(--text)">
      <strong style="color:var(--danger)">Excluir ${esc(nome)} para sempre?</strong><br>
      Apaga o cadastro e <strong>todos os dados dela</strong>: catálogo (peças), garantias e vendas/pagamentos. Não dá pra desfazer.
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-danger" onclick="excluirRevendedora('${id}', this)">Sim, excluir tudo</button>
        <button class="btn-secondary" onclick="abrirFormRev('${id}')">Cancelar</button>
      </div>
    </div>`;
}

export async function excluirRevendedora(id, btn) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
  // Blindagem: não apagar o perfil de um funcionário por esta tela.
  const { data: func } = await sbQ(sb.from('funcionarios').select('id').eq('auth_user_id', id).maybeSingle());
  if (func) { toast('Esse acesso é de um funcionário — gerencie em Cadastros → Funcionários, não aqui.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Excluindo...'; }
  try {
    const { data: vendas } = await sbQ(sb.from('vendas').select('id').eq('revendedora_id', id));
    const vendaIds = (vendas || []).map(v => v.id);
    if (vendaIds.length) {
      await sbQ(sb.from('venda_itens').delete().in('venda_id', vendaIds));
      await sbQ(sb.from('recebimentos').delete().in('venda_id', vendaIds));
      await sbQ(sb.from('vendas').delete().eq('revendedora_id', id));
    }
    await sbQ(sb.from('garantias').delete().eq('revendedora_id', id));
    await sbQ(sb.from('consignados').delete().eq('revendedora_id', id));
    const { error } = await sbQ(sb.from('profiles').delete().eq('id', id));  // revendedora_docs cai por cascade
    if (error) {
      if (await handleSupabaseError(error, 'Erro ao excluir revendedora')) return;
      if (btn) { btn.disabled = false; btn.textContent = 'Sim, excluir tudo'; }
      return;
    }
  } catch (e) {
    console.error('Erro ao excluir revendedora:', e);
    toast('Erro ao excluir revendedora');
    if (btn) { btn.disabled = false; btn.textContent = 'Sim, excluir tudo'; }
    return;
  }
  toast('Revendedora excluída');
  state.blingRevs = []; state.aprovadasCache = []; state.proximaTrocaCarregado = false;
  loadAdmin();
}
