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
    ${id && gestor ? renderBotaoContrato(id, r, doc) : ''}

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

// ════════════════════════════════════════════════════════════════════
// CONTRATO DE REVENDA EM CONSIGNAÇÃO — PDF via window.print() (mesmo
// padrão do gerarPdfFechamento: injeta em #print-content, mostra o
// #print-overlay e imprime; o @media print esconde o resto do app).
// ════════════════════════════════════════════════════════════════════
const CONSIGNANTE = {
  nome: 'Lizzie Comércio e Importação de Artigos Religiosos e Semijoias Ltda.',
  cnpj: '37.690.436/0001-60',
  endereco: 'Rua Tiradentes, n.º 446, Vila Itapura, sala 23, Campinas/SP – CEP 13.023-190',
  representante: 'Lidiane Soares Figueiredo Coutinho',
  email: 'lizziesemijoias@outlook.com',
  telefone: '(19) 99580-2087',
};
const MESES_EXT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

const soDig = v => String(v || '').replace(/\D/g, '');
function fmtCpfDoc(v) {
  const d = soDig(v).slice(0, 11);
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : esc(v || '');
}
function fmtTelDoc(v) {
  const d = soDig(v);
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return esc(v || '');
}
// Endereço da revendedora numa linha só, a partir dos campos estruturados.
function enderecoRevLinha(r) {
  const partes = [];
  if (r.logradouro) partes.push(esc(r.logradouro) + (r.numero ? `, n.º ${esc(r.numero)}` : ''));
  if (r.complemento) partes.push(esc(r.complemento));
  if (r.bairro) partes.push(esc(r.bairro));
  const cidUf = [r.cidade, r.estado].filter(Boolean).map(esc).join('/');
  if (cidUf) partes.push(cidUf);
  let linha = partes.join(', ');
  if (r.cep) linha += (linha ? ' – ' : '') + 'CEP ' + esc(r.cep);
  return linha;
}

export function renderBotaoContrato(id, r, doc) {
  const ok = cadastroCompletoParaContrato(r, doc);
  const ic = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>';
  return `<button class="btn-secondary" style="width:100%;margin-top:10px${ok ? '' : ';opacity:.55'}" ${ok ? '' : 'disabled title="Complete CPF e endereço para gerar o contrato"'} onclick="gerarContrato('${id}')">${ic} Gerar Contrato</button>`;
}

