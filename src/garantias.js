// Garantias: lista, cards, visao staff, criar/editar/status/excluir.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, formatDate, sbQ, fetchPaginado, handleSupabaseError, toast, confirmarAcao, openModal, closeModal, brToISO, isoToBR, hojeBR } from './utils.js';
export function calcPrazoGarantia() {
  const iso = brToISO(document.getElementById('g-entrada').value);
  const prazoEl = document.getElementById('g-prazo');
  if (!iso) { prazoEl.value = ''; return; }
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 90);
  prazoEl.value = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

export async function loadGarantias() {
  document.getElementById('g-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const isAdmin = ehStaff();
  const queries = [fetchPaginado(() => {
    let q = sb.from('garantias').select('*');
    if (!isAdmin) q = q.eq('revendedora_id', state.currentUser.id);
    return q.order('created_at', { ascending: false });
  })];
  if (isAdmin) queries.push(sbQ(sb.from('profiles').select('id,nome').eq('role', 'revendedora')));
  const results = await Promise.all(queries);
  const { data, error } = results[0];
  if (error) {
    const msg = error.message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar garantias.';
    document.getElementById('g-list').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }
  state.allGarantias = data || [];
  if (isAdmin && results[1] && results[1].data) results[1].data.forEach(r => { state.revNameMap[r.id] = r.nome; });
  filtrarGarantias();
}

export function filtrarGarantias() {
  const search = document.getElementById('g-search').value.toLowerCase();
  let list = state.allGarantias;
  if (state.gFilter !== 'todas') list = list.filter(g => g.status === state.gFilter);
  if (search) list = list.filter(g =>
    (g.descricao_item || '').toLowerCase().includes(search) ||
    (g.nome_cliente || '').toLowerCase().includes(search) ||
    (g.problema_relatado || '').toLowerCase().includes(search)
  );
  if (ehStaff()) { renderGarantiasStaff(list); return; }   // visão visual (PC)
  const div = document.getElementById('g-list');
  if (!list.length) { div.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma garantia encontrada</p></div>'; return; }
  div.innerHTML = list.map(g => renderGarantiaCard(g)).join('');
}

// ── Garantias: visão visual do staff (distribuição, alertas, ranking B.O. + tabela) ──
export const GSTATUS = {
  aberta:      { label: 'Aberta',      cor: '#3f7fe0' },
  em_conserto: { label: 'Em conserto', cor: 'var(--warning)' },
  pronta:      { label: 'Pronta',      cor: 'var(--success)' },
  entregue:    { label: 'Entregue',    cor: '#5a4a60' }
};

export function gDot(cor) { return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${cor};margin-right:6px;vertical-align:middle"></span>`; }

export function gDias(g) { const h = new Date(); h.setHours(0,0,0,0); return Math.ceil((new Date(g.prazo_maximo + 'T00:00:00') - h) / 86400000); }

export function sortGarantiasStaff(col) {
  if (state.gSort.col === col) state.gSort.dir = state.gSort.dir === 'asc' ? 'desc' : 'asc';
  else { state.gSort.col = col; state.gSort.dir = 'asc'; }
  filtrarGarantias();
}

export function renderGarantiasStaff(list) {
  const div = document.getElementById('g-list');
  const todas = state.allGarantias, total = todas.length;
  const cont = { aberta: 0, em_conserto: 0, pronta: 0, entregue: 0 };
  todas.forEach(g => { if (cont[g.status] != null) cont[g.status]++; });
  const naoEntreg = todas.filter(g => g.status !== 'entregue');
  const atras = naoEntreg.filter(g => gDias(g) < 0).length;
  const venc = naoEntreg.filter(g => { const d = gDias(g); return d >= 0 && d <= 7; }).length;
  const porRev = {};
  todas.forEach(g => { porRev[g.revendedora_id] = (porRev[g.revendedora_id] || 0) + 1; });
  const ranking = Object.entries(porRev).map(([id, n]) => ({ nome: state.revNameMap[id] || '—', n }))
    .sort((a, b) => b.n - a.n).slice(0, 6);

  const sorted = [...list].sort((a, b) => {
    let va, vb;
    if (state.gSort.col === 'dias') { va = gDias(a); vb = gDias(b); }
    else if (state.gSort.col === 'revendedora') { va = (state.revNameMap[a.revendedora_id] || '').toLowerCase(); vb = (state.revNameMap[b.revendedora_id] || '').toLowerCase(); }
    else { va = a[state.gSort.col] ?? ''; vb = b[state.gSort.col] ?? ''; if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); } }
    if (va < vb) return state.gSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return state.gSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const pct = n => total ? Math.round(n / total * 100) : 0;
  const barra = (label, n, cor) => `<div style="margin-bottom:9px">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${gDot(cor)}${label}</span><span style="color:var(--muted)">${n} · ${pct(n)}%</span></div>
    <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden"><div style="width:${pct(n)}%;height:100%;background:${cor}"></div></div></div>`;
  const th = (col, label) => {
    const arrow = state.gSort.col !== col ? '<span style="opacity:.3">⇅</span>' : (state.gSort.dir === 'asc' ? '▲' : '▼');
    return `<th class="ciclo-th" onclick="sortGarantiasStaff('${col}')">${label} ${arrow}</th>`;
  };
  const linha = g => {
    const si = GSTATUS[g.status] || { label: g.status, cor: 'var(--muted)' };
    const d = gDias(g);
    let diasTxt = '—', cor = 'var(--muted)';
    if (g.status !== 'entregue') {
      if (d < 0) { diasTxt = `${Math.abs(d)}d atraso`; cor = 'var(--danger)'; }
      else if (d <= 7) { diasTxt = `${d}d`; cor = 'var(--warning)'; }
      else { diasTxt = `${d}d`; cor = 'var(--text)'; }
    }
    return `<tr class="ciclo-row" onclick="verGarantia('${g.id}')" style="cursor:pointer">
      <td class="ciclo-td"><div class="ciclo-desc">${esc(g.nome_cliente)}</div><div class="ciclo-ref">${esc(g.descricao_item)}</div></td>
      <td class="ciclo-td">${esc(state.revNameMap[g.revendedora_id] || '—')}</td>
      <td class="ciclo-td" style="white-space:nowrap">${gDot(si.cor)}${si.label}</td>
      <td class="ciclo-td">${formatDate(g.data_entrada)}</td>
      <td class="ciclo-td">${formatDate(g.prazo_maximo)}</td>
      <td class="ciclo-td" style="color:${cor};font-weight:600;white-space:nowrap">${diasTxt}</td>
    </tr>`;
  };

  div.innerHTML = `
    <div class="dash-grid" style="margin-bottom:18px">
      <div class="dash-card">
        <h3>Distribuição por status</h3><div class="dash-sub">${total} garantia${total !== 1 ? 's' : ''} no total</div>
        ${barra('Aberta', cont.aberta, '#3f7fe0')}
        ${barra('Em conserto', cont.em_conserto, 'var(--warning)')}
        ${barra('Pronta', cont.pronta, 'var(--success)')}
        ${barra('Entregue', cont.entregue, '#5a4a60')}
      </div>
      <div class="dash-card">
        <h3>Alertas de prazo</h3><div class="dash-sub">Garantias não entregues</div>
        <div class="dash-row"><span>${gDot('var(--danger)')}Em atraso</span><b style="color:var(--danger)">${atras}</b></div>
        <div class="dash-row"><span>${gDot('var(--warning)')}Vencendo (7 dias)</span><b style="color:var(--warning)">${venc}</b></div>
        <div class="dash-row"><span>${gDot('var(--success)')}No prazo</span><b>${Math.max(0, naoEntreg.length - atras - venc)}</b></div>
      </div>
      <div class="dash-card">
        <h3>Ranking de B.O.</h3><div class="dash-sub">Revendedoras com mais garantias</div>
        ${ranking.length ? ranking.map((r, i) => `<div class="dash-row"><span>${i + 1}. ${esc(r.nome)}</span><b>${r.n}</b></div>`).join('') : '<div class="dash-sub">Sem garantias.</div>'}
      </div>
    </div>
    <div class="ciclo-wrap">
      <table class="ciclo-table">
        <thead><tr>
          ${th('nome_cliente', 'Cliente / Item')}
          ${th('revendedora', 'Revendedora')}
          ${th('status', 'Status')}
          ${th('data_entrada', 'Entrada')}
          ${th('prazo_maximo', 'Prazo')}
          ${th('dias', 'Dias')}
        </tr></thead>
        <tbody>${sorted.length ? sorted.map(linha).join('') : '<tr><td class="ciclo-td" colspan="6" style="text-align:center;color:var(--muted);padding:20px">Nenhuma garantia neste filtro</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function setGFilter(el, f) {
  state.gFilter = f;
  document.querySelectorAll('#g-chips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filtrarGarantias();
}

export function renderGarantiaCard(g) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const prazo = new Date(g.prazo_maximo + 'T00:00:00');
  const diff = Math.ceil((prazo - hoje) / 86400000);
  let prazoClass = '', prazoTxt = '';
  if (g.status !== 'entregue') {
    if (diff < 0) { prazoClass = 'prazo-vencido'; prazoTxt = `Vencido há ${Math.abs(diff)} dias`; }
    else if (diff <= 7) { prazoClass = 'prazo-vencendo'; prazoTxt = `Vence em ${diff} dia${diff!==1?'s':''}`; }
    else prazoTxt = `Prazo: ${formatDate(g.prazo_maximo)}`;
  } else prazoTxt = 'Entregue';

  const foto = g.foto_url
    ? `<div class="garantia-foto"><img src="${g.foto_url}" alt="foto"></div>`
    : `<div class="garantia-foto"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div>`;

  const statusMap = { aberta:'badge-aberta', em_conserto:'badge-em_conserto', pronta:'badge-pronta', entregue:'badge-entregue' };
  const statusLabel = { aberta:'Aberta', em_conserto:'Em conserto', pronta:'Pronta', entregue:'Entregue' };

  const steps = ['aberta','em_conserto','pronta','entregue'];
  const stepLabels = { aberta:'Aberta', em_conserto:'Em conserto', pronta:'Pronta', entregue:'Entregue' };
  const isAdmin = ehStaff();
  const nextStep = steps[Math.min(steps.indexOf(g.status) + 1, steps.length - 1)];
  const hasNext = g.status !== 'entregue';

  const adminControl = isAdmin ? `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center" onclick="event.stopPropagation()">
      <select onchange="atualizarStatusCard('${g.id}',this.value,event)" style="flex:1;padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);font-size:12px;color:var(--text);background:#fff;font-family:'DM Sans',sans-serif;outline:none;cursor:pointer">
        ${steps.map(s => `<option value="${s}" ${g.status===s?'selected':''}>${stepLabels[s]}</option>`).join('')}
      </select>
      ${hasNext ? `<button onclick="atualizarStatusCard('${g.id}','${nextStep}',event)" style="white-space:nowrap;padding:6px 12px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--rose),#b5526a);color:#fff;font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500">→ Avançar</button>` : ''}
    </div>
  ` : '';

  return `<div class="card garantia-card" onclick="verGarantia('${g.id}')">
    <div class="garantia-header">
      ${foto}
      <div class="garantia-info">
        <div class="garantia-item">${esc(g.descricao_item)}</div>
        <div class="garantia-cliente"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg> ${esc(g.nome_cliente)}</div>
        <span class="badge ${statusMap[g.status]}">${statusLabel[g.status]}</span>
      </div>
    </div>
    <div class="garantia-footer">
      <div class="garantia-prazo ${prazoClass}">${prazoTxt}</div>
      <small style="color:var(--muted)">${formatDate(g.data_entrada)}</small>
    </div>
    ${adminControl}
  </div>`;
}

export async function verGarantia(id) {
  let g = state.allGarantias.find(x => x.id === id);
  if (!g) {
    const { data, error } = await sb.from('garantias').select('*').eq('id', id).single();
    if (error || !data) { toast('Erro ao carregar garantia'); return; }
    g = data;
  }

  const isAdmin = ehStaff();
  const destMap = { rebanho:'Rebanho', fornecedor:'Fornecedor', conserto_local:'Conserto local', outro:'Outro' };
  const statusMap = { aberta:'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#3f7fe0;margin-right:5px;vertical-align:middle"></span>Aberta', em_conserto:'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warning);margin-right:5px;vertical-align:middle"></span>Em conserto', pronta:'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--success);margin-right:5px;vertical-align:middle"></span>Pronta', entregue:'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#5a4a60;margin-right:5px;vertical-align:middle"></span>Entregue' };

  let fotoHtml = g.foto_url ? `<img src="${g.foto_url}" class="detail-foto">` : '';

  let adminActions = '';
  if (isAdmin || state.currentProfile.role === 'revendedora') {
    adminActions = `
      <button class="btn-secondary btn-sm" onclick="editarGarantia('${g.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Editar</button>
      ${isAdmin ? `<button class="btn-secondary btn-sm" onclick="mudarStatus('${g.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg> Status</button>` : ''}
      ${ehGestor() ? `<button class="btn-danger btn-sm" onclick="excluirGarantia('${g.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Excluir</button>` : ''}
    `;
  }

  document.getElementById('detalhe-g-content').innerHTML = `
    ${fotoHtml}
    <div class="modal-title">${esc(g.descricao_item)}</div>
    <div class="detail-grid">
      <div class="detail-row"><div class="detail-key">Cliente</div><div class="detail-val">${esc(g.nome_cliente)}${g.telefone_cliente ? ' · ' + esc(g.telefone_cliente) : ''}</div></div>
      <div class="detail-row"><div class="detail-key">Problema</div><div class="detail-val">${esc(g.problema_relatado)}</div></div>
      <div class="detail-row"><div class="detail-key">Status</div><div class="detail-val">${statusMap[g.status]}</div></div>
      <div class="detail-row"><div class="detail-key">Entrada</div><div class="detail-val">${formatDate(g.data_entrada)}</div></div>
      <div class="detail-row"><div class="detail-key">Prazo máx.</div><div class="detail-val">${formatDate(g.prazo_maximo)}</div></div>
      <div class="detail-row"><div class="detail-key">Destino</div><div class="detail-val">${destMap[g.destino] || esc(g.destino)}${g.destino_detalhe ? ' — ' + esc(g.destino_detalhe) : ''}</div></div>
      ${g.observacoes ? `<div class="detail-row"><div class="detail-key">Obs.</div><div class="detail-val">${esc(g.observacoes)}</div></div>` : ''}
    </div>
    <div class="detail-actions">
      ${adminActions}
      <button class="btn-secondary btn-sm" onclick="closeModal('modal-detalhe-g')">Fechar</button>
    </div>
  `;
  openModal('modal-detalhe-g');
}

export function openNovaGarantia() {
  document.getElementById('g-edit-id').value = '';
  document.getElementById('modal-gTitle').textContent = 'Nova Garantia';
  document.getElementById('g-status-group').style.display = 'none';
  ['g-desc','g-cliente','g-tel','g-problema','g-obs'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('g-foto-preview').style.display = 'none';
  document.getElementById('g-foto-placeholder').style.display = 'block';
  document.getElementById('g-foto-input').value = '';
  document.getElementById('g-entrada').value = hojeBR();
  calcPrazoGarantia();
  openModal('modal-garantia');
}

export async function editarGarantia(id) {
  const g = state.allGarantias.find(x => x.id === id) || (await sb.from('garantias').select('*').eq('id', id).single()).data;
  closeModal('modal-detalhe-g');
  document.getElementById('g-edit-id').value = g.id;
  document.getElementById('modal-gTitle').textContent = 'Editar Garantia';
  document.getElementById('g-desc').value = g.descricao_item;
  document.getElementById('g-cliente').value = g.nome_cliente;
  document.getElementById('g-tel').value = g.telefone_cliente || '';
  document.getElementById('g-problema').value = g.problema_relatado;
  document.getElementById('g-entrada').value = isoToBR(g.data_entrada);
  document.getElementById('g-prazo').value = isoToBR(g.prazo_maximo);
  document.getElementById('g-destino').value = g.destino || 'outro';
  document.getElementById('g-destino-det').value = g.destino_detalhe || '';
  document.getElementById('g-obs').value = g.observacoes || '';
  // Status e campo de processo do admin: revendedora nem ve o seletor.
  const isAdmin = ehStaff();
  document.getElementById('g-status-group').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('g-status').value = g.status;
  if (g.foto_url) {
    document.getElementById('g-foto-preview').src = g.foto_url;
    document.getElementById('g-foto-preview').style.display = 'block';
    document.getElementById('g-foto-placeholder').style.display = 'none';
  }
  openModal('modal-garantia');
}

export async function salvarGarantia(btn) {
  if (btn.disabled) return;
  btn.disabled = true;

  const desc = document.getElementById('g-desc').value.trim();
  const cliente = document.getElementById('g-cliente').value.trim();
  const problema = document.getElementById('g-problema').value.trim();
  if (!desc || !cliente || !problema) {
    toast('Preencha os campos obrigatórios');
    btn.disabled = false;
    return;
  }

  const editId = document.getElementById('g-edit-id').value;
  let foto_url = editId ? (state.allGarantias.find(g => g.id === editId) || {}).foto_url : null;

  const fileInput = document.getElementById('g-foto-input');
  if (fileInput.files[0]) {
    const file = fileInput.files[0];
    const ext = file.name.split('.').pop();
    const fname = `${state.currentUser.id}/${Date.now()}.${ext}`;
    const { data: upData, error: upErr } = await sb.storage.from('lizzie-fotos').upload(fname, file, { upsert: true });
    if (!upErr) {
      const { data: { publicUrl } } = sb.storage.from('lizzie-fotos').getPublicUrl(fname);
      foto_url = publicUrl;
    }
  }

  const isAdmin = ehStaff();
  const payload = {
    descricao_item: desc,
    nome_cliente: cliente,
    telefone_cliente: document.getElementById('g-tel').value.trim() || null,
    problema_relatado: problema,
    data_entrada: brToISO(document.getElementById('g-entrada').value),
    prazo_maximo: brToISO(document.getElementById('g-prazo').value),
    observacoes: document.getElementById('g-obs').value.trim() || null,
    foto_url,
    updated_at: new Date().toISOString()
  };

  let error;
  if (editId) {
    // Campos de processo (status/destino) so o admin altera numa edicao —
    // a edicao da revendedora nao sobrescreve o fluxo controlado pelo admin.
    if (isAdmin) {
      payload.status = document.getElementById('g-status').value;
      payload.destino = document.getElementById('g-destino').value || 'outro';
      payload.destino_detalhe = document.getElementById('g-destino-det').value.trim() || null;
    }
    ({ error } = await sb.from('garantias').update(payload).eq('id', editId));
  } else {
    payload.status = 'aberta';
    payload.revendedora_id = state.currentUser.id;
    payload.destino = document.getElementById('g-destino').value || 'outro';
    payload.destino_detalhe = document.getElementById('g-destino-det').value.trim() || null;
    ({ error } = await sb.from('garantias').insert(payload));
  }

  btn.disabled = false;
  if (await handleSupabaseError(error, 'Erro ao salvar garantia')) return;

  toast(editId ? 'Garantia atualizada!' : 'Garantia registrada!');
  closeModal('modal-garantia');
  loadGarantias();
  loadDashboard();
}

export async function mudarStatus(id) {
  const g = state.allGarantias.find(x => x.id === id);
  const steps = ['aberta', 'em_conserto', 'pronta', 'entregue'];
  const cur = steps.indexOf(g.status);
  const next = steps[Math.min(cur + 1, steps.length - 1)];
  const { error } = await sb.from('garantias').update({ status: next, updated_at: new Date().toISOString() }).eq('id', id);
  if (await handleSupabaseError(error, 'Erro ao atualizar status')) return;
  closeModal('modal-detalhe-g');
  toast('Status atualizado!');
  loadGarantias();
  loadDashboard();
}

export async function atualizarStatusCard(id, novoStatus, event) {
  event.stopPropagation();
  const { error } = await sb.from('garantias').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', id);
  if (await handleSupabaseError(error, 'Erro ao atualizar status')) return;
  toast('Status atualizado!');
  loadGarantias();
  loadDashboard();
}

export async function excluirGarantia(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const g = state.allGarantias.find(x => x.id === id);
  const desc = g ? g.descricao_item : 'esta garantia';
  confirmarAcao('Excluir garantia', `Excluir a garantia "${desc}"?\n\nEssa ação não pode ser desfeita.`, 'Excluir', async () => {
    let error;
    try {
      ({ error } = await sb.from('garantias').delete().eq('id', id));
    } catch (e) { error = e; }
    if (await handleSupabaseError(error, 'Erro ao excluir garantia')) return;
    closeModal('modal-detalhe-g');
    toast('Garantia excluída');
    loadGarantias();
    loadDashboard();
  });
}
