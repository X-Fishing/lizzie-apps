// Catalogo/ciclo: grade, detalhe, historico de catalogos, carrinho de venda, fechamento (PDF), busca de peca.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast, handleSupabaseError, confirmarAcao, openModal, closeModal, qtdDisp, detectarCategoria, CAT_LABEL, parseMoneyBR, moneyToInput, brToISO, hojeBR } from './utils.js';
export async function loadConsignados() {
  document.getElementById('c-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const isAdmin = ehStaff();
  const makeQ = () => {
    let q = sb.from('consignados').select('*');
    if (!isAdmin) q = q.eq('revendedora_id', state.currentUser.id);
    return q.order('created_at', { ascending: false });
  };
  const queries = [fetchPaginado(makeQ)];
  if (isAdmin) {
    queries.push(sbQ(sb.from('profiles').select('id,nome,bling_contato_id').eq('role','revendedora')));
  }
  const results = await Promise.all(queries);
  const { data, error } = results[0];
  const div = document.getElementById('c-list');
  if (error) {
    const msg = error.message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar.';
    div.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }
  state.allConsignados = data || [];
  if (isAdmin) {
    const revs = results[1].data || [];
    state.revNameMap = {};
    state.revBlingMap = {};
    revs.forEach(r => { state.revNameMap[r.id] = r.nome; state.revBlingMap[r.id] = r.bling_contato_id || ''; });
  }
  renderCicloGrid();
  renderCartBar();
}

export function sortConsignados(col) {
  if (state.cSort.col === col) state.cSort.dir = state.cSort.dir === 'asc' ? 'desc' : 'asc';
  else { state.cSort.col = col; state.cSort.dir = 'asc'; }
  renderCicloGrid();
}

export function renderCicloGrid() {
  const div = document.getElementById('c-list');
  if (state.historicoCicloSel) {
    const sb = document.getElementById('c-search-bar');
    if (sb) sb.style.display = 'none';
    div.innerHTML = renderHistoricoCicloDetalhe(state.historicoCicloSel);
    return;
  }
  const isAdmin = ehStaff();
  const searchBar = document.getElementById('c-search-bar');
  // Revendedora: sempre. Admin: só dentro do detalhe de uma revendedora (na tela de cards usa o pop-up "Buscar peça").
  const mostrarBusca = state.allConsignados.length && (!isAdmin || state.cicloRevSelecionada);
  if (searchBar) searchBar.style.display = mostrarBusca ? '' : 'none';
  if (!state.allConsignados.length) {
    div.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div><p>Nenhuma peça no catálogo</p></div>';
    return;
  }
  if (isAdmin) {
    div.innerHTML = renderCicloAdmin();
  } else {
    div.innerHTML = renderCicloRevendedora();
  }
}

export function cicloSortRows(list) {
  return [...list].sort((a, b) => {
    let va = a[state.cSort.col] ?? '', vb = b[state.cSort.col] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return state.cSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return state.cSort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

export function cicloArrow(col) {
  return state.cSort.col !== col ? '<span style="opacity:0.3">⇅</span>' : (state.cSort.dir === 'asc' ? '▲' : '▼');
}

export function cicloTh(col, label) {
  return `<th class="ciclo-th${state.cSort.col === col ? ' sorted' : ''}" onclick="sortConsignados('${col}')">${label} ${cicloArrow(col)}</th>`;
}

export function cicloRowHtml(c, isAdmin, historico = false) {
  const disp = qtdDisp(c);
  const esgotado = disp <= 0;
  const cat = c.categoria || detectarCategoria(c.descricao);
  const vendida = c.quantidade_vendida || 0;
  let acao, extraClass = '', extraStyle = '';
  if (historico) {
    // Status por VENDA real (não por estoque). Peça vendida fica em destaque (sem fade).
    if (vendida > 0) {
      acao = `<span style="font-size:11px;color:var(--success);font-weight:600">Vendido${vendida>1?` (${vendida})`:''}</span>`;
    } else {
      acao = `<span style="font-size:11px;color:var(--muted)">Não vendido</span>`;
      extraStyle = ' style="opacity:.55"'; // esmaece só a NÃO vendida
    }
  } else {
    acao = isAdmin
      ? `<span style="font-size:11px;color:var(--muted)">${c.status === 'encerrado' ? 'Encerrado' : (esgotado ? 'Vendido' : '—')}</span>`
      : (!esgotado ? `<button class="btn-vender" onclick="openVenda('${c.id}')">Vender</button>` : '<span style="font-size:11px;color:var(--muted)">Vendido</span>');
    extraClass = esgotado ? ' esgotado' : '';
  }
  return `<tr class="ciclo-row${extraClass}"${extraStyle}>
    <td class="ciclo-td">
      <div class="ciclo-desc">${esc(c.descricao)}</div>
      ${c.referencia ? `<div class="ciclo-ref">${esc(c.referencia)}</div>` : ''}
    </td>
    <td class="ciclo-td"><span class="ciclo-badge">${CAT_LABEL[cat] || cat}</span></td>
    <td class="ciclo-td"><span class="ciclo-num">${c.quantidade_enviada}</span></td>
    <td class="ciclo-td">${c.preco_venda ? `<span class="ciclo-preco">R$ ${Number(c.preco_venda).toFixed(2)}</span>` : '—'}</td>
    <td class="ciclo-td ciclo-acao">${acao}</td>
  </tr>`;
}

export function cicloTableHtml(list, isAdmin, historico = false) {
  const rows = cicloSortRows(list).map(c => cicloRowHtml(c, isAdmin, historico)).join('');
  return `<div class="ciclo-wrap">
    <table class="ciclo-table">
      <thead>
        <tr>
          ${cicloTh('descricao','Descrição')}
          ${cicloTh('categoria','Categoria')}
          ${cicloTh('quantidade_enviada','Enviadas')}
          ${cicloTh('preco_venda','Preço')}
          <th class="ciclo-th ciclo-th-nosort ciclo-acao">${isAdmin ? 'Status' : 'Ações'}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function renderCicloRevendedora() {
  const ativos = soAtivos(state.allConsignados);
  const temAtivos = ativos.some(c => qtdDisp(c) > 0);
  const btnFechamento = temAtivos
    ? `<button class="btn-secondary" style="width:100%;margin-top:16px;border-color:var(--gold);color:var(--gold)" onclick="openFechamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg> Fechamento do Catálogo</button>`
    : '';

  const historico = historicoCatalogosHtml(state.allConsignados);
  const cabecalho = pedidoLabelHtml(ativos, 12);

  const termo = (document.getElementById('c-search')?.value || '').toLowerCase().trim();
  if (termo || state.cicloSoVendidos) {
    let lista = ativos;
    if (termo) {
      lista = lista.filter(c =>
        (c.descricao || '').toLowerCase().includes(termo) ||
        (c.referencia || '').toLowerCase().includes(termo)
      );
    }
    if (state.cicloSoVendidos) lista = lista.filter(foiVendida);
    if (!lista.length) {
      const msgVazio = state.cicloSoVendidos
        ? (termo ? `Nenhuma peça vendida encontrada com "${termo}"` : 'Nenhuma peça vendida neste catálogo')
        : `Nenhuma peça encontrada com "${termo}"`;
      return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${msgVazio}</p></div>` + historico;
    }
    return cabecalho + cicloTableHtml(lista, false) + btnFechamento + historico;
  }

  // Sem catálogo ativo: mostra aviso + histórico (se houver), em vez de tabela vazia.
  if (!ativos.length) {
    return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></div><p>Nenhum catálogo ativo no momento</p></div>` + historico;
  }

  return cabecalho + cicloTableHtml(ativos, false) + btnFechamento + historico;
}

export function agruparPorRevendedora() {
  const groups = {};
  state.allConsignados.forEach(c => {
    const id = c.revendedora_id || '__sem__';
    if (!groups[id]) groups[id] = [];
    groups[id].push(c);
  });
  return groups;
}

export function pedidosDoCatalogo(list) {
  return [...new Set((list || []).map(c => c.pedido_numero).filter(Boolean))];
}

export function pedidoLabelHtml(list, fontSize) {
  const peds = pedidosDoCatalogo(list);
  if (!peds.length) return '';
  const label = peds.length > 1 ? 'Pedidos' : 'Pedido';
  return `<div style="font-size:${fontSize}px;color:var(--rose);font-family:monospace;margin-top:2px">${label} ${peds.map(n => '#' + n).join(', ')}</div>`;
}

export const foiVendida = c => (c.quantidade_vendida || 0) > 0;

export function toggleCicloSoVendidos(el) {
  state.cicloSoVendidos = !!el.checked;
  renderCicloGrid();
}

export const soAtivos     = list => list.filter(c => c.status === 'ativo');

export const soEncerrados = list => list.filter(c => c.status === 'encerrado');

// Agrupa peças encerradas em ciclos (1 ciclo = 1 fechamento), pela data de encerramento.
// Retorna [[ 'YYYY-MM-DD', [pecas...] ], ...] — mais recente primeiro.
export function ciclosEncerrados(list) {
  const map = {};
  soEncerrados(list).forEach(c => {
    const chave = (c.encerrado_em || c.created_at || '').slice(0, 10); // YYYY-MM-DD
    (map[chave] = map[chave] || []).push(c);
  });
  return Object.entries(map).sort((a, b) => a[0] < b[0] ? 1 : -1);
}

// Bloco "Histórico de catálogos" (somente leitura). Retorna '' se não houver ciclos encerrados.
// Usa cicloTableHtml(..., true): coluna "Status" (sem botão Vender), portanto read-only.
export function historicoCatalogosHtml(list) {
  const ciclos = ciclosEncerrados(list);
  if (!ciclos.length) return '';
  const itens = ciclos.map(([data, pecas]) => {
    const env  = pecas.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
    const vend = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
    const recv = pecas.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
    const dataFmt = data ? data.split('-').reverse().join('/') : 'sem data';
    return `<div class="hist-ciclo-card" onclick="abrirHistoricoCiclo('${data}')"
      style="cursor:pointer;border:1px solid var(--line,#eee);border-radius:10px;margin-bottom:8px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;transition:background .15s"
      onmouseover="this.style.background='rgba(0,0,0,0.02)'" onmouseout="this.style.background=''">
        <span style="font-weight:600;color:var(--plum)">Fechado em ${dataFmt}</span>
        <span style="font-size:12px;color:var(--muted)">${pecas.length} peça${pecas.length!==1?'s':''} · ${vend}/${env} vendidas · <span style="color:var(--rose)">${fmtBRL(recv)}</span> <span style="color:var(--muted);margin-left:6px">›</span></span>
      </div>`;
  }).join('');
  return `<div style="margin-top:18px">
    <div style="font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Histórico de catálogos</div>
    ${itens}
  </div>`;
}

// Resolve as peças de um ciclo encerrado, respeitando o escopo da tela:
// admin dentro de uma revendedora vê só as dela; revendedora já recebe state.allConsignados filtrado.
export function pecasDoCiclo(chave) {
  let base = state.allConsignados;
  if (ehStaff() && state.cicloRevSelecionada) base = base.filter(c => c.revendedora_id === state.cicloRevSelecionada);
  return soEncerrados(base).filter(c => (c.encerrado_em || c.created_at || '').slice(0, 10) === chave);
}

// Tela própria de um ciclo encerrado (somente leitura).
export function renderHistoricoCicloDetalhe(chave) {
  const pecas = pecasDoCiclo(chave);
  const dataFmt = chave ? chave.split('-').reverse().join('/') : 'sem data';
  const env  = pecas.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const vend = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const recv = pecas.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  return `<button class="btn-voltar-ciclo" onclick="voltarHistoricoCiclo()">← Voltar para o catálogo</button>
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">Catálogo fechado em ${dataFmt}</div>
          ${pedidoLabelHtml(pecas, 12)}
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${pecas.length} peça${pecas.length!==1?'s':''} · ${vend}/${env} vendidas</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Vendido</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--rose)">${fmtBRL(recv)}</div>
        </div>
      </div>
      ${cicloTableHtml(pecas, true, true)}
    </div>`;
}

export function abrirHistoricoCiclo(chave) {
  state.historicoCicloSel = chave;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  state.cicloSoVendidos = false;
  const cv = document.getElementById('c-so-vendidos');
  if (cv) cv.checked = false;
  renderCicloGrid();
}

export function voltarHistoricoCiclo() {
  state.historicoCicloSel = null;
  renderCicloGrid();
}

export function statsRevendedora(list) {
  const ativos = soAtivos(list);
  // Totais refletem APENAS o catálogo atual (ativo). A receita histórica fica no bloco de histórico.
  const totalEnv = ativos.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const totalVend = ativos.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const totalRecv = ativos.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  return { ativos, temAtivos: ativos.length > 0, totalEnv, totalVend, totalRecv };
}

export function renderCicloAdmin() {
  const groups = agruparPorRevendedora();

  if (state.cicloRevSelecionada && groups[state.cicloRevSelecionada]) {
    return renderCicloAdminDetalhe(state.cicloRevSelecionada, groups[state.cicloRevSelecionada]);
  }

  const ordered = Object.entries(groups).sort((a, b) => {
    const na = (state.revNameMap[a[0]] || 'zzz').toLowerCase();
    const nb = (state.revNameMap[b[0]] || 'zzz').toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  const cards = ordered.map(([revId, list]) => {
    const nome = state.revNameMap[revId] || 'Revendedora desconhecida';
    const { temAtivos, ativos, totalEnv, totalVend, totalRecv } = statsRevendedora(list);
    return `<div class="rev-card${temAtivos ? '' : ' inativo'}" onclick="abrirCicloRev('${revId}')">
      <div class="rev-card-nome">${esc(nome)}</div>
      ${pedidoLabelHtml(list, 11)}
      <div class="rev-card-status${temAtivos ? '' : ' inativo'}">${temAtivos ? `● ${ativos.length} ativa${ativos.length!==1?'s':''}` : '○ Sem catálogo ativo'}</div>
      <div class="rev-card-valor-label">Vendido até agora</div>
      <div class="rev-card-valor">${fmtBRL(totalRecv)}</div>
      <div class="rev-card-stats">
        <div><b>${ativos.length}</b> peça${ativos.length!==1?'s':''}</div>
        <div>·</div>
        <div><b>${totalVend}</b>/${totalEnv} vendida${totalVend!==1?'s':''}</div>
      </div>
    </div>`;
  }).join('');

  const ativosGlobal = soAtivos(state.allConsignados);
  const grandTotal = ativosGlobal.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  const totalPecasVend = ativosGlobal.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const totalRevsAtivas = Object.values(groups).filter(l => l.some(c => c.status === 'ativo')).length;

  return `<button class="btn-secondary" style="width:100%;margin-bottom:14px;border-color:var(--rose);color:var(--rose)" onclick="openBuscaPeca()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> Buscar peça — com quem está</button>
    <div class="rev-grid">${cards}</div>
    <div class="rev-total-geral">
      <div>
        <div class="rev-total-geral-label">Total geral vendido</div>
        <div class="rev-total-geral-sub">${totalRevsAtivas} revendedora${totalRevsAtivas!==1?'s':''} ativa${totalRevsAtivas!==1?'s':''} · ${totalPecasVend} peça${totalPecasVend!==1?'s':''} vendida${totalPecasVend!==1?'s':''}</div>
      </div>
      <div class="rev-total-geral-valor">${fmtBRL(grandTotal)}</div>
    </div>`;
}

export function renderCicloAdminDetalhe(revId, list) {
  const nome = state.revNameMap[revId] || 'Revendedora desconhecida';
  const { temAtivos, ativos, totalEnv, totalVend, totalRecv } = statsRevendedora(list);

  const btnMaleta = ehGestor()
    ? `<button class="btn-secondary btn-sm" style="border-color:var(--rose);color:var(--rose)" data-bling-id="${state.revBlingMap[revId] || ''}" data-rev-nome="${esc(nome)}" onclick="atualizarMaleta('${revId}', this)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg> Atualizar itens da maleta</button>`
    : '';
  const acoes = ehGestor()
    ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${btnMaleta}
        ${temAtivos ? `<button class="btn-secondary btn-sm" style="border-color:var(--gold);color:var(--gold)" onclick="finalizarCicloRev('${revId}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Finalizar catálogo</button>
        <button class="btn-danger btn-sm" onclick="deletarCicloRev('${revId}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Deletar catálogo</button>` : ''}
      </div>`
    : (temAtivos ? '' : `<div style="margin-top:10px;font-size:12px;color:var(--muted)">Sem catálogo ativo</div>`);

  const termo = (document.getElementById('c-search')?.value || '').toLowerCase().trim();
  let listaTabela = ativos;
  if (termo) {
    listaTabela = listaTabela.filter(c =>
      (c.descricao || '').toLowerCase().includes(termo) ||
      (c.referencia || '').toLowerCase().includes(termo)
    );
  }
  if (state.cicloSoVendidos) listaTabela = listaTabela.filter(foiVendida);
  const msgVazio = state.cicloSoVendidos
    ? (termo ? `Nenhuma peça vendida encontrada com "${termo}"` : 'Nenhuma peça vendida neste catálogo')
    : `Nenhuma peça encontrada com "${termo}"`;
  const tabelaHtml = (!listaTabela.length && (termo || state.cicloSoVendidos))
    ? `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${msgVazio}</p></div>`
    : cicloTableHtml(listaTabela, true);

  return `<button class="btn-voltar-ciclo" onclick="voltarCardsCiclo()">← Voltar para revendedoras</button>
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">${esc(nome)}</div>
          ${pedidoLabelHtml(ativos, 12)}
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${ativos.length} peça${ativos.length!==1?'s':''} · ${totalVend}/${totalEnv} vendidas ${temAtivos ? `· <span style="color:var(--success)">${ativos.length} ativa${ativos.length!==1?'s':''}</span>` : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Vendido</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--rose)">${fmtBRL(totalRecv)}</div>
        </div>
      </div>
      ${tabelaHtml}
      ${acoes}
    </div>
    ${historicoCatalogosHtml(list)}`;
}

export function abrirCicloRev(revId) {
  state.cicloRevSelecionada = revId;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  state.cicloSoVendidos = false;
  const cv = document.getElementById('c-so-vendidos');
  if (cv) cv.checked = false;
  renderCicloGrid();
}

export function voltarCardsCiclo() {
  state.cicloRevSelecionada = null;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  state.cicloSoVendidos = false;
  const cv = document.getElementById('c-so-vendidos');
  if (cv) cv.checked = false;
  renderCicloGrid();
}

export function openBuscaPeca() {
  const input = document.getElementById('bp-search');
  input.value = '';
  renderBuscaPeca();
  openModal('modal-busca-peca');
  setTimeout(() => input.focus(), 100);
}

export function renderBuscaPeca() {
  const div = document.getElementById('bp-results');
  const termo = (document.getElementById('bp-search').value || '').toLowerCase().trim();
  if (!termo) {
    div.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div><p>Digite o nome ou código da peça acima.</p></div>';
    return;
  }
  // Busca serve para saber onde a peça está AGORA: só catálogo ativo.
  const matches = soAtivos(state.allConsignados).filter(c =>
    (c.descricao || '').toLowerCase().includes(termo) ||
    (c.referencia || '').toLowerCase().includes(termo)
  ).sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''));

  if (!matches.length) {
    div.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma peça encontrada com "${termo}"</p></div>`;
    return;
  }

  div.innerHTML = matches.map(c => {
    const vendida = c.quantidade_vendida || 0;
    const disp = qtdDisp(c);
    const nomeRev = state.revNameMap[c.revendedora_id] || 'Revendedora desconhecida';
    const segs = [];
    if (disp > 0) segs.push(`<span style="color:var(--success);font-weight:600">● ${disp} disponíve${disp !== 1 ? 'is' : 'l'}</span>`);
    if (vendida > 0) segs.push(`<span style="color:var(--rose);font-weight:600"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${vendida} vendida${vendida !== 1 ? 's' : ''}</span>`);
    if (!segs.length) segs.push('<span style="color:var(--muted)">Sem unidades</span>');
    const ref = c.referencia ? `<span style="color:var(--muted)">REF ${esc(c.referencia)} · </span>` : '';
    return `<div style="padding:12px 14px;border:1px solid var(--line,#eee);border-radius:12px;margin-bottom:8px">
      <div style="font-weight:600;color:var(--plum)">${esc(c.descricao)}</div>
      <div style="font-size:12px;margin-top:3px">${ref}<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg> <b>${esc(nomeRev)}</b></div>
      <div style="font-size:12px;margin-top:4px">${segs.join(' · ')}${c.preco_venda ? ` <span style="color:var(--muted)">· R$ ${Number(c.preco_venda).toFixed(2)}</span>` : ''}</div>
    </div>`;
  }).join('');
}

export async function finalizarCicloRev(revId) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const nome = state.revNameMap[revId] || 'esta revendedora';
  const ativos = state.allConsignados.filter(c => c.revendedora_id === revId && c.status === 'ativo');
  if (!ativos.length) { toast('Nenhum catálogo ativo para finalizar'); return; }
  confirmarAcao('Finalizar catálogo', `Finalizar catálogo de ${nome}?\n\n${ativos.length} peça${ativos.length>1?'s':''} passarão para "encerrado". Essa ação não pode ser desfeita.`, 'Finalizar', async () => {
    let error;
    try {
      ({ error } = await sb.from('consignados')
        .update({ status: 'encerrado', encerrado_em: new Date().toISOString() })
        .eq('revendedora_id', revId)
        .eq('status', 'ativo'));
    } catch (e) { error = e; }
    if (await handleSupabaseError(error, 'Erro ao finalizar catálogo')) return;
    toast(`Catálogo de ${nome} encerrado`);
    loadConsignados();
  });
}

export async function deletarCicloRev(revId) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const nome = state.revNameMap[revId] || 'esta revendedora';
  const ativos = state.allConsignados.filter(c => c.revendedora_id === revId && c.status === 'ativo');
  if (!ativos.length) { toast('Nenhum catálogo ativo para deletar'); return; }
  confirmarAcao('⚠ Deletar catálogo', `DELETAR o catálogo ativo de ${nome}?\n\n${ativos.length} peça${ativos.length>1?'s':''} ativa${ativos.length>1?'s':''} serão APAGADAS PERMANENTEMENTE (catálogos já encerrados NÃO são tocados).\n\nEssa ação não pode ser desfeita.`, 'Sim, deletar tudo', async () => {
    // SEGURANÇA: o .eq('status','ativo') garante que ciclos encerrados são preservados
    let error;
    try {
      ({ error } = await sb.from('consignados')
        .delete()
        .eq('revendedora_id', revId)
        .eq('status', 'ativo'));
    } catch (e) { error = e; }
    if (await handleSupabaseError(error, 'Erro ao deletar catálogo')) return;
    toast(`Catálogo ativo de ${nome} deletado`);
    loadConsignados();
  });
}

export function openVenda(id) {
  const c = state.allConsignados.find(x => x.id === id);
  const dispOrig = qtdDisp(c);
  const noCarrinho = state.carrinhoVenda.filter(i => i.consignado_id === id).reduce((s, i) => s + i.quantidade, 0);
  const disp = dispOrig - noCarrinho;
  if (disp <= 0) { toast('Todas as unidades dessa peça já estão no carrinho'); return; }

  document.getElementById('venda-title').textContent = 'Adicionar ao carrinho';
  document.getElementById('v-info').innerHTML =
    `<div style="font-weight:500;color:var(--plum);margin-bottom:2px">${esc(c.descricao)}</div>
     <div style="font-size:11px;color:var(--muted)">${c.referencia ? esc(c.referencia) + ' · ' : ''}${disp} disponíve${disp!==1?'is':'l'} · R$ ${Number(c.preco_venda || 0).toFixed(2)} cada</div>`;
  document.getElementById('v-consig-id').value = id;
  document.getElementById('v-disp').value = disp;
  document.getElementById('v-preco-unit').value = c.preco_venda || 0;
  document.getElementById('v-qtd').value = 1;
  document.getElementById('v-qtd').max = disp;
  atualizarTotalVenda();
  openModal('modal-venda');
}

export function atualizarTotalVenda() {
  const qtd = parseInt(document.getElementById('v-qtd').value) || 1;
  const preco = parseFloat(document.getElementById('v-preco-unit').value) || 0;
  document.getElementById('v-total').value = 'R$ ' + (qtd * preco).toFixed(2);
}

export function adicionarAoCarrinho() {
  const id = document.getElementById('v-consig-id').value;
  const disp = parseInt(document.getElementById('v-disp').value);
  const qtd = parseInt(document.getElementById('v-qtd').value);
  const precoUnit = parseFloat(document.getElementById('v-preco-unit').value) || 0;
  if (!qtd || qtd < 1 || qtd > disp) { toast('Quantidade inválida'); return; }

  const c = state.allConsignados.find(x => x.id === id);
  const existente = state.carrinhoVenda.find(i => i.consignado_id === id);
  if (existente) {
    existente.quantidade += qtd;
  } else {
    state.carrinhoVenda.push({
      consignado_id: id,
      descricao: c.descricao,
      referencia: c.referencia,
      quantidade: qtd,
      preco_unit: precoUnit
    });
  }

  toast(`${qtd}× ${c.descricao} adicionado${qtd>1?'s':''} ao carrinho`);
  closeModal('modal-venda');
  renderCartBar();
}

export function removerDoCarrinho(idx) {
  state.carrinhoVenda.splice(idx, 1);
  renderCartBar();
  if (document.getElementById('modal-finalizar').classList.contains('show')) {
    if (!state.carrinhoVenda.length) { closeModal('modal-finalizar'); return; }
    abrirFinalizarVenda();
  }
}

export function renderCartBar() {
  const bar = document.getElementById('cart-bar');
  if (!bar) return;
  const cl = document.getElementById('c-list');
  if (!state.carrinhoVenda.length) {
    bar.style.display = 'none'; bar.innerHTML = '';
    if (cl) cl.style.paddingBottom = '';
    return;
  }
  const totalItens = state.carrinhoVenda.reduce((s, i) => s + i.quantidade, 0);
  const totalValor = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="cart-info">
      <div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg> <b>${totalItens}</b> ite${totalItens!==1?'ns':'m'}</div>
      <div class="cart-info-total">R$ ${totalValor.toFixed(2)}</div>
    </div>
    <button class="btn-finalizar" onclick="abrirFinalizarVenda()">Finalizar →</button>`;
  // Espaço extra no fim da lista para o último item não ficar atrás da barra fixa.
  if (cl) cl.style.paddingBottom = '84px';
}

export function abrirFinalizarVenda() {
  if (!state.carrinhoVenda.length) { toast('Carrinho vazio'); return; }
  const lista = document.getElementById('f-cart-list');
  const total = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  lista.innerHTML = state.carrinhoVenda.map((it, idx) => `
    <div class="cart-item-row">
      <div style="flex:1">
        <div class="cart-item-desc">${esc(it.descricao)}</div>
        <div class="cart-item-meta">${it.quantidade}× R$ ${Number(it.preco_unit).toFixed(2)}</div>
      </div>
      <div class="cart-item-total">R$ ${(it.quantidade * it.preco_unit).toFixed(2)}</div>
      <button class="cart-remove" onclick="removerDoCarrinho(${idx})" title="Remover"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
    </div>`).join('') +
    `<div class="cart-total-row"><span>Total</span><span>R$ ${total.toFixed(2)}</span></div>`;

  document.getElementById('f-cliente').value = '';
  document.getElementById('f-data').value = hojeBR();
  document.getElementById('f-forma').value = 'Pix';
  document.getElementById('f-obs').value = '';
  ajustarValorPago();
  openModal('modal-finalizar');
}

export function ajustarValorPago() {
  const total = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const forma = document.getElementById('f-forma').value;
  const aVista = ['Dinheiro', 'Pix', 'Cartão débito', 'Cartão crédito'].includes(forma);
  document.getElementById('f-pago').value = aVista ? moneyToInput(total) : '';
}

export async function confirmarVendaCarrinho(btn) {
  const cliente = document.getElementById('f-cliente').value.trim();
  const data = brToISO(document.getElementById('f-data').value);
  const forma = document.getElementById('f-forma').value;
  const pago = parseMoneyBR(document.getElementById('f-pago').value);
  const obs = document.getElementById('f-obs').value.trim();

  if (!cliente) { toast('Informe o nome da cliente'); return; }
  if (!data) { toast('Data inválida (use dd/mm/aaaa)'); return; }
  if (!state.carrinhoVenda.length) { toast('Carrinho vazio'); return; }

  const total = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const status = pago >= total ? 'quitado' : pago > 0 ? 'parcial' : 'pendente';

  btn.disabled = true;
  btn.textContent = '⟳ Salvando...';
  const resetBtn = () => { btn.disabled = false; btn.textContent = 'Confirmar venda'; };

  try {
    // Venda atômica via RPC: cria venda + itens + recebimento e incrementa
    // quantidade_vendida numa única transação (ver db-functions.sql).
    // Evita venda órfã sem itens e a race condition do read-modify-write.
    const { error: errRpc } = await sbQ(
      sb.rpc('registrar_venda', {
        p_cliente: cliente,
        p_data: data,
        p_forma: forma,
        p_total: total,
        p_pago: pago,
        p_status: status,
        p_obs: obs || null,
        p_itens: state.carrinhoVenda.map(it => ({
          consignado_id: it.consignado_id,
          descricao: it.descricao,
          referencia: it.referencia || null,
          quantidade: it.quantidade,
          preco_unit: it.preco_unit
        }))
      })
    );

    if (errRpc) {
      console.error('Erro ao registrar venda (RPC):', errRpc);
      const msg = /registrar_venda|function|does not exist|schema cache/i.test(errRpc.message || '')
        ? 'Função do banco não encontrada — rode db-functions.sql no Supabase.'
        : ('Erro: ' + (errRpc.message || 'tente novamente'));
      toast(msg);
      resetBtn();
      return;
    }

    state.carrinhoVenda = [];
    resetBtn();
    toast('Venda registrada!');
    closeModal('modal-finalizar');
    renderCartBar();
    state.allVendas = [];
    await loadConsignados();
  } catch (e) {
    console.error('Falha inesperada na venda:', e);
    toast('Erro inesperado — confira em Pagamentos antes de tentar de novo');
    resetBtn();
  }
}

export async function openNovoConsignado() {
  const { data: revs } = await sb.from('profiles').select('id,nome').eq('role','revendedora').eq('aprovada',true);
  const sel = document.getElementById('c-rev');
  sel.innerHTML = revs.map(r => `<option value="${r.id}">${esc(r.nome)}</option>`).join('');
  ['c-desc','c-ref','c-custo','c-venda'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('c-qtd').value = 1;
  document.getElementById('c-cat').value = '';
  document.getElementById('c-foto-preview').style.display = 'none';
  document.getElementById('c-foto-placeholder').style.display = 'block';
  document.getElementById('c-foto-input').value = '';
  openModal('modal-consignado');
}

export async function salvarConsignado() {
  const desc = document.getElementById('c-desc').value.trim();
  const revId = document.getElementById('c-rev').value;
  const qtd = parseInt(document.getElementById('c-qtd').value);
  if (!desc || !revId || !qtd) { toast('Preencha os campos obrigatórios'); return; }

  let foto_url = null;
  const fileInput = document.getElementById('c-foto-input');
  if (fileInput.files[0]) {
    const file = fileInput.files[0];
    const fname = `consig/${Date.now()}.${file.name.split('.').pop()}`;
    const { error } = await sb.storage.from('lizzie-fotos').upload(fname, file, { upsert: true });
    if (!error) {
      const { data: { publicUrl } } = sb.storage.from('lizzie-fotos').getPublicUrl(fname);
      foto_url = publicUrl;
    }
  }

  const { error } = await sb.from('consignados').insert({
    revendedora_id: revId,
    descricao: desc,
    referencia: document.getElementById('c-ref').value.trim() || null,
    quantidade_enviada: qtd,
    preco_custo: parseMoneyBR(document.getElementById('c-custo').value) || null,
    preco_venda: parseMoneyBR(document.getElementById('c-venda').value) || null,
    foto_url
  });
  if (await handleSupabaseError(error, 'Erro ao adicionar peça')) return;
  toast('Peça adicionada ao catálogo!');
  closeModal('modal-consignado');
  loadConsignados();
}

export function openFechamento() {
  const restantes = state.allConsignados.filter(c =>
    qtdDisp(c) > 0
  );

  if (!restantes.length) {
    toast('Nenhuma peça restante — catálogo já está limpo!');
    return;
  }

  const total = restantes.reduce((s, c) => s + qtdDisp(c), 0);
  const valorTotal = restantes.reduce((s, c) => {
    const qtd = qtdDisp(c);
    return s + (qtd * (c.preco_venda || 0));
  }, 0);

  document.getElementById('fechamento-content').innerHTML = `
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      ${restantes.length} ite${restantes.length!==1?'ns':'m'} restante${restantes.length!==1?'s':''} — ${total} unidade${total!==1?'s':''}
    </p>
    <div class="ciclo-wrap" style="margin-bottom:8px">
      <table class="ciclo-table">
        <thead><tr>
          <th class="ciclo-th ciclo-th-nosort">SKU</th>
          <th class="ciclo-th ciclo-th-nosort">Descrição</th>
          <th class="ciclo-th ciclo-th-nosort" style="text-align:center">Qtd</th>
          <th class="ciclo-th ciclo-th-nosort">Preço unit.</th>
        </tr></thead>
        <tbody>
          ${restantes.map(c => {
            const qtd = qtdDisp(c);
            return `<tr class="ciclo-row">
              <td class="ciclo-td"><span class="ciclo-ref">${esc(c.referencia||'—')}</span></td>
              <td class="ciclo-td"><span class="ciclo-desc">${esc(c.descricao)}</span></td>
              <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${qtd}</span></td>
              <td class="ciclo-td"><span class="ciclo-preco">${c.preco_venda ? 'R$ '+Number(c.preco_venda).toFixed(2) : '—'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="text-align:right;font-size:13px;color:var(--muted)">
      Total estimado a devolver: <strong style="color:var(--plum)">R$ ${valorTotal.toFixed(2)}</strong>
    </div>`;

  openModal('modal-fechamento');
}

export function gerarPdfFechamento() {
  const restantes = state.allConsignados.filter(c =>
    qtdDisp(c) > 0
  );
  const hoje = new Date().toLocaleDateString('pt-BR');
  const nomeRev = state.currentProfile.nome;
  const total = restantes.reduce((s, c) => s + qtdDisp(c), 0);
  const valorTotal = restantes.reduce((s, c) => {
    const qtd = qtdDisp(c);
    return s + (qtd * (c.preco_venda || 0));
  }, 0);

  const linhas = restantes.map((c, i) => {
    const qtd = qtdDisp(c);
    return `<tr style="background:${i%2===0?'#faf7f2':'#fff'}">
      <td style="padding:9px 12px;font-size:12px;color:#8a7590">${esc(c.referencia||'—')}</td>
      <td style="padding:9px 12px;font-size:13px">${esc(c.descricao)}</td>
      <td style="padding:9px 12px;text-align:center;font-size:13px">${qtd}</td>
      <td style="padding:9px 12px;text-align:right;font-size:13px">${c.preco_venda?'R$ '+Number(c.preco_venda).toFixed(2):'—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('print-content').innerHTML = `
    <div style="margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a7590;margin-bottom:6px">Lizzie Semijoias</div>
      <h1 style="font-family:'Georgia',serif;font-size:22px;font-weight:400;margin:0 0 4px">Fechamento do Catálogo</h1>
      <div style="font-size:13px;color:#8a7590">Revendedora: <strong style="color:#2d1f35">${esc(nomeRev)}</strong> &nbsp;·&nbsp; Data: ${hoje} &nbsp;·&nbsp; ${restantes.length} iten${restantes.length!==1?'s':''} · ${total} unidade${total!==1?'s':''}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead>
        <tr style="background:#1a0a2e;color:#fff">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">SKU</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">Descrição</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">Qtd</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">Preço unit.</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <div style="text-align:right;font-size:14px;font-weight:600;margin-bottom:48px">
      Total estimado a devolver: R$ ${valorTotal.toFixed(2)}
    </div>
    <div style="display:flex;gap:60px;margin-top:48px">
      <div style="flex:1;border-top:1px solid #ccc;padding-top:8px;font-size:12px;color:#8a7590">Assinatura da revendedora</div>
      <div style="flex:1;border-top:1px solid #ccc;padding-top:8px;font-size:12px;color:#8a7590">Assinatura Lizzie Semijoias</div>
    </div>`;

  closeModal('modal-fechamento');
  document.getElementById('print-overlay').classList.add('show');
  setTimeout(() => window.print(), 300);
}

export function fecharPrint() {
  document.getElementById('print-overlay').classList.remove('show');
}