export async function gerarContrato(revId) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const [{ data: r }, { data: doc }] = await Promise.all([
    sbQ(sb.from('profiles').select('*').eq('id', revId).single()),
    sbQ(sb.from('revendedora_docs').select('*').eq('profile_id', revId).maybeSingle()),
  ]);
  if (!r) { toast('Revendedora não encontrada'); return; }
  const d = doc || {};
  if (!cadastroCompletoParaContrato(r, d)) { toast('Complete CPF e endereço para gerar o contrato'); return; }

  // Negrito automático nos termos-chave (mantém o texto abaixo literal/limpo).
  const realca = t => t
    .replace(/CONSIGNATÁRIO\(A\)/g, '<strong>CONSIGNATÁRIO(A)</strong>')
    .replace(/CONSIGINATÁRIO\(A\)/g, '<strong>CONSIGINATÁRIO(A)</strong>')
    .replace(/CONSIGNANTE/g, '<strong>CONSIGNANTE</strong>');
  const p = t => `<p style="margin:0 0 9px;text-align:justify">${realca(t)}</p>`;
  const cl = (n, t) => `<p style="margin:0 0 9px;text-align:justify"><strong>CLÁUSULA ${n}</strong> – ${realca(t)}</p>`;
  const h = t => `<p style="margin:16px 0 9px"><u><strong>${t}</strong></u>:</p>`;
  const linhaQ = (rot, val) => `<tr><td style="border:1px solid #444;padding:5px 8px;width:32%;font-weight:600;vertical-align:top">${rot}</td><td style="border:1px solid #444;padding:5px 8px">${val || '&nbsp;'}</td></tr>`;
  const cabQ = t => `<tr><td colspan="2" style="border:1px solid #444;padding:5px 8px;background:#f0ebf3;font-weight:700">${t}</td></tr>`;

  const hoje = new Date();
  const cidUf = [r.cidade, r.estado].filter(Boolean).map(esc).join('/');
  const linhaData = r.cidade
    ? `${cidUf}, ${hoje.getDate()} de ${MESES_EXT[hoje.getMonth()]} de ${hoje.getFullYear()} .`
    : '___________________________, ____ de __________ de ______ .';

  const assinatura = (rot, extra = '') => `<div style="page-break-inside:avoid;margin-top:34px">
    <div style="border-top:1px solid #000;width:70%;max-width:420px"></div>
    <div style="margin-top:4px;font-weight:600">${rot}</div>${extra}</div>`;

  const html = `
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:12.5px;line-height:1.5;color:#1a1a1a;max-width:720px;margin:0 auto">
    <h1 style="text-align:center;font-size:17px;margin:0 0 18px;text-transform:uppercase">Contrato de Revenda em Consignação</h1>

    <p style="margin:0 0 14px;text-align:justify">Resolvem a <strong>CONSIGNANTE</strong>, o(a) <strong>CONSIGNATÁRIO(A)</strong>, sendo certo que todos os efetivamente obrigados por esse Instrumento estão elencados no quadro abaixo e de comum acordo, celebraram o presente, que se regerá pelas cláusulas e condições a seguir elencadas:</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:12px">
      ${cabQ('CONSIGNANTE')}
      ${linhaQ('Nome', esc(CONSIGNANTE.nome))}
      ${linhaQ('CNPJ/MF', esc(CONSIGNANTE.cnpj))}
      ${linhaQ('Endereço', esc(CONSIGNANTE.endereco))}
      ${linhaQ('Representante legal', esc(CONSIGNANTE.representante))}
      ${linhaQ('E-mail', esc(CONSIGNANTE.email))}
      ${linhaQ('Telefone', esc(CONSIGNANTE.telefone))}
      ${cabQ('CONSIGNATÁRIO(A)')}
      ${linhaQ('Nome', esc(r.nome))}
      ${linhaQ('CPF/MF', fmtCpfDoc(d.cpf))}
      ${linhaQ('RG', esc(d.rg))}
      ${linhaQ('Endereço', enderecoRevLinha(r))}
      ${linhaQ('E-mail', esc(r.email))}
      ${linhaQ('Telefone', fmtTelDoc(r.telefone))}
      ${cabQ('FIADOR')}
      ${linhaQ('Nome', esc(d.fiador_nome))}
      ${linhaQ('CPF/MF', fmtCpfDoc(d.fiador_cpf))}
      ${linhaQ('RG', esc(d.fiador_rg))}
      ${linhaQ('Endereço', esc(d.fiador_endereco))}
      ${linhaQ('E-mail', esc(d.fiador_email))}
      ${linhaQ('Telefone', fmtTelDoc(d.fiador_telefone))}
    </table>

    ${h('DAS CONSIDERAÇÕES INICIAIS')}
    ${p('Este Instrumento será gerido pelas normas previstas nos artigos 534 a 537, do Código Civil, bem como no Princípio da Livre Iniciativa, consoante o artigo 170, da Constituição Federal.')}
    ${p('Será dever das Partes adotar a política de cooperação, haja vista que a relação contratual necessita efetivamente do comprometimento mútuo para a excelência na execução das obrigações assumidas, sobretudo se escorando no Princípio da Boa-fé.')}
    ${p('Todos os contratantes têm pleno conhecimento da autonomia para exercer as atividades por esse contrato assumidas, entretanto isso não exime nenhuma das Partes quanto a responsabilidade inerente dos compromissos.')}

    ${h('DOS OBJETIVOS DO CONTRATO')}
    ${cl('PRIMEIRA', 'O presente Instrumento tem por finalidade a entrega em consignação pela CONSIGNANTE, a(o) CONSIGNATÁRIO(A), de 1 (uma) maleta contendo diversas semijoias, para fins de exposição, comercialização e venda pelo(a) CONSIGNATÁRIO(A), respeitando todos os termos desse Instrumento.')}
    ${cl('SEGUNDA', 'É obrigação do(a) CONSIGNATÁRIO(A), para a manutenção dos alvos desse Instrumento, respeitar os procedimentos de uso, manuseio e garantia, em conformidade com as orientações técnicas que afirma ter recebido da CONSIGNANTE.')}
    ${cl('TERCEIRA', 'Compete o(a) CONSIGNATÁRIO(A) zelar por absolutamente todos os produtos disponibilizados pela CONSIGNANTE, além de adequada apresentação aos eventuais consumidores.')}
    ${cl('QUARTA', 'A(o) CONSIGNATÁRIO(A) cabe comercializar os produtos estritamente no preço informado pela CONSIGNANTE, não sendo aceita qualquer alteração sem o prévio consentimento dela, sendo que nessa hipótese, deverá estar previamente acordado por escrito. Os preços dos produtos também estarão discriminados nas etiquetas fixadas neles.')}
    ${cl('QUINTA', 'O(A) CONSIGNATÁRIO(A) poderá realizar a complementação, substituição ou até mesmo a troca de produtos da maleta, a cada 35 (trinta e cinco) dias, juntamente com o acerto financeiro que se dará nessa mesma data, ao passo que eventualmente todas as possibilidades respeitarão os critérios comerciais da CONSIGNANTE e possibilidade pelo estoque.')}
    ${cl('SEXTA', 'Todos os produtos que serão entregues a(o) CONSIGNATÁRIO(A) estão relacionados em catálogo, com todas as características e preço, este que faz parte integrante do contrato.')}

    ${h('DOS PRAZOS DO CONTRATO E CONDIÇÕES DE DEVOLUÇÃO')}
    ${cl('SÉTIMA', 'O presente instrumento vigorará por prazo indeterminado, de modo que para o tempo mínimo do desfazimento é necessário que a parte interessada, respeite a Cláusula Trigésima.')}
    ${cl('OITAVA', 'No exato dia em que ficar estipulada a rescisão contratual, o(a) CONSIGINATÁRIO(A) deverá devolver a maleta outrora lhe entregue pela CONSIGNANTE, com todos os produtos não vendidos e em perfeito estado de conservação, bem como quitar o valor dos produtos comercializados dentro daquele ciclo.')}
    ${cl('NONA', 'Na hipótese de o(a) CONSIGNATÁRIO(A) entregar os produtos com avarias, serão equiparados como vendidos, quando ele(a) deverá efetuar o pagamento total desses produtos para a CONSIGNANTE, sendo que este fato não interferirá em qualquer outra penalidade prevista neste Instrumento.')}
    ${cl('DÉCIMA', 'Tanto a entrega da maleta supracitada, bem como a devolução dela – obrigatoriamente – deverá ser realizada na sede da CONSIGNANTE, isto é: na Rua Tiradentes, n.º 446, sala 23, Vila Itapura, Campinas/SP.')}

    ${h('DOS PAGAMENTOS E COMISSÕES')}
    ${cl('DÉCIMA PRIMEIRA', 'As comissões devidas para o(a) CONSIGNATÁRIO(A), serão pagas de formas escalonadas, de acordo com o percentual de vendas atingidas no ciclo de 35 (trinta e cinco) dias, baseando-se na somatória dos preços dos produtos vendidos, preços esses estampados no catálogo.')}
    ${cl('DÉCIMA SEGUNDA', 'Se todas as vendas realizadas pelo(a) CONSIGNATÁRIO(A) dentro do ciclo de 35 (trinta e cinco) dias, totalizar a quantia de até R$ 1.799,99 (mil setecentos e noventa e nove reais e noventa e nove centavos), a comissão será de 30% (trinta por cento) sobre o valor total das vendas. Outrossim, para as vendas dentro do ciclo que somarem juntas quantias superiores ao montante de R$ 1.800,00 (mil e oitocentos reais), a comissão sobre as vendas será de 35% (trinta e cinco por cento).')}
    ${cl('DÉCIMA TERCEIRA', 'Eventualmente e por motivos justificáveis, a CONSIGNANTE poderá estender o prazo para quitação da comissão, por mais 5 (cinco) dias úteis, desde que avise com no mínimo 2 (dois) dias úteis de antecedência da data primária.')}
    ${cl('DÉCIMA QUARTA', 'O pagamento do(a) CONSIGNATÁRIO(A) à CONSIGNANTE, em razão das vendas dos produtos consignados, deverá ser feito até o dia que se findará o ciclo de 35 (trinta e cinco) dias da retirada dos produtos, de forma improrrogável, sendo considerado inadimplente o valor não repassado até a data estipulada, independente de notificação e passível de multa contratual.')}
    ${cl('DÉCIMA QUINTA', 'Em qualquer hipótese na qual o pagamento for realizado em dinheiro, necessária será a entrega do comprovante de quitação para a parte credora.')}

    ${h('DAS OBRIGAÇÕES DA CONSIGNANTE')}
    ${cl('DÉCIMA SEXTA', 'Compõe obrigação da CONSIGNANTE entregar todos os produtos para o(a) CONSIGNATÁRIO(A), livre de qualquer ônus e na data aprazada.')}
    ${cl('DÉCIMA SÉTIMA', 'Cabe a CONSIGNANTE, informar o(a) CONSIGNATÁRIO(A) sobre qualquer medida judicial que possa comprometer os produtos consignados, atingindo a posse, circulação ou venda.')}
    ${cl('DÉCIMA OITAVA', 'Até o instante em que os produtos consignados forem entregues para o(a) CONSIGNATÁRIO(A), qualquer vício ou defeito são de responsabilidade da CONSIGNANTE, os quais serão substituídos, exceto na falta de estoque para tanto.')}

    ${h('DAS OBRIGAÇÕES DO(A) CONSIGNATÁRIO(A)')}
    ${cl('DÉCIMA NONA', 'O(A) CONSIGNATÁRIO(A) enviará para a CONSIGNANTE até 1 (um) dia antes do final do ciclo de 35 (trinta e cinco) dias, relatório descrevendo os produtos que foram vendidos no período, com o fito de facilitar na exposição presencial dos produtos e pagamento da comissão.')}
    ${cl('VIGÉSIMA', 'Caberá o(a) CONSIGNATÁRIO(A) a responsabilidade por todos os produtos para ele(a) confiados, seja em relação a venda ao consumidor final, depósito, guarda e integridade, devendo indenizar a CONSIGNANTE por qualquer extravio, furto, roubo, perca, vício ou defeito no produto enquanto eles estiveram sob a posse dele(a), baseando-se na soma do preço de revenda de cada produto.')}
    ${cl('VIGÉSIMA PRIMEIRA', 'Na existência de fato que comprometa a integridade dos produtos consignados, cabe o(a) CONSIGNATÁRIO(A) informar imediatamente à CONSIGNANTE, para que medidas cabíveis sejam prontamente tomadas.')}
    ${cl('VIGÉSIMA SEGUNDA', 'Não poderá o(a) CONSIGNATÁRIO(A) alterar, substituir ou retirar, qualquer objeto que compõe a apresentação do produto, tais como: etiquetas, códigos, embalagem, ou qualquer outro.')}
    ${cl('VIGÉSIMA TERCEIRA', 'É dever do(a) CONSIGNATÁRIO(A), devolver os eventuais produtos não comercializados íntegros, sem sinais de uso ou má conservação, sob pena de desconsiderar a hipotética entrega para todos os fins.')}
    ${cl('VIGÉSIMA QUARTA', 'O(A) CONSIGNATÁRIO(A) se compromete a responder de forma adequada e no prazo de até 1 (um) dia útil, qualquer comunicação emanada pela CONSIGNANTE, seja por meio eletrônico ou presencial, sendo encarado o descumprimento injustificado como violação contratual, permitindo que a CONSIGNANTE adote medidas administrativas e judiciais cabíveis.')}

    ${h('DA APROPRIAÇÃO INDÉBITA')}
    ${cl('VIGÉSIMA QUINTA', 'Compete o(a) CONSIGNATÁRIO(A), restituir para a CONSIGNANTE a maleta com todos os produtos não vendidos e nas mesmas condições que lhes foram entregues, dentro do ciclo de 35 (trinta e cinco) dias, respeitando também as condições impostas pela Cláusula Décima deste Instrumento.')}
    ${cl('VIGÉSIMA SEXTA', 'O não cumprimento da Cláusula anterior, possibilita à CONSIGNANTE registrar boletim de ocorrência para averiguação do crime de apropriação indébita, o qual está previsto no artigo 168, § 1º, III, do Código Penal, sujeitando o(a) CONSIGNATÁRIO(A) as sanções penais de reclusão de 1 (um) a 4 (quatro) anos, mais 1/3 (um terço), além de multa na esfera criminal, não eximindo das penalidades cíveis.')}

    ${h('DAS GARANTIAS')}
    ${cl('VIGÉSIMA SÉTIMA', 'Em caso de as Partes estabelecerem a necessidade de um fiador, o qual estará qualificado no quadro da primeira página desse Instrumento, ele também assinará o presente pactuado na condição que se impõe e como principal pagador, solidariamente com o(a) CONSIGNATÁRIO(A), por todas as obrigações e responsabilidades constantes deste Instrumento com disposições nos artigos 818 e seguintes do Código Civil, declarando, expressamente, desistir da faculdade estabelecida nos artigos 835 e 838, renunciando ao benefício de ordem do artigo 827 do mesmo Código, perdurando sua responsabilidade até a rescisão deste Instrumento.')}
    ${cl('VIGÉSIMA OITAVA', 'Em caso de ausência, interdição, recuperação judicial, falência, insolvência do fiador ou morte, as obrigações serão transferidas aos herdeiros ou sucessores e o(a) CONSIGNATÁRIO(A) se obriga, dentro do prazo de 30 (trinta) dias a dar substituto idôneo, a juízo da CONSIGNANTE, ficando ele(a) em mora se não fizer dentro do prazo de tolerância.')}

    ${h('DA HIPÓTESE DE RESCISÃO CONTRATUAL')}
    ${cl('VIGÉSIMA NONA', 'Caso alguma das Partes opte em rescindir este Instrumento, deverá notificar a parte contrária a qualquer tempo, respeitando o prazo mínimo de 10 (dez) dias para tanto e mediante o integral pagamento pelas vendas realizadas, sem qualquer multa ou penalização.')}
    ${cl('TRIGÉSIMA', 'Se no período de 2 (dois) ciclos consecutivos de 35 (trinta e cinco) dias (cada), o(a) CONSIGNATÁRIO(A) não atingir vendas em cada um deles, de no mínimo R$ 1.000,00 (mil reais), o contrato será imediatamente rescindido, sem qualquer ônus para a CONSIGNANTE.')}

    ${h('DO USO DA IMAGEM')}
    ${cl('TRIGÉSIMA PRIMEIRA', 'O(A) CONSIGNATÁRIO(A) permitirá o uso da sua imagem e voz com a aceitação de ambas as Partes, nas atividades promocionais e de divulgação da CONSIGNANTE.')}
    ${cl('TRIGÉSIMA SEGUNDA', 'A cessão da Cláusula anterior é a título gratuito, sem qualquer remuneração para as Partes ou indenização, no que tange ao uso autorizado.')}

    ${h('DA CONFIDENCIALIDADE')}
    ${cl('TRIGÉSIMA TERCEIRA', 'Cada Parte obriga-se a manter em sigilo, sem limite de tempo e lugar, de toda e qualquer informação confidencial recebida ou obtida da outra Parte, sobretudo as tratativas, cláusulas contratuais e a fazer uso delas com a única finalidade do cumprimento deste Instrumento e somente delas façam uso no âmbito do contrato ou mediante expressa autorização da Parte contrária, responsabilizando-se por qualquer violação desta cláusula.')}

    ${h('DAS DISPOSIÇÕES GERAIS')}
    ${cl('TRIGÉSIMA QUARTA', 'Esse instrumento é fruto de um ajuste mútuo entre as Partes, substituindo qualquer processo, arranjos, comunicações, por escrito ou verbais, de alguma das partes.')}
    ${cl('TRIGÉSIMA QUINTA', 'Na hipótese de tolerância a um descumprimento desse Instrumento será tido como mera tolerância, não constituindo novação e não integralizará aos termos.')}
    ${cl('TRIGÉSIMA SEXTA', 'Esse Instrumento é de cunho exclusivamente civil e comercial, não gerando entre as Partes vínculo de natureza empregatícia, societária, associativa, de representante comercial, de agência, parceria, muito menos liame de subordinação e não gera direito de exclusividade, ficando cada qual responsável por eventuais direitos decorrentes da legislação trabalhista, previdenciária e todos outros encargos aplicáveis aos empregados, caso assim os tenham.')}
    ${cl('TRIGÉSIMA SÉTIMA', 'Na hipótese do(a) CONSIGNATÁRIO(A) descumprir a Cláusula Vigésima Quinta deste Instrumento, o contrato será rescindido e ele(a) deverá arcar com multa contratual no importe de R$ 9.000,00 (nove mil reais).')}
    ${cl('TRIGÉSIMA OITAVA', 'Se para cobrança do que lhe for devido, tiver a CONSIGNANTE que recorrer aos meios judiciais e extrajudiciais, o(a) CONSIGNATÁRIO(A) será responsável pelas despesas a que der causa, inclusive sobre a verba honorária que desde já se fixa em 20% (vinte por cento) sobre o valor total do débito.')}
    ${cl('TRIGÉSIMA NONA', 'As Partes se obrigam, por si, herdeiros e sucessores, a qualquer título, a respeitarem o presente pacto em todos os seus termos, cláusulas e condições.')}
    ${cl('QUADRAGÉSIMA', 'As Partes elegem o foro da comarca de Campinas, Estado de São Paulo, com renúncia de qualquer outro, por mais privilegiado que seja, para dirimirem qualquer dúvida ou litígio oriundos do presente Instrumento.')}

    <p style="margin:18px 0 9px;text-align:justify">Por estarem assim justos e contratados, firmam o presente instrumento em uma via para cada Parte e outra, se for o caso, para o fiador, todas em igual teor e assinadas por 2 (duas) testemunhas para que assim produza seus devidos e legais efeitos.</p>

    <p style="margin:24px 0 8px">${linhaData}</p>

    ${assinatura('CONSIGNANTE')}
    ${assinatura('CONSIGNATÁRIO(A)')}
    ${assinatura('FIADOR(A)')}
    ${assinatura('TESTEMUNHA 1.:', '<div style="margin-top:2px">CPF/MF:</div>')}
    ${assinatura('TESTEMUNHA 2.:', '<div style="margin-top:2px">CPF/MF:</div>')}
  </div>`;

  document.getElementById('print-content').innerHTML = html;
  document.getElementById('print-overlay').classList.add('show');
  setTimeout(() => window.print(), 300);
}
