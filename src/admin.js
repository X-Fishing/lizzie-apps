// Admin: revendedoras (aprovar/revogar/papeis/excluir) e ranking.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast, confirmarAcao, openModal, closeModal, handleSupabaseError } from './utils.js';
import { ROLE_LABELS } from './auth.js';
import { carregarProximasTrocas, compararPorTroca, atualizarBadgesTroca } from './trocas.js';
export async function loadAdmin() {
  document.getElementById('rev-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  document.getElementById('pendentes-list').innerHTML = '';
  const [{ data: pendentes, error: e1 }, { data: aprovadas, error: e2 }, { data: funcs }] = await Promise.all([
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',false).order('created_at')),
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',true).order('nome')),
    // Blindagem: nunca listar quem é funcionário como revendedora (evita
    // excluir por engano o perfil de um funcionário). RLS só devolve a lista
    // para admin; gestor recebe vazio — inofensivo (promoção já os tira daqui).
    sbQ(sb.from('funcionarios').select('auth_user_id'))
  ]);
  if (e1 || e2) {
    const msg = (e1||e2).message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar revendedoras.';
    document.getElementById('rev-list').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }

  // Ids de funcionários (para nunca aparecerem na lista de revendedoras).
  const funcIds = new Set((funcs || []).map(f => f.auth_user_id).filter(Boolean));
  const semFunc = lista => (lista || []).filter(r => !funcIds.has(r.id));
  const pendentesRev = semFunc(pendentes);

  const pendDiv = document.getElementById('pendentes-list');
  if (pendentesRev.length) {
    pendDiv.innerHTML = `<div class="alert alert-warning"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> ${pendentesRev.length} cadastro${pendentesRev.length>1?'s':''} aguardando aprovação</div>` +
      pendentesRev.map(r => renderRevCard(r, true)).join('');
  } else pendDiv.innerHTML = '';

  state.aprovadasCache = semFunc(aprovadas);
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
  const trocaSlot = pendente ? '' : `<div data-troca-bling-id="${r.bling_contato_id || ''}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><span style="font-size:11px;color:var(--muted)">Carregando próxima troca...</span></div>`;
  return `<div class="card rev-card" onclick="verRevendedora('${r.id}')">
    <div class="rev-header">
      <div class="rev-avatar">${inicial}</div>
      <div>
        <div class="rev-nome">${esc(r.nome)}${r.teste ? ' <span class="badge-soon" style="background:var(--warning);color:#fff">TESTE</span>' : ''}</div>
        <div class="rev-cidade">${esc(r.cidade || 'Cidade não informada')} · ${esc(r.telefone || '—')}</div>
      </div>
      <div class="rev-status">
        ${pendente ? '<span class="badge badge-pendente"><span class="pending-dot"></span>Pendente</span>' : '<span class="badge badge-ativo"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Ativa</span>'}
      </div>
    </div>
    ${trocaSlot}
  </div>`;
}

export async function verRevendedora(id) {
  const { data: r } = await sb.from('profiles').select('*').eq('id', id).single();
  const { data: gcount } = await sb.from('garantias').select('id', { count: 'exact' }).eq('revendedora_id', id);
  const { data: ccount } = await sb.from('consignados').select('id', { count: 'exact' }).eq('revendedora_id', id);

  document.getElementById('detalhe-rev-content').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div class="rev-avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 12px">${r.nome.charAt(0)}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">${esc(r.nome)}${r.teste ? ' <span class="badge-soon" style="background:var(--warning);color:#fff;vertical-align:middle">TESTE</span>' : ''}</div>
      <div style="color:var(--muted);font-size:13px">${esc(r.email || '')}</div>
    </div>
    <div class="detail-grid">
      <div class="detail-row"><div class="detail-key">Telefone</div><div class="detail-val">${esc(r.telefone || '—')}</div></div>
      <div class="detail-row"><div class="detail-key">Cidade</div><div class="detail-val">${esc(r.cidade || '—')}</div></div>
      <div class="detail-row"><div class="detail-key">Garantias</div><div class="detail-val">${gcount ? gcount.length : 0}</div></div>
      <div class="detail-row"><div class="detail-key">Consignados</div><div class="detail-val">${ccount ? ccount.length : 0}</div></div>
      <div class="detail-row"><div class="detail-key">Cadastro</div><div class="detail-val">${formatDate(r.created_at.split('T')[0])}</div></div>
      <div class="detail-row"><div class="detail-key">Próx. troca</div><div class="detail-val" data-troca-bling-id="${r.bling_contato_id || ''}">Carregando...</div></div>
    </div>
    ${ehGestor() ? `
    <div class="divider"></div>
    <div class="form-group">
      <label class="form-label"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ID do contato no Bling</label>
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
    <div class="form-group" style="margin-top:10px">
      <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" ${r.teste ? 'checked' : ''} style="width:auto" onchange="marcarRevTeste('${r.id}', this.checked)">
        Conta de teste (não afeta faturamento/estoque)
      </label>
      <div style="font-size:11px;color:var(--muted)">Maletas e fechamentos continuam funcionando, mas nunca entram nos totais da empresa.</div>
    </div>` : ''}
    ${ehAdmin() ? `
    <div class="divider"></div>
    <div class="form-group">
      <label class="form-label">Nível de acesso</label>
      <select id="rev-role" class="form-control" onchange="definirPapel('${r.id}', this.value)">
        ${Object.entries(ROLE_LABELS).map(([v,l]) => `<option value="${v}" ${r.role===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="detail-actions" id="rev-actions" style="margin-top:12px">
      ${ehGestor() ? (!r.aprovada
        ? `<button class="btn-primary" onclick="aprovarRev('${r.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Aprovar acesso</button>`
        : `<button class="btn-danger" onclick="revogarRev('${r.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg> Revogar acesso</button>`) : ''}
      <button class="btn-secondary" onclick="closeModal('modal-detalhe-rev')">Fechar</button>
      ${ehAdmin() ? `<button class="btn-danger" data-rev-nome="${esc(r.nome || '')}" onclick="confirmarExclusaoRev('${r.id}', this)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Excluir revendedora</button>` : ''}
    </div>
  `;
  openModal('modal-detalhe-rev');
  atualizarBadgesTroca();
}

export async function aprovarRev(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  let error;
  try {
    ({ error } = await sb.from('profiles').update({ aprovada: true }).eq('id', id));
  } catch (e) { error = e; }
  if (await handleSupabaseError(error, 'Erro ao aprovar revendedora')) return;
  toast('Revendedora aprovada!');
  closeModal('modal-detalhe-rev');
  loadAdmin();
}

export async function revogarRev(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  let error;
  try {
    ({ error } = await sb.from('profiles').update({ aprovada: false }).eq('id', id));
  } catch (e) { error = e; }
  if (await handleSupabaseError(error, 'Erro ao revogar acesso')) return;
  toast('Acesso revogado');
  closeModal('modal-detalhe-rev');
  loadAdmin();
}

// Liga/desliga a conta de teste (só gestor/admin). O filtro das métricas
// (utils.ehRevTeste) passa a valer no próximo carregamento das telas.
export async function marcarRevTeste(id, teste) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ teste }).eq('id', id));
  if (error) {
    console.error('Conta de teste:', error);
    if (/teste/.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
      toast('Coluna "teste" não existe — rode a migração 0008 no Supabase.');
    } else if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) { /* já avisou */ }
    loadAdmin();
    return;
  }
  if (teste) state.revTesteSet.add(String(id)); else state.revTesteSet.delete(String(id));
  const cache = state.aprovadasCache.find(r => String(r.id) === String(id));
  if (cache) cache.teste = teste;
  toast(teste ? 'Marcada como conta de TESTE — fora dos totais.' : 'Conta voltou a contar nos totais.');
  renderAprovadas();
}

export async function definirPapel(id, novoPapel) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ role: novoPapel }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao definir papel')) return;
  toast('Nível atualizado: ' + (ROLE_LABELS[novoPapel] || novoPapel));
  state.blingRevs = []; state.aprovadasCache = [];
  loadAdmin();
}

// Confirmacao embutida (sem confirm() nativo, que nao aparece no PWA).
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
        <button class="btn-secondary" onclick="verRevendedora('${id}')">Cancelar</button>
      </div>
    </div>`;
}

export async function excluirRevendedora(id, btn) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
  // Blindagem: não deixar apagar o perfil de um funcionário por esta tela
  // (foi o que deixou a conta órfã antes). Gerencie em Cadastros → Funcionários.
  const { data: func } = await sbQ(sb.from('funcionarios').select('id').eq('auth_user_id', id).maybeSingle());
  if (func) { toast('Esse acesso é de um funcionário — gerencie em Cadastros → Funcionários, não aqui.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Excluindo...'; }
  try {
    // Apaga os dados filhos antes do profile (nao depende de ON DELETE CASCADE).
    const { data: vendas } = await sbQ(sb.from('vendas').select('id').eq('revendedora_id', id));
    const vendaIds = (vendas || []).map(v => v.id);
    if (vendaIds.length) {
      await sbQ(sb.from('venda_itens').delete().in('venda_id', vendaIds));
      await sbQ(sb.from('recebimentos').delete().in('venda_id', vendaIds));
      await sbQ(sb.from('vendas').delete().eq('revendedora_id', id));
    }
    await sbQ(sb.from('garantias').delete().eq('revendedora_id', id));
    await sbQ(sb.from('consignados').delete().eq('revendedora_id', id));
    const { error } = await sbQ(sb.from('profiles').delete().eq('id', id));
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
  closeModal('modal-detalhe-rev');
  loadAdmin();
}
