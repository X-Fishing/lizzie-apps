// Catalogo/ciclo: grade, detalhe, historico de catalogos, carrinho de venda, fechamento (PDF), busca de peca.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast, handleSupabaseError, confirmarAcao, openModal, closeModal, qtdDisp, detectarCategoria, CAT_LABEL, parseMoneyBR, moneyToInput, brToISO, diaMesParaISO, hojeBR, ehRevTeste, marcarRevsTeste } from './utils.js';
const soDigitos = s => (s || '').replace(/\D/g, '');
import { IS_ADMIN, PERMISSOES } from './menu.js';
export async function loadConsignados() {
  confTelaAberta = false; fechTelaAberta = false;
  document.getElementById('c-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const isAdmin = ehStaff();
  const makeQ = () => {
    let q = sb.from('consignados').select('*');
    if (!isAdmin) q = q.eq('revendedora_id', state.currentUser.id);
    return q.order('created_at', { ascending: false });
  };
  const queries = [fetchPaginado(makeQ)];
  if (isAdmin) {
    queries.push(sbQ(sb.from('profiles').select('*').eq('is_revendedora', true)));
  } else {
    // revendedora: descobre a maleta ATIVA (o catálogo só mostra peças dela)
    queries.push(sbQ(sb.from('maletas').select('id').eq('revendedora_id', state.currentUser.id).eq('status', 'ativa').maybeSingle()));
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
    marcarRevsTeste(revs); // contas TESTE ficam fora dos totais agregados
  } else {
    state.maletaAtivaId = results[1].data?.id || null;
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
  // Sub-telas (conferência/fechamento) renderizam no lugar do catálogo, na
  // largura normal centralizada (mesmo padrão do histórico de ciclos).
  if (confTelaAberta || fechTelaAberta) {
    const sb = document.getElementById('c-search-bar');
    if (sb) sb.style.display = 'none';
    div.innerHTML = confTelaAberta ? confTelaSkeletonHtml() : fechTelaSkeletonHtml();
    return;
  }
  if (state.historicoCicloSel) {
    const sb = document.getElementById('c-search-bar');
    if (sb) sb.style.display = 'none';
    div.innerHTML = renderHistoricoCicloDetalhe(state.historicoCicloSel);
    preencherComissaoHistorico(state.historicoCicloSel); // async, preenche depois
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
  // Venda reconhecida só na conferência física do fechamento: badge âmbar distinto.
  const badgeDiv = '<span style="font-size:11px;color:var(--warning);font-weight:600" title="Não voltou na maleta e não havia sido lançada como vendida">Vendido (divergência)</span>';
  if (historico) {
    // Status por VENDA real (não por estoque). Peça vendida fica em destaque (sem fade).
    if (vendida > 0) {
      acao = c.vendido_por_divergencia ? badgeDiv
        : `<span style="font-size:11px;color:var(--success);font-weight:600">Vendido${vendida>1?` (${vendida})`:''}</span>`;
    } else {
      acao = `<span style="font-size:11px;color:var(--muted)">Não vendido</span>`;
      extraStyle = ' style="opacity:.55"'; // esmaece só a NÃO vendida
    }
  } else {
    const statusVendido = c.vendido_por_divergencia ? badgeDiv : 'Vendido';
    acao = isAdmin
      ? `<span style="font-size:11px;color:var(--muted)">${c.status === 'encerrado' ? 'Encerrado' : (esgotado ? statusVendido : '—')}</span>`
      : (!esgotado ? `<button class="btn-vender" onclick="openVenda('${c.id}')">Vender</button>` : '<span style="font-size:11px;color:var(--muted)">Vendido</span>');
    extraClass = esgotado ? ' esgotado' : '';
  }
  return `<tr class="ciclo-row${extraClass}"${extraStyle}>
    <td class="ciclo-td">
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn-icon" title="Ver foto" style="color:var(--rose);padding:2px;flex:none" onclick="confVerFoto('${c.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></button>
        <div style="min-width:0">
          <div class="ciclo-desc">${esc(c.descricao)}</div>
        </div>
      </div>
    </td>
    <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">${c.referencia ? esc(c.referencia) : '—'}</td>
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
          ${cicloTh('referencia','SKU')}
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
  // catálogo da revendedora = apenas peças da maleta ATIVA dela (aguardando fica oculta).
  // Se não houver maleta ativa registrada (dados legados), cai no comportamento antigo.
  let ativos = soAtivos(state.allConsignados);
  if (state.maletaAtivaId) ativos = ativos.filter(c => c.maleta_id === state.maletaAtivaId);
  const temAtivos = ativos.some(c => qtdDisp(c) > 0);
  const btnDivulgar = temAtivos
    ? `<button class="btn-primary" style="width:100%;margin-top:16px" onclick="abrirDivulgarMaleta()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Divulgar minha maleta</button>`
    : '';
  const btnFechamento = temAtivos
    ? `<button class="btn-secondary" style="width:100%;margin-top:10px;border-color:var(--gold);color:var(--gold)" onclick="openFechamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg> Fechamento do Catálogo</button>`
    : '';

  const historico = historicoCatalogosHtml(state.allConsignados);
  const cabecalho = pedidoLabelHtml(ativos, 12);

  const termo = (document.getElementById('c-search')?.value || '').toLowerCase().trim();
  if (termo || state.cicloSoVendidos || state.cicloSoNaoVendidos) {
    let lista = ativos;
    if (termo) {
      lista = lista.filter(c =>
        (c.descricao || '').toLowerCase().includes(termo) ||
        (c.referencia || '').toLowerCase().includes(termo)
      );
    }
    if (state.cicloSoVendidos) lista = lista.filter(foiVendida);
    if (state.cicloSoNaoVendidos) lista = lista.filter(c => !foiVendida(c));
    if (!lista.length) {
      const msgVazio = state.cicloSoVendidos
        ? (termo ? `Nenhuma peça vendida encontrada com "${termo}"` : 'Nenhuma peça vendida neste catálogo')
        : state.cicloSoNaoVendidos
          ? (termo ? `Nenhuma peça não vendida encontrada com "${termo}"` : 'Nenhuma peça não vendida neste catálogo')
          : `Nenhuma peça encontrada com "${termo}"`;
      return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${msgVazio}</p></div>` + historico;
    }
    return cabecalho + cicloTableHtml(lista, false) + btnDivulgar + btnFechamento + historico;
  }

  // Sem catálogo ativo: mostra aviso + histórico (se houver), em vez de tabela vazia.
  if (!ativos.length) {
    return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></div><p>Nenhum catálogo ativo no momento</p></div>` + historico;
  }

  return cabecalho + cicloTableHtml(ativos, false) + btnDivulgar + btnFechamento + historico;
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

// Os dois filtros são mutuamente exclusivos (marcar um desmarca o outro).
export function toggleCicloSoVendidos(el) {
  state.cicloSoVendidos = !!el.checked;
  if (el.checked) {
    state.cicloSoNaoVendidos = false;
    const o = document.getElementById('c-so-nao-vendidos');
    if (o) o.checked = false;
  }
  renderCicloGrid();
}

export function toggleCicloSoNaoVendidos(el) {
  state.cicloSoNaoVendidos = !!el.checked;
  if (el.checked) {
    state.cicloSoVendidos = false;
    const o = document.getElementById('c-so-vendidos');
    if (o) o.checked = false;
  }
  renderCicloGrid();
}

function limparFiltrosVendidos() {
  state.cicloSoVendidos = false;
  state.cicloSoNaoVendidos = false;
  const cv = document.getElementById('c-so-vendidos');
  if (cv) cv.checked = false;
  const cnv = document.getElementById('c-so-nao-vendidos');
  if (cnv) cnv.checked = false;
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
  // Correção de conferência: só admin (ou perfil com a ação especial), e só
  // no contexto admin com revendedora aberta (o modo correção usa esse escopo).
  const btnCorrigir = (ehStaff() && state.cicloRevSelecionada && podeCorrigirMaleta())
    ? `<div class="btn-group" style="margin-bottom:12px">
        <button class="btn btn-outline" onclick="abrirConferenciaCorrecao('${chave}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Corrigir conferência</button>
      </div>` : '';
  return `<button class="btn-voltar-ciclo" onclick="voltarHistoricoCiclo()">← Voltar para o catálogo</button>
    <div class="card">
      ${btnCorrigir}
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
      <div id="hist-comissao"></div>
      ${cicloTableHtml(pecas, true, true)}
    </div>`;
}

// Linha de comissão do fechamento (lida da auditoria; só staff enxerga).
async function preencherComissaoHistorico(chave) {
  const el = document.getElementById('hist-comissao');
  if (!el || !ehStaff() || !state.cicloRevSelecionada) return;
  const { data, error } = await sbQ(sb.from('fechamentos_mostruario')
    .select('id,comissao_percentual,comissao_valor,valor_a_receber,total_vendido_valor,corrigido_em')
    .eq('revendedora_id', state.cicloRevSelecionada)
    .gte('created_at', chave + 'T00:00:00').lte('created_at', chave + 'T23:59:59.999')
    .order('created_at', { ascending: false }).limit(1));
  if (error) { console.error('Comissão do fechamento:', error); return; }
  const f = data?.[0];
  if (!f || f.comissao_percentual == null) return;
  el.innerHTML = `<div style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--blush);font-size:13px;display:flex;gap:18px;flex-wrap:wrap;align-items:center">
    <span>Comissão: <b style="color:var(--rose)">${String(Number(f.comissao_percentual)).replace('.', ',')}%</b> · <b style="color:var(--rose)">${fmtBRL(f.comissao_valor)}</b></span>
    <span>A receber: <b style="color:var(--success)">${fmtBRL(f.valor_a_receber)}</b></span>
    ${f.corrigido_em ? `<span style="color:var(--muted);font-size:11.5px">corrigido em ${formatDate(f.corrigido_em)}</span>` : ''}
    ${ehGestor() ? `<button class="btn-secondary btn-sm" onclick="abrirRecebimento('${f.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg> Recebimento</button>` : ''}
  </div>`;
}

export function abrirHistoricoCiclo(chave) {
  confTelaAberta = false; fechTelaAberta = false;
  state.historicoCicloSel = chave;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  limparFiltrosVendidos();
  renderCicloGrid();
}

export function voltarHistoricoCiclo() {
  confTelaAberta = false; fechTelaAberta = false;
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

// Estado da tela de cards (client-side, não persiste no banco).
let cicloAdmBusca = '';
let cicloAdmOrdem = 'vendas';   // 'vendas' | 'conversao' | 'nome'
const cicloIniciais = n => (n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// Monta a lista de revendedoras já enriquecida (stats + conversão), aplicando
// busca e ordenação atuais. Reusada no render inicial e no re-render do grid.
function cicloAdmDados() {
  const groups = agruparPorRevendedora();
  const linhas = Object.entries(groups).map(([revId, list]) => {
    const nome = state.revNameMap[revId] || 'Revendedora desconhecida';
    const s = statsRevendedora(list);
    const conv = s.totalEnv ? s.totalVend / s.totalEnv : 0;
    return { revId, nome, list, ...s, conv };
  });
  const topRevId = linhas.filter(l => !ehRevTeste(l.revId) && l.totalRecv > 0)
    .sort((a, b) => b.totalRecv - a.totalRecv)[0]?.revId || null;
  const termo = cicloAdmBusca.trim().toLowerCase();
  const filtradas = termo ? linhas.filter(l => l.nome.toLowerCase().includes(termo)) : linhas;
  filtradas.sort((a, b) => {
    if (cicloAdmOrdem === 'nome') return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1;
    if (cicloAdmOrdem === 'conversao') return b.conv - a.conv;
    return b.totalRecv - a.totalRecv;   // 'vendas'
  });
  return { linhas: filtradas, topRevId };
}

// Só os cards — para re-render sem recriar a busca (não perde o foco).
function cicloAdmCardsHtml() {
  const { linhas, topRevId } = cicloAdmDados();
  if (!linhas.length) return '<div class="empty-state" style="padding:30px 0"><p style="font-size:13px;color:var(--muted)">Nenhuma revendedora encontrada.</p></div>';
  return linhas.map(l => {
    const convPct = Math.round(l.conv * 100);
    const faixa = l.temAtivos ? 'var(--grad-rose)' : 'var(--border)';
    return `<div class="rev-card${l.temAtivos ? '' : ' inativo'}" style="position:relative;overflow:hidden;padding-top:16px" onclick="abrirCicloRev('${l.revId}')">
      <div style="position:absolute;top:0;left:0;right:0;height:4px;background:${faixa}"></div>
      ${l.revId === topRevId ? '<span class="badge" style="position:absolute;top:12px;right:12px;background:var(--gold);color:#fff;font-size:10px">TOP</span>' : ''}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="width:38px;height:38px;border-radius:50%;background:var(--blush);color:var(--rose);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">${cicloIniciais(l.nome)}</span>
        <div style="min-width:0">
          <div class="rev-card-nome" style="margin:0">${esc(l.nome)}${ehRevTeste(l.revId) ? ' <span class="badge-soon" style="background:var(--warning);color:#fff">TESTE</span>' : ''}</div>
          <div class="rev-card-status${l.temAtivos ? '' : ' inativo'}" style="margin:0">${l.temAtivos ? `● ${l.ativos.length} ativa${l.ativos.length!==1?'s':''}` : '○ Sem catálogo ativo'}</div>
        </div>
      </div>
      ${pedidoLabelHtml(l.list, 11)}
      <div class="rev-card-valor-label">Vendido até agora</div>
      <div class="rev-card-valor">${fmtBRL(l.totalRecv)}</div>
      <div style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px">
          <span>${l.totalVend}/${l.totalEnv} peça${l.totalEnv!==1?'s':''} vendida${l.totalVend!==1?'s':''}</span><span>${convPct}%</span>
        </div>
        <div style="height:6px;border-radius:4px;background:var(--blush);overflow:hidden">
          <div style="height:100%;width:${Math.min(100, convPct)}%;background:linear-gradient(90deg,var(--rose),var(--gold))"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function renderCicloAdmin() {
  const groups = agruparPorRevendedora();

  if (state.cicloRevSelecionada && groups[state.cicloRevSelecionada]) {
    return renderCicloAdminDetalhe(state.cicloRevSelecionada, groups[state.cicloRevSelecionada]);
  }

  // Totais agregados IGNORAM revendedoras TESTE (os cards delas continuam visíveis).
  const ativosGlobal = soAtivos(state.allConsignados).filter(c => !ehRevTeste(c.revendedora_id));
  const grandTotal = ativosGlobal.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  const totalPecasVend = ativosGlobal.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const totalEnvGlobal = ativosGlobal.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const totalRevsAtivas = Object.entries(groups).filter(([revId, l]) => !ehRevTeste(revId) && l.some(c => c.status === 'ativo')).length;
  const convMedia = totalEnvGlobal ? Math.round((totalPecasVend / totalEnvGlobal) * 100) : 0;
  const ticket = totalPecasVend ? grandTotal / totalPecasVend : 0;
  const chip = (val, label) => `<button class="chip${cicloAdmOrdem === val ? ' active' : ''}" onclick="cicloOrdenar('${val}')">${label}</button>`;

  return `<button class="btn-secondary" style="width:100%;margin-bottom:14px;border-color:var(--rose);color:var(--rose)" onclick="openBuscaPeca()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> Buscar peça — com quem está</button>
    <div style="background:linear-gradient(135deg,#1a0a2e,#5a2a44);border-radius:16px;padding:20px;color:#fff;margin-bottom:14px">
      <div style="font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.5px">Total vendido no ciclo</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:40px;line-height:1.1;margin-top:4px">${fmtBRL(grandTotal)}</div>
      <div style="font-size:12px;opacity:.8;margin-top:4px">${totalRevsAtivas} revendedora${totalRevsAtivas!==1?'s':''} ativa${totalRevsAtivas!==1?'s':''}</div>
    </div>
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Peças vendidas</span></div><div class="kpi-val">${totalPecasVend}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Conversão média</span></div><div class="kpi-val">${convMedia}%</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Ticket médio/peça</span></div><div class="kpi-val">${fmtBRL(ticket)}</div></div>
    </div>
    <input type="text" class="form-control" placeholder="Buscar revendedora..." value="${esc(cicloAdmBusca)}" oninput="cicloBuscar(this.value)" style="margin-bottom:10px">
    <div class="chips" style="margin-bottom:14px">
      ${chip('vendas', 'Mais vendas')}${chip('conversao', 'Conversão')}${chip('nome', 'Nome')}
    </div>
    <div class="rev-grid" id="ciclo-adm-grid">${cicloAdmCardsHtml()}</div>`;
}

// Re-render só do grid (não recria a busca → mantém o foco).
export function cicloBuscar(v) {
  cicloAdmBusca = v;
  const grid = document.getElementById('ciclo-adm-grid');
  if (grid) grid.innerHTML = cicloAdmCardsHtml();
}
export function cicloOrdenar(ordem) {
  cicloAdmOrdem = ordem;
  renderCicloGrid();   // re-render completo p/ atualizar o chip ativo
}

export function renderCicloAdminDetalhe(revId, list) {
  const nome = state.revNameMap[revId] || 'Revendedora desconhecida';
  const { temAtivos, ativos, totalEnv, totalVend, totalRecv } = statsRevendedora(list);

  // Ações em evidência no topo do card (perto do "Vendido R$ ..."):
  // Link da maleta + Finalizar Mostruário. O rodapé fica só com
  // "Atualizar itens da maleta" e "Excluir maleta aguardando".
  const acoesTopo = ehGestor()
    ? `<div class="btn-group" style="margin-bottom:14px">
        <button class="btn btn-outline" onclick="abrirDivulgarMaleta('${revId}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Link da maleta</button>
        ${temAtivos ? `<button class="btn btn-primary" onclick="abrirConferencia('${revId}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Finalizar Mostruário</button>` : ''}
      </div>`
    : '';
  const acoes = ehGestor()
    ? `<div class="btn-group" style="margin-top:12px">
        <button class="btn btn-outline" data-bling-id="${state.revBlingMap[revId] || ''}" data-rev-nome="${esc(nome)}" onclick="atualizarMaleta('${revId}', this)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg> Atualizar itens da maleta</button>
        ${temAtivos ? `<button class="btn btn-danger" onclick="deletarCicloRev('${revId}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Excluir maleta aguardando</button>` : ''}
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
  if (state.cicloSoNaoVendidos) listaTabela = listaTabela.filter(c => !foiVendida(c));
  const msgVazio = state.cicloSoVendidos
    ? (termo ? `Nenhuma peça vendida encontrada com "${termo}"` : 'Nenhuma peça vendida neste catálogo')
    : state.cicloSoNaoVendidos
      ? (termo ? `Nenhuma peça não vendida encontrada com "${termo}"` : 'Nenhuma peça não vendida neste catálogo')
      : `Nenhuma peça encontrada com "${termo}"`;
  const tabelaHtml = (!listaTabela.length && (termo || state.cicloSoVendidos || state.cicloSoNaoVendidos))
    ? `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${msgVazio}</p></div>`
    : cicloTableHtml(listaTabela, true);

  return `<button class="btn-voltar-ciclo" onclick="voltarCardsCiclo()">← Voltar para revendedoras</button>
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">${esc(nome)}${ehRevTeste(revId) ? ' <span class="badge-soon" style="background:var(--warning);color:#fff;vertical-align:middle">TESTE — fora do faturamento</span>' : ''}</div>
          ${pedidoLabelHtml(ativos, 12)}
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${ativos.length} peça${ativos.length!==1?'s':''} · ${totalVend}/${totalEnv} vendidas ${temAtivos ? `· <span style="color:var(--success)">${ativos.length} ativa${ativos.length!==1?'s':''}</span>` : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Vendido</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--rose)">${fmtBRL(totalRecv)}</div>
        </div>
      </div>
      ${acoesTopo}
      ${tabelaHtml}
      ${acoes}
    </div>
    ${historicoCatalogosHtml(list)}`;
}

export function abrirCicloRev(revId) {
  confTelaAberta = false; fechTelaAberta = false;
  state.cicloRevSelecionada = revId;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  limparFiltrosVendidos();
  renderCicloGrid();
}

export function voltarCardsCiclo() {
  confTelaAberta = false; fechTelaAberta = false;
  state.cicloRevSelecionada = null;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  limparFiltrosVendidos();
  renderCicloGrid();
}

// Catálogo-mestre (tabela produtos) pra busca por código de fornecedor e pra
// mostrar o que está no NOSSO estoque (não consignado). Carregado ao abrir o modal.
let bpProdutos = [];

export async function openBuscaPeca() {
  const input = document.getElementById('bp-search');
  input.value = '';
  renderBuscaPeca();
  openModal('modal-busca-peca');
  setTimeout(() => input.focus(), 100);
  const { data } = await fetchPaginado(() => sb.from('produtos')
    .select('id,nome,sku,codigo_fornecedor,estoque_qtd,preco_venda').order('id'));
  bpProdutos = data || [];
  renderBuscaPeca(); // re-renderiza caso já tenha termo digitado
}

function bpMatchProduto(p, termo) {
  return [p.nome, p.sku, p.codigo_fornecedor].some(v => (v || '').toLowerCase().includes(termo));
}

export function renderBuscaPeca() {
  const div = document.getElementById('bp-results');
  const termo = (document.getElementById('bp-search').value || '').toLowerCase().trim();
  if (!termo) {
    div.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div><p>Digite o nome, o código (SKU) ou o código do fornecedor.</p></div>';
    return;
  }
  // Índices do catálogo-mestre pra casar consignado → produto (por produto_id ou por SKU na referencia)
  const prodById = Object.fromEntries(bpProdutos.map(p => [String(p.id), p]));
  const prodBySku = Object.fromEntries(bpProdutos.filter(p => p.sku).map(p => [p.sku.toLowerCase(), p]));

  // Busca serve para saber onde a peça está AGORA: só catálogo ativo.
  const matches = soAtivos(state.allConsignados).filter(c => {
    if ((c.descricao || '').toLowerCase().includes(termo)) return true;
    if ((c.referencia || '').toLowerCase().includes(termo)) return true;
    const p = prodById[String(c.produto_id)] || prodBySku[(c.referencia || '').toLowerCase()];
    return p ? bpMatchProduto(p, termo) : false;
  }).sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''));

  // E o que casa no catálogo-mestre com estoque conosco (não consignado)
  const emEstoque = bpProdutos.filter(p => bpMatchProduto(p, termo) && (p.estoque_qtd || 0) > 0);
  const estoqueHTML = emEstoque.map(p => {
    const cod = [p.sku && `SKU ${esc(p.sku)}`, p.codigo_fornecedor && `FORN ${esc(p.codigo_fornecedor)}`].filter(Boolean).join(' · ');
    return `<div style="padding:12px 14px;border:1px solid var(--line,#eee);border-radius:12px;margin-bottom:8px;background:rgba(91,110,92,0.06)">
      <div style="font-weight:600;color:var(--plum)">${esc(p.nome)}</div>
      <div style="font-size:12px;margin-top:3px">${cod ? `<span style="color:var(--muted)">${cod} · </span>` : ''}<b>Em nosso estoque</b></div>
      <div style="font-size:12px;margin-top:4px"><span style="color:var(--success);font-weight:600">● ${p.estoque_qtd} em estoque</span>${p.preco_venda ? ` <span style="color:var(--muted)">· R$ ${Number(p.preco_venda).toFixed(2)}</span>` : ''}</div>
    </div>`;
  }).join('');

  if (!matches.length && !emEstoque.length) {
    div.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma peça encontrada com "${termo}" — nem com revendedora, nem em estoque.</p></div>`;
    return;
  }
  if (!matches.length) { div.innerHTML = estoqueHTML; return; }

  div.innerHTML = estoqueHTML + matches.map(c => {
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

// Núcleo do encerramento (sem confirmação — os chamadores confirmam antes).
// Retorna true se encerrou; false se falhou (erro já surfado).
async function encerrarMostruarioCore(revId, msgFinal) {
  const nome = state.revNameMap[revId] || 'esta revendedora';
  // Descobre a maleta ATIVA e a AGUARDANDO (a troca) desta revendedora.
  const { data: maletas } = await sbQ(sb.from('maletas')
    .select('id,status').eq('revendedora_id', revId).in('status', ['ativa', 'aguardando']));
  const maletaAtiva = (maletas || []).find(m => m.status === 'ativa');
  const maletaAguardando = (maletas || []).find(m => m.status === 'aguardando');

  let error;
  try {
    // 1) encerra as peças (escopo: maleta ativa, ou legado por revendedora)
    let q = sb.from('consignados')
      .update({ status: 'encerrado', encerrado_em: new Date().toISOString() })
      .eq('revendedora_id', revId).eq('status', 'ativo');
    if (maletaAtiva) q = q.eq('maleta_id', maletaAtiva.id);
    ({ error } = await q);
    // 2) maleta ativa -> finalizada
    if (!error && maletaAtiva) {
      ({ error } = await sb.from('maletas')
        .update({ status: 'finalizada', finalizada_at: new Date().toISOString() })
        .eq('id', maletaAtiva.id));
    }
    // 3) aguardando -> ativa (só após a anterior sair de 'ativa', respeitando o índice único)
    if (!error && maletaAguardando) {
      ({ error } = await sb.from('maletas').update({ status: 'ativa' }).eq('id', maletaAguardando.id));
    }
  } catch (e) { error = e; }
  if (await handleSupabaseError(error, 'Erro ao finalizar mostruário')) return false;
  // Marca a troca desta revendedora como resolvida (some da tela de Trocas ate a
  // proxima maleta). Best-effort: nao bloqueia o fechamento se a coluna nao existir.
  try {
    const { error: trErr } = await sb.from('profiles').update({ troca_resolvida_em: new Date().toISOString() }).eq('id', revId);
    if (trErr) console.warn('[trocas] nao marcou troca_resolvida_em (rodou o SQL da coluna?):', trErr.message);
  } catch (e) { console.warn('[trocas] erro ao marcar troca_resolvida_em:', e.message); }
  state.aprovadasCache = []; // forca a tela de Trocas a reler os profiles atualizados
  toast(msgFinal || `Mostruário de ${nome} encerrado`);
  loadConsignados();
  return true;
}

// (Removido: finalizarCicloRev — encerrar sem conferência. Agora todo
// encerramento passa por abrirConferencia → conferência final → recebimento.)

// ═══════════════════════════════════════════════════════════════════
// CONFERÊNCIA DE FECHAMENTO (admin) — modal aberto pelo "Finalizar
// Mostruário". O admin marca peça por peça que voltou fisicamente na
// maleta (persistido em consignados.devolvido, sobrevive a reload).
// O que sobra (devolvido=false) deve bater com o que foi lançado vendido.
// ═══════════════════════════════════════════════════════════════════
let confRevId = null;
let confMaletaAtivaId = null;
let confCicloChave = null;    // modo correção: chave (data) do ciclo FINALIZADO
let confOrigVendida = null;   // modo correção: Set de ids lançados como vendidos na ORIGEM
let confFechamento = null;    // modo correção: linha da auditoria (ou null se não achou)
// Sub-telas de tela inteira (conferência e fechamento) — renderizam dentro do
// panel-consignados no lugar do catálogo, padrão do histórico de ciclos.
let confTelaAberta = false;
let fechTelaAberta = false;

// Peças em conferência. Modo normal: ativas da maleta ativa (mesmo escopo do
// finalizarCicloRev; fallback legado = todas as ativas). Modo correção:
// peças ENCERRADAS do ciclo escolhido (a maleta continua finalizada).
function pecasConferencia() {
  if (confCicloChave) {
    return soEncerrados(state.allConsignados).filter(c => c.revendedora_id === confRevId
      && (c.encerrado_em || c.created_at || '').slice(0, 10) === confCicloChave);
  }
  return state.allConsignados.filter(c => c.revendedora_id === confRevId && c.status === 'ativo'
    && (!confMaletaAtivaId || c.maleta_id === confMaletaAtivaId));
}

// "Lançada como vendida" na visão da conferência. No modo correção a
// reconciliação já sobrescreveu quantidade_vendida — o lançamento original
// é reconstruído dos flags + auditoria (confOrigVendida).
function foiLancada(c) {
  if (confCicloChave) return confOrigVendida ? confOrigVendida.has(String(c.id)) : false;
  return foiVendida(c);
}

export function podeCorrigirMaleta() {
  return IS_ADMIN || PERMISSOES.has('acao_editar_maleta_finalizada');
}

// Esqueleto da conferência em tela inteira (mesmos ids/handlers do antigo
// #modal-conferencia — os handlers on* dependem desses ids).
function confTelaSkeletonHtml() {
  return `<button class="btn-voltar-ciclo" onclick="voltarConferenciaTela()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg> Voltar</button>
    <div class="card conf-tela">
      <div class="modal-title" id="conf-title"></div>
      <div id="conf-contadores" style="font-size:12.5px;color:var(--muted);margin-bottom:10px"></div>
      <input class="search-input" id="conf-search" placeholder="Buscar por nome ou código... (* marca como Voltou)" oninput="renderConferencia()" onkeydown="confBuscaTeclas(event)">
      <label style="display:flex;align-items:center;gap:6px;margin:8px 0 10px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none">
        <input type="checkbox" id="conf-ver-devolvidos" onchange="renderConferencia()" style="accent-color:var(--rose);cursor:pointer">
        Ver já conferidas
      </label>
      <div id="conf-list"></div>
      <div id="conf-resultado"></div>
      <div id="conf-comissao"></div>
      <div id="conf-acoes" style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"></div>
    </div>`;
}

export function voltarConferenciaTela() {
  confTelaAberta = false;
  renderCicloGrid();
}

async function abrirModalConferencia(titulo, acoesHtml) {
  // Renderiza a sub-tela (skeleton) antes de escrever nos ids.
  confTelaAberta = true;
  renderCicloGrid();
  document.getElementById('conf-title').innerHTML =
    `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${titulo}`;
  document.getElementById('conf-search').value = '';
  document.getElementById('conf-ver-devolvidos').checked = false;
  document.getElementById('conf-resultado').innerHTML = '';
  document.getElementById('conf-acoes').innerHTML = acoesHtml;
  // Faixas de comissão (para sugerir a % pelo total vendido)
  confPctManual = false;
  confFaixas = null;
  const { data, error } = await sbQ(sb.from('faixas_comissao')
    .select('valor_min,valor_max,percentual').eq('ativo', true).order('valor_min'));
  if (error) console.error('Faixas de comissão:', error);
  confFaixas = data || [];
  renderConferencia();
}

// ── Comissão do fechamento (sugerida pela faixa do total vendido) ──
let confFaixas = null;
let confPctManual = false;

function faixaPct(total) {
  const f = (confFaixas || []).find(x => Number(x.valor_min) <= total
    && (x.valor_max == null || total <= Number(x.valor_max)));
  return f ? Number(f.percentual) : null;
}

// Total vendido pelo veredito atual da conferência (não voltou = vendida).
function totalVendidoConferencia() {
  return pecasConferencia().filter(c => !c.devolvido)
    .reduce((s, c) => s + (c.quantidade_enviada || 1) * Number(c.preco_venda || 0), 0);
}

const r2 = n => Math.round(n * 100) / 100;

function pctComissaoAtual() {
  const el = document.getElementById('conf-comissao-pct');
  return el ? (parseFloat((el.value || '').replace(',', '.')) || 0) : 0;
}

// Valores gravados na auditoria do fechamento/correção.
function dadosComissao() {
  const total = totalVendidoConferencia();
  const pct = pctComissaoAtual();
  return {
    total_vendido_valor: r2(total),
    comissao_percentual: pct,
    comissao_valor: r2(total * pct / 100),
    valor_a_receber: r2(total - total * pct / 100),
  };
}

function renderConfComissao() {
  const div = document.getElementById('conf-comissao');
  if (!div) return;
  const total = totalVendidoConferencia();
  const sug = faixaPct(total);
  // respeita a % digitada manualmente; senão, segue a sugestão da faixa
  const pct = confPctManual ? pctComissaoAtual() : (sug ?? 0);
  const dica = sug == null
    ? '<span style="color:var(--warning)">⚠ Sem faixa definida para este total — cadastre em Cadastros → Faixas de Comissão.</span>'
    : `Sugerido pela faixa: <b>${String(sug).replace('.', ',')}%</b>${confPctManual && pct !== sug
        ? ' <button type="button" class="btn-secondary btn-sm" style="padding:2px 8px;font-size:11px" onclick="confComissaoUsarFaixa()">Usar faixa</button>' : ''}`;
  div.innerHTML = `
    <div style="margin-top:12px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--blush)">
      <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total vendido</div>
          <b style="color:var(--plum);font-size:15px">${fmtBRL(total)}</b></div>
        <div><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Comissão (%)</div>
          <input id="conf-comissao-pct" class="form-control" style="width:84px;padding:5px 10px;font-size:13px" inputmode="decimal"
            value="${String(pct).replace('.', ',')}" oninput="confComissaoEditada()"></div>
        <div><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Comissão</div>
          <b id="conf-com-valor" style="color:var(--rose)">${fmtBRL(total * pct / 100)}</b></div>
        <div><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">A receber</div>
          <b id="conf-com-receber" style="color:var(--success)">${fmtBRL(total - total * pct / 100)}</b></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">${dica}</div>
    </div>`;
}

// Usuário digitou a %: fixa o valor manual e recalcula ao vivo (sem
// re-renderizar a caixa, para não perder o foco do input).
export function confComissaoEditada() {
  confPctManual = true;
  const total = totalVendidoConferencia();
  const pct = pctComissaoAtual();
  const v = document.getElementById('conf-com-valor');
  const rcb = document.getElementById('conf-com-receber');
  if (v) v.textContent = fmtBRL(total * pct / 100);
  if (rcb) rcb.textContent = fmtBRL(total - total * pct / 100);
}

export function confComissaoUsarFaixa() {
  confPctManual = false;
  renderConfComissao();
}

const CONF_BTN_CONFERIR = '<button class="btn-secondary" style="flex:1" onclick="conferirFechamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Conferir fechamento</button>';
const CONF_BTN_IMPRIMIR = '<button class="btn-secondary" style="flex:1" onclick="imprimirRelacaoVendidas()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Imprimir relação</button>';

export async function abrirConferencia(revId) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  confRevId = revId;
  confCicloChave = null; confOrigVendida = null; confFechamento = null;
  const { data: maleta, error } = await sbQ(sb.from('maletas')
    .select('id').eq('revendedora_id', revId).eq('status', 'ativa').maybeSingle());
  if (error) { console.error('Erro ao buscar maleta ativa:', error); }
  confMaletaAtivaId = maleta?.id || null;
  if (!pecasConferencia().length) { toast('Nenhum mostruário ativo para conferir'); return; }
  const nome = state.revNameMap[revId] || 'Revendedora';
  abrirModalConferencia(`Conferência de fechamento — ${esc(nome)}`,
    CONF_BTN_CONFERIR + CONF_BTN_IMPRIMIR +
    '<button id="conf-btn-finalizar" class="btn-secondary" style="flex:1;border-color:var(--gold);color:var(--gold)" onclick="finalizarAposConferencia()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Finalizar Mostruário</button>');
}

// ── Modo correção: reabre a conferência de um ciclo já FINALIZADO ───
// A maleta continua finalizada e a próxima não é tocada — só o veredito
// das peças e a auditoria mudam (ação protegida por permissão).
export async function abrirConferenciaCorrecao(chave) {
  if (!podeCorrigirMaleta()) { toast('Sem permissão para corrigir maleta finalizada'); return; }
  confRevId = state.cicloRevSelecionada;
  confMaletaAtivaId = null;
  confCicloChave = chave;
  const base = pecasConferencia();
  if (!base.length) { toast('Nenhuma peça neste fechamento'); return; }

  // Reconstrói o "lançado como vendido" original: vendidas sem flag de
  // divergência + as que a auditoria diz que voltaram estando vendidas.
  confOrigVendida = new Set(base.filter(c => foiVendida(c) && !c.vendido_por_divergencia).map(c => String(c.id)));
  confFechamento = null;
  const { data: fechs, error: eF } = await sbQ(sb.from('fechamentos_mostruario')
    .select('id').eq('revendedora_id', confRevId)
    .gte('created_at', chave + 'T00:00:00').lte('created_at', chave + 'T23:59:59.999')
    .order('created_at', { ascending: false }).limit(1));
  if (eF) console.error('Auditoria do ciclo:', eF);
  confFechamento = fechs?.[0] || null;
  if (confFechamento) {
    const { data: divs, error: eD } = await sbQ(sb.from('fechamentos_divergencias')
      .select('consignado_id,tipo').eq('fechamento_id', confFechamento.id));
    if (eD) console.error('Divergências do ciclo:', eD);
    (divs || []).filter(d => d.tipo === 'devolvido_estava_vendido')
      .forEach(d => confOrigVendida.add(String(d.consignado_id)));
  }

  const nome = state.revNameMap[confRevId] || 'Revendedora';
  const dataFmt = chave ? chave.split('-').reverse().join('/') : '';
  abrirModalConferencia(`Correção de conferência — ${esc(nome)} <span style="font-size:12px;color:var(--muted)">(fechado em ${dataFmt})</span>`,
    CONF_BTN_CONFERIR + CONF_BTN_IMPRIMIR +
    '<button class="btn-primary btn" style="flex:1" onclick="salvarCorrecaoConferencia()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Salvar correção</button>');
}

export function renderConferencia() {
  const base = pecasConferencia();
  const pendentes  = base.filter(c => !confEstado(c));
  const devolvidos = base.filter(c => c.devolvido);
  const vendidas   = base.filter(c => !c.devolvido && confConferida(c));
  const conferidas = base.length - pendentes.length;
  const pct = base.length ? Math.round(conferidas / base.length * 100) : 0;

  document.getElementById('conf-contadores').innerHTML =
    `Restantes: <b style="color:var(--plum)">${pendentes.length}</b> · ` +
    `Voltaram: <b style="color:var(--success)">${devolvidos.length}</b> · ` +
    `Vendidas: <b style="color:var(--rose)">${vendidas.length}</b>` +
    `<div style="margin-top:8px"><div style="height:7px;border-radius:4px;background:var(--border);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--success);transition:width .2s"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">${conferidas} de ${base.length} peça${base.length !== 1 ? 's' : ''} conferida${conferidas !== 1 ? 's' : ''}</div></div>`;

  // Dica visual do gate (o bloqueio real e o toast ficam em finalizarAposConferencia,
  // para o clique sempre dar feedback em vez de "não acontecer nada").
  const btnFin = document.getElementById('conf-btn-finalizar');
  if (btnFin) {
    const falta = pendentes.length;
    btnFin.style.opacity = falta > 0 ? '.6' : '';
    btnFin.title = falta > 0 ? `Faltam ${falta} peça${falta > 1 ? 's' : ''} para conferir` : '';
  }

  // Peças iguais (mesmo código/descrição) são LINHAS físicas distintas:
  // numera "1 de 2", "2 de 2" para o admin distinguir qual voltou.
  const chaveDup = c => ((c.referencia || '') + '|' + (c.descricao || '')).toLowerCase();
  const contagem = {}, posicao = {}, seq = {};
  base.forEach(c => { contagem[chaveDup(c)] = (contagem[chaveDup(c)] || 0) + 1; });
  base.forEach(c => { const k = chaveDup(c); seq[k] = (seq[k] || 0) + 1; posicao[c.id] = seq[k]; });

  const verConferidas = document.getElementById('conf-ver-devolvidos').checked;
  const termo = (document.getElementById('conf-search').value || '').toLowerCase().trim();
  let lista = verConferidas ? base.filter(confConferida) : pendentes;
  if (termo) {
    lista = lista.filter(c =>
      (c.descricao || '').toLowerCase().includes(termo) ||
      (c.referencia || '').toLowerCase().includes(termo));
  }

  renderConfComissao(); // total vendido muda conforme o veredito

  const bulk = (!verConferidas && pendentes.length)
    ? `<div style="margin-bottom:10px"><button class="btn-secondary btn-sm" style="width:100%;border-color:var(--rose);color:var(--rose)" onclick="confTodasVendidas()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Confirmar as ${pendentes.length} restantes como vendidas</button></div>` : '';

  const div = document.getElementById('conf-list');
  if (!lista.length) {
    div.innerHTML = bulk + `<div class="empty-state" style="padding:20px 0"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></div><p>${verConferidas ? 'Nenhuma peça conferida ainda' : (termo ? `Nada encontrado com "${termo}"` : 'Todas as peças foram conferidas!')}</p></div>`;
    return;
  }

  const BADGE = { devolvido: ['Voltou', 'var(--success)'], vendida: ['Vendida', 'var(--rose)'] };
  div.innerHTML = bulk + lista.map(c => {
    const est = confEstado(c);
    const badge = est ? ` · <span style="color:${BADGE[est][1]};font-weight:600">${BADGE[est][0]}</span>` : '';
    const btn = (alvo, cor, lab, fn) => {
      const on = est === alvo;
      return `<button class="btn-secondary btn-sm" style="padding:4px 8px;font-size:11.5px;${on ? `background:${cor};color:#fff;border-color:${cor}` : `border-color:${cor};color:${cor}`}" onclick="${fn}('${c.id}',${!on})">${lab}</button>`;
    };
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid var(--line,#eee)">
      <div style="flex:1;min-width:0">
        <div class="ciclo-desc" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.descricao)}</div>
        <div style="font-size:11px;color:var(--muted)">${c.referencia ? esc(c.referencia) + ' · ' : ''}${foiLancada(c) ? '<span style="color:var(--rose);font-weight:600">vendido</span>' : 'não vendido'}${contagem[chaveDup(c)] > 1 ? ` · <b style="color:var(--plum)">${posicao[c.id]} de ${contagem[chaveDup(c)]}</b>` : ''}${badge}</div>
      </div>
      <button class="btn-icon" title="Ver foto" style="color:var(--rose)" onclick="confVerFoto('${c.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></button>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
        ${btn('devolvido', 'var(--success)', 'Voltou', 'confMarcarDevolvido')}
        ${btn('vendida', 'var(--rose)', 'Vendida', 'confMarcarVendida')}
      </div>
    </div>`;
  }).join('');
}

// Preview da foto do produto (lightbox por cima da conferência — o estado
// do modal de trás fica intacto). Usa consignados.foto_url; se a peça não
// tiver, busca no produto de origem (produtos.foto_url) e guarda no item.
let lbFotos = [];       // urls exibidas no lightbox
let lbIdx = 0;
let lbLegenda = '';

export async function confVerFoto(id) {
  const c = state.allConsignados.find(x => String(x.id) === String(id));
  if (!c) return;
  lbLegenda = `${esc(c.descricao)}${c.referencia ? ` <span style="opacity:.7">· ${esc(c.referencia)}</span>` : ''}`;
  const body = document.getElementById('lightbox-foto-body');
  body.innerHTML = '<div class="spinner" style="color:#fff">⟳</div>';
  openModal('lightbox-foto');

  // Todas as imagens do produto de origem (imagens[] com fallback foto_url).
  lbFotos = [];
  if (c.produto_id) {
    const { data, error } = await sbQ(sb.from('produtos').select('foto_url,imagens').eq('id', c.produto_id).maybeSingle());
    if (error) console.error('Fotos do produto:', error);
    if (data?.imagens?.length) lbFotos = data.imagens;
    else if (data?.foto_url) lbFotos = [data.foto_url];
  }
  if (!lbFotos.length && c.foto_url) lbFotos = [c.foto_url];
  lbIdx = 0;
  lightboxRender();
}

export function lightboxFotoNav(delta) {
  if (!lbFotos.length) return;
  lbIdx = (lbIdx + delta + lbFotos.length) % lbFotos.length;
  lightboxRender();
}

function lightboxRender() {
  const body = document.getElementById('lightbox-foto-body');
  const legenda = `<div style="color:#fff;font-size:13px;text-align:center">${lbLegenda}</div>`;
  if (!lbFotos.length) {
    body.innerHTML = `<div style="background:rgba(255,255,255,0.08);border:1px dashed rgba(255,255,255,0.35);border-radius:14px;padding:44px 56px;color:#fff;text-align:center">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:34px;height:34px;opacity:.7"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        <div style="margin-top:10px;font-size:14px">Sem foto</div>
      </div>${legenda}`;
    return;
  }
  const btnNav = dir => `<button type="button" onclick="lightboxFotoNav(${dir})"
    style="width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,0.4);background:rgba(0,0,0,0.35);color:#fff;font-size:18px;cursor:pointer;flex:none">${dir < 0 ? '‹' : '›'}</button>`;
  const contador = lbFotos.length > 1
    ? `<div style="color:#fff;font-size:12px;opacity:.75;text-align:center">${lbIdx + 1} / ${lbFotos.length}</div>` : '';
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      ${lbFotos.length > 1 ? btnNav(-1) : ''}
      <img src="${esc(lbFotos[lbIdx])}" style="max-width:78vw;max-height:70vh;border-radius:14px;object-fit:contain"
        onerror="this.outerHTML='<div style=&quot;color:#fff;padding:30px;font-size:14px&quot;>Não foi possível carregar a foto</div>'">
      ${lbFotos.length > 1 ? btnNav(1) : ''}
    </div>${contador}${legenda}`;
}

// Atalho de bipe na busca da conferência: "*" marca a peça filtrada como
// "Voltou", limpa o campo e deixa pronto para o próximo código.
export function confBuscaTeclas(e) {
  if (e.key !== '*') return;
  e.preventDefault(); // não deixa o * entrar no campo
  const input = document.getElementById('conf-search');
  const termo = (input.value || '').toLowerCase().trim();
  if (!termo) return;
  // Mesmo filtro da lista visível (só as pendentes, sem veredito ainda).
  const matches = pecasConferencia().filter(c => !confEstado(c) &&
    ((c.descricao || '').toLowerCase().includes(termo) ||
     (c.referencia || '').toLowerCase().includes(termo)));
  if (!matches.length) { toast(`Nenhuma peça restante com "${termo}"`); return; }
  if (matches.length > 1) { toast(`${matches.length} peças casam com "${termo}" — refine até sobrar 1.`); return; }
  confMarcarDevolvido(matches[0].id, true); // já re-renderiza a lista
  toast(`Voltou: ${matches[0].descricao}`);
  input.value = '';
  setTimeout(() => { input.focus(); renderConferencia(); }, 0);
}

// Estado da peça na conferência (mutuamente exclusivo). null = pendente.
// Só dois estados: Voltou (devolvido) ou Vendida (conf_vendida).
function confEstado(c) {
  return c.devolvido ? 'devolvido' : c.conf_vendida ? 'vendida' : null;
}
const confConferida = c => !!confEstado(c);

// Persistência da conferência (sobrevive a fechar o modal / recarregar).
// Grava o par completo — a marcação zera a outra.
async function confAplicarEstado(id, estado) {
  const patch = { devolvido: estado === 'devolvido', conf_vendida: estado === 'vendida' };
  const { error } = await sbQ(sb.from('consignados').update(patch).eq('id', id));
  if (error) {
    console.error('Erro ao salvar conferência:', error);
    if (/devolvido|conf_vendida|extraviado|column|schema cache/i.test(error.message || '')) {
      toast('Rode as migrações 0002 e 0027 (estados da conferência) no Supabase.');
      return false;
    }
    if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) return false;
  }
  const c = state.allConsignados.find(x => String(x.id) === String(id));
  if (c) { c.devolvido = patch.devolvido; c.conf_vendida = patch.conf_vendida; }
  document.getElementById('conf-resultado').innerHTML = ''; // resultado antigo fica obsoleto
  renderConferencia();
  return true;
}

// Compatível com o código antigo (bipe `*` chama com true). false = desmarca.
export async function confMarcarDevolvido(id, devolvido) { return confAplicarEstado(id, devolvido ? 'devolvido' : null); }
export async function confMarcarVendida(id, on) { return confAplicarEstado(id, on ? 'vendida' : null); }

// Marca em lote todas as peças ainda não conferidas como vendidas.
export function confTodasVendidas() {
  const pendentes = pecasConferencia().filter(c => !confEstado(c));
  if (!pendentes.length) { toast('Todas as peças já foram conferidas.'); return; }
  const n = pendentes.length;
  confirmarAcao('Confirmar vendidas',
    `Marcar ${n} peça${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''} como vendida${n > 1 ? 's' : ''}?`, 'Confirmar vendidas', async () => {
      const ids = pendentes.map(c => c.id);
      const { error } = await sbQ(sb.from('consignados').update({ conf_vendida: true, devolvido: false }).in('id', ids));
      if (error) {
        console.error('confTodasVendidas:', error);
        if (/conf_vendida|column|schema cache/i.test(error.message || '')) { toast('Rode a migração 0027 no Supabase.'); return; }
        toast('Erro ao confirmar: ' + error.message); return;
      }
      const set = new Set(ids.map(String));
      state.allConsignados.forEach(c => { if (set.has(String(c.id))) { c.conf_vendida = true; c.devolvido = false; } });
      document.getElementById('conf-resultado').innerHTML = '';
      renderConferencia();
      toast(`${n} peça${n > 1 ? 's' : ''} marcada${n > 1 ? 's' : ''} como vendida${n > 1 ? 's' : ''}.`);
    });
}

// A = restantes (devolvido=false) · B = vendidos (lançados pela revendedora).
function divergenciasConferencia() {
  const base = pecasConferencia();
  return {
    naoLancadas: base.filter(c => !c.devolvido && !foiLancada(c)), // em A e não em B
    voltouVendida: base.filter(c => c.devolvido && foiLancada(c)), // em B e não em A
  };
}

export function conferirFechamento() {
  const { naoLancadas, voltouVendida } = divergenciasConferencia();
  const div = document.getElementById('conf-resultado');
  if (!naoLancadas.length && !voltouVendida.length) {
    div.innerHTML = `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:rgba(91,110,92,0.1);color:var(--success);font-weight:600"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Fechamento do mostruário conferido com sucesso!</div>`;
    toast('Fechamento do mostruário conferido com sucesso!');
    return;
  }
  const itemHtml = c => `<li style="margin:3px 0">${esc(c.descricao)}${c.referencia ? ` <span style="color:var(--muted);font-family:monospace">(${esc(c.referencia)})</span>` : ''}</li>`;
  div.innerHTML = `<div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:rgba(192,57,43,0.08);color:var(--danger);font-size:13px">
    <div style="font-weight:600;margin-bottom:6px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> Divergências encontradas</div>
    ${naoLancadas.length ? `<div style="font-weight:600;margin-top:6px">Não voltou na maleta e não foi lançado como vendido (${naoLancadas.length}):</div>
      <ul style="margin:4px 0 0 18px;padding:0">${naoLancadas.map(itemHtml).join('')}</ul>
      <div style="font-size:11.5px;color:var(--muted)">Possível peça extraviada ou venda não lançada.</div>` : ''}
    ${voltouVendida.length ? `<div style="font-weight:600;margin-top:8px">Marcado como vendido, porém voltou na maleta (${voltouVendida.length}):</div>
      <ul style="margin:4px 0 0 18px;padding:0">${voltouVendida.map(itemHtml).join('')}</ul>` : ''}
  </div>`;
}

export function finalizarAposConferencia() {
  // Gate (defesa dupla — o botão já fica desabilitado): exige tudo conferido.
  const pend = pecasConferencia().filter(c => !confEstado(c));
  if (pend.length) { toast(`Confira todas as peças antes de finalizar (${pend.length} pendente${pend.length > 1 ? 's' : ''}).`); return; }

  const { naoLancadas, voltouVendida } = divergenciasConferencia();
  const total = naoLancadas.length + voltouVendida.length;
  const nome = state.revNameMap[confRevId] || 'esta revendedora';
  if (!total) {
    confirmarAcao('Finalizar Mostruário',
      `Finalizar o mostruário de ${nome}?\n\nPeças devolvidas voltam ao estoque e as demais ficam como vendidas.\n\nEssa ação não pode ser desfeita e abre o recebimento.`,
      'Finalizar e receber', () => executarFechamentoReconciliado());
    return;
  }
  conferirFechamento(); // mostra a listagem antes de decidir
  confirmarAcao('⚠ Divergências na conferência',
    `Há ${total} divergência${total > 1 ? 's' : ''}. Ao finalizar, a conferência física será aplicada: peças que voltaram retornam ao estoque (mesmo lançadas como vendidas) e peças não devolvidas ficam como vendidas (as não lançadas ficam como "Vendido por Divergência"). Tudo será registrado. Deseja finalizar?`,
    'Finalizar e receber', () => executarFechamentoReconciliado());
}

// ── Salvar correção (modo correção): re-reconcilia por linha e ATUALIZA a
// auditoria existente. NÃO reencerra nada: status das peças, da maleta
// finalizada e da maleta seguinte ficam intocados.
export function salvarCorrecaoConferencia() {
  if (!podeCorrigirMaleta()) { toast('Sem permissão'); return; }
  const { naoLancadas, voltouVendida } = divergenciasConferencia();
  const total = naoLancadas.length + voltouVendida.length;
  if (total) {
    conferirFechamento(); // mostra a listagem antes de decidir
    confirmarAcao('⚠ Divergências na correção',
      `Há ${total} divergência${total > 1 ? 's' : ''}. Ao salvar, a conferência corrigida será aplicada (peças que voltaram deixam de ser venda; as que não voltaram viram venda — não lançadas ficam como "Vendido por Divergência"). A maleta continua finalizada. Salvar?`,
      'Salvar correção', () => aplicarCorrecaoConferencia());
  } else {
    confirmarAcao('Salvar correção',
      'Aplicar a conferência corrigida? O veredito das peças e a auditoria serão atualizados — a maleta continua finalizada.',
      'Salvar correção', () => aplicarCorrecaoConferencia());
  }
}

async function aplicarCorrecaoConferencia() {
  const base = pecasConferencia();
  const devolvidas  = base.filter(c => c.devolvido);
  const naoVoltaram = base.filter(c => !c.devolvido);
  const divVendida   = naoVoltaram.filter(c => !foiLancada(c));
  const divDevolvida = devolvidas.filter(c => foiLancada(c));
  const totalDiv = divVendida.length + divDevolvida.length;

  // 1) Veredito por linha (idempotente). No modo correção TODAS as não
  //    voltadas são regravadas (podem ter sido marcadas devolvidas antes).
  for (const [qtd, ids] of gruposPorQtd(devolvidas)) {
    const { error } = await sbQ(sb.from('consignados')
      .update({ quantidade_vendida: 0, quantidade_devolvida: qtd, vendido_por_divergencia: false })
      .in('id', ids));
    if (error) { console.error('Correção (devolvidas):', error); toast(`Erro ao aplicar devoluções: ${error.message}. Nada foi concluído — tente de novo.`); return; }
  }
  const vendidasLancadas = naoVoltaram.filter(c => foiLancada(c));
  for (const [grupo, flag] of [[divVendida, true], [vendidasLancadas, false]]) {
    for (const [qtd, ids] of gruposPorQtd(grupo)) {
      const { error } = await sbQ(sb.from('consignados')
        .update({ quantidade_vendida: qtd, quantidade_devolvida: 0, vendido_por_divergencia: flag })
        .in('id', ids));
      if (error) { console.error('Correção (vendas):', error); toast(`Erro ao marcar vendas: ${error.message}. Tente de novo.`); return; }
    }
  }

  // 2) Auditoria: ATUALIZA o cabeçalho existente (ou cria, se o fechamento
  //    for anterior à auditoria) e SUBSTITUI os itens divergentes.
  const cab = {
    total_pecas: base.length,
    total_vendidas: naoVoltaram.length,
    total_devolvidas: devolvidas.length,
    total_divergencias: totalDiv,
    finalizado_com_divergencia: totalDiv > 0,
    corrigido_em: new Date().toISOString(),
    corrigido_por: state.currentUser.id,
    ...dadosComissao(),
  };
  let fechId = confFechamento?.id || null;
  if (fechId) {
    let { error } = await sbQ(sb.from('fechamentos_mostruario').update(cab).eq('id', fechId));
    // Coluna opcional ausente: remove SÓ a citada no erro e tenta de novo.
    const OPC = ['total_vendido_valor', 'comissao_percentual', 'comissao_valor', 'valor_a_receber'];
    let tent = 0;
    while (error && tent < OPC.length && /column|schema cache/i.test(error.message || '')) {
      const col = (error.message || '').match(/'([a-z_]+)' column/i)?.[1];
      if (!col || !OPC.includes(col) || !(col in cab)) break;
      console.warn(`Coluna ausente "${col}" (rode a migração 0007):`, error.message);
      delete cab[col];
      tent++;
      ({ error } = await sbQ(sb.from('fechamentos_mostruario').update(cab).eq('id', fechId)));
    }
    if (error) { console.error('Auditoria (update):', error); toast(`Erro ao atualizar a auditoria: ${error.message}. Rode a migração 0005.`); return; }
  } else {
    const nome = state.revNameMap[confRevId] || 'Revendedora';
    const { data, error } = await sbQ(sb.from('fechamentos_mostruario').insert({
      ...cab, revendedora_id: confRevId, revendedora_nome: nome,
      pedido_numero: pedidosDoCatalogo(base).join(', ') || null,
      admin_user_id: state.currentUser.id,
    }).select('id').single());
    if (error) { console.error('Auditoria (insert):', error); toast(`Erro ao registrar a auditoria: ${error.message}.`); return; }
    fechId = data.id;
  }
  const { error: eDel } = await sbQ(sb.from('fechamentos_divergencias').delete().eq('fechamento_id', fechId));
  if (eDel) { console.error('Auditoria (limpar itens):', eDel); toast(`Erro ao atualizar divergências: ${eDel.message}. Rode a migração 0005.`); return; }
  const divRows = [
    ...divVendida.map(c => ({ tipo: 'vendido_por_divergencia', c })),
    ...divDevolvida.map(c => ({ tipo: 'devolvido_estava_vendido', c })),
  ].map(({ tipo, c }) => ({
    fechamento_id: fechId, consignado_id: c.id,
    descricao: c.descricao || null, codigo: c.referencia || null, tipo,
  }));
  if (divRows.length) {
    const { error: eIns } = await sbQ(sb.from('fechamentos_divergencias').insert(divRows));
    if (eIns) { console.error('Auditoria (itens):', eIns); toast(`Erro ao registrar divergências: ${eIns.message}.`); return; }
  }

  confTelaAberta = false;
  toast(totalDiv > 0
    ? `Correção salva. ${totalDiv} divergência${totalDiv !== 1 ? 's' : ''} registrada${totalDiv !== 1 ? 's' : ''} na auditoria.`
    : 'Conferência corrigida com sucesso!');
  loadConsignados();
  // Financeiro: reabre o recebimento — o valor a receber pode ter mudado.
  window.abrirRecebimento(fechId);
}

// Agrupa por quantidade_enviada para setar quantidade_devolvida/vendida =
// enviada em lote (normalmente qtd 1 por linha — cada bipe é 1 peça física).
function gruposPorQtd(lista) {
  const m = new Map();
  lista.forEach(c => {
    const q = c.quantidade_enviada || 1;
    if (!m.has(q)) m.set(q, []);
    m.get(q).push(c.id);
  });
  return [...m.entries()];
}

// ── Reconciliação: a conferência física é o veredito final ─────────
// Tudo por LINHA (consignados.id) — nunca agregando por SKU. Robusta a
// peças iguais: cada linha física tem seu próprio devolvido/vendido.
async function executarFechamentoReconciliado() {
  const revId = confRevId;
  const nome = state.revNameMap[revId] || 'Revendedora';
  const base = pecasConferencia();
  if (!base.length) { toast('Nenhum mostruário ativo para finalizar'); return; }

  const devolvidas   = base.filter(c => c.devolvido);
  const naoVoltaram  = base.filter(c => !c.devolvido);
  const divVendida   = naoVoltaram.filter(c => !foiVendida(c)); // não voltou e não lançada -> Vendido por Divergência
  const divDevolvida = devolvidas.filter(foiVendida);           // voltou mas estava lançada vendida -> reverte a venda
  const totalDiv = divVendida.length + divDevolvida.length;

  // 1) Veredito físico. Sequencial: no primeiro erro, aborta e avisa
  //    (reabra a conferência e finalize de novo — updates são idempotentes).
  // ESTOQUE: a devolução vive em quantidade_devolvida (não movimenta
  // produtos.estoque_qtd). Quando o retorno ao estoque central existir,
  // checar utils.ehRevTeste(revId) e PULAR maletas de conta de teste.
  for (const [qtd, ids] of gruposPorQtd(devolvidas)) {
    const { error } = await sbQ(sb.from('consignados')
      .update({ quantidade_vendida: 0, quantidade_devolvida: qtd, vendido_por_divergencia: false })
      .in('id', ids));
    if (error) { console.error('Reconciliação (devolvidas):', error); toast(`Erro ao aplicar devoluções: ${error.message}. Nada foi finalizado — tente de novo.`); return; }
  }
  for (const [qtd, ids] of gruposPorQtd(divVendida)) {
    const { error } = await sbQ(sb.from('consignados')
      .update({ quantidade_vendida: qtd, quantidade_devolvida: 0, vendido_por_divergencia: true })
      .in('id', ids));
    if (error) { console.error('Reconciliação (vendas por divergência):', error); toast(`Erro ao marcar vendas: ${error.message}. Nada foi finalizado — tente de novo.`); return; }
  }
  // (não voltou e JÁ estava vendida: nada a mudar)

  // 2) Auditoria (cabeçalho + itens divergentes)
  const peds = pedidosDoCatalogo(base);
  // ID próprio da maleta (Mostruário #) — o pedido Bling vira referência secundária.
  const { data: mAtiva } = await sbQ(sb.from('maletas')
    .select('numero_interno').eq('revendedora_id', revId).eq('status', 'ativa').maybeSingle());
  const cabecalho = {
    numero_interno: mAtiva?.numero_interno ?? null,
    pedido_numero: peds.join(', ') || null,
    revendedora_id: revId,
    revendedora_nome: nome,
    total_pecas: base.length,
    total_vendidas: naoVoltaram.length,
    total_devolvidas: devolvidas.length,
    total_divergencias: totalDiv,
    finalizado_com_divergencia: totalDiv > 0,
    admin_user_id: state.currentUser.id,
    ...dadosComissao(),
  };
  let { data: fech, error: eFech } = await sbQ(sb.from('fechamentos_mostruario').insert(cabecalho).select('id').single());
  // Coluna opcional ausente (migrações 0007/0010): remove SÓ a coluna citada
  // no erro e tenta de novo — nunca descarta a comissão por causa de outra.
  const OPCIONAIS = ['total_vendido_valor', 'comissao_percentual', 'comissao_valor', 'valor_a_receber', 'numero_interno'];
  let tentativas = 0;
  while (eFech && tentativas < OPCIONAIS.length && /column|schema cache/i.test(eFech.message || '')) {
    const col = (eFech.message || '').match(/'([a-z_]+)' column/i)?.[1];
    if (!col || !OPCIONAIS.includes(col) || !(col in cabecalho)) break;
    console.warn(`Coluna ausente "${col}" (rode as migrações 0007/0010):`, eFech.message);
    delete cabecalho[col];
    tentativas++;
    ({ data: fech, error: eFech } = await sbQ(sb.from('fechamentos_mostruario').insert(cabecalho).select('id').single()));
  }
  if (eFech) {
    console.error('Auditoria do fechamento:', eFech);
    const dica = /fechamentos_mostruario|relation|schema cache/i.test(eFech.message || '')
      ? ' Rode a migração 0003 no Supabase.' : '';
    toast(`Erro ao registrar o fechamento: ${eFech.message}.${dica} O mostruário NÃO foi encerrado.`);
    return;
  }
  const divRows = [
    ...divVendida.map(c => ({ tipo: 'vendido_por_divergencia', c })),
    ...divDevolvida.map(c => ({ tipo: 'devolvido_estava_vendido', c })),
  ].map(({ tipo, c }) => ({
    fechamento_id: fech.id, consignado_id: c.id,
    descricao: c.descricao || null, codigo: c.referencia || null, tipo,
  }));
  if (divRows.length) {
    const { error: eDiv } = await sbQ(sb.from('fechamentos_divergencias').insert(divRows));
    if (eDiv) { console.error('Auditoria (itens divergentes):', eDiv); toast(`Erro ao registrar divergências: ${eDiv.message}. O mostruário NÃO foi encerrado.`); return; }
  }

  // 3) Encerramento (fluxo existente: encerra peças, troca de maleta etc.)
  confTelaAberta = false;
  const msg = totalDiv > 0
    ? `Mostruário finalizado. ${divVendida.length} peça${divVendida.length !== 1 ? 's' : ''} marcada${divVendida.length !== 1 ? 's' : ''} como Vendido por Divergência (registrado).`
    : 'Fechamento do mostruário conferido com sucesso!';
  const ok = await encerrarMostruarioCore(revId, msg);
  // 4) Financeiro fase 1: abre o recebimento (QR PIX) com o valor a receber.
  if (ok) window.abrirRecebimento(fech.id);
}

// Imprime a relação da conferência (vendidas + devolvidas) no padrão do
// gerarPdfFechamento (#print-content + window.print). NÃO fecha o modal de
// conferência — o admin volta pra ele após imprimir.
export function imprimirRelacaoVendidas() {
  const base = pecasConferencia();
  if (!base.length) { toast('Nada para imprimir.'); return; }
  const nome = state.revNameMap[confRevId] || 'Revendedora';
  const hoje = new Date().toLocaleDateString('pt-BR');
  const vendidas   = base.filter(c => !c.devolvido);
  const devolvidas = base.filter(c => c.devolvido);

  const linha = (c, status, cor, i) => {
    const qtd = c.quantidade_enviada || 1;
    const sub = qtd * Number(c.preco_venda || 0);
    return `<tr style="background:${i % 2 === 0 ? '#faf7f2' : '#fff'}">
      <td style="padding:8px 12px;font-size:12px;color:#8a7590">${esc(c.referencia || '—')}</td>
      <td style="padding:8px 12px;font-size:13px">${esc(c.descricao)}</td>
      <td style="padding:8px 12px;text-align:center;font-size:13px">${qtd}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px">${c.preco_venda ? 'R$ ' + Number(c.preco_venda).toFixed(2) : '—'}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px">R$ ${sub.toFixed(2)}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:600;color:${cor}">${status}</td>
    </tr>`;
  };
  let i = 0;
  const linhas =
    vendidas.map(c => linha(c, 'Vendida', '#1a0a2e', i++)).join('') +
    devolvidas.map(c => linha(c, 'Devolvida', '#5b6e5c', i++)).join('');

  const d = dadosComissao();
  const totalCount = c => c.reduce((s, x) => s + (x.quantidade_enviada || 1), 0);

  document.getElementById('print-content').innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a7590;margin-bottom:6px">Lizzie Semijoias</div>
      <h1 style="font-family:'Georgia',serif;font-size:22px;font-weight:400;margin:0 0 4px">Conferência de Maleta</h1>
      <div style="font-size:13px;color:#8a7590">Revendedora: <strong style="color:#2d1f35">${esc(nome)}</strong> &nbsp;·&nbsp; Data: ${hoje} &nbsp;·&nbsp; ${vendidas.length} vendida${vendidas.length !== 1 ? 's' : ''} · ${devolvidas.length} devolvida${devolvidas.length !== 1 ? 's' : ''}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <thead><tr style="background:#1a0a2e;color:#fff">
        <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Código</th>
        <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Descrição</th>
        <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Qtd</th>
        <th style="padding:9px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Preço</th>
        <th style="padding:9px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Subtotal</th>
        <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:500">Status</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div style="margin-left:auto;width:280px;font-size:13px;margin-bottom:40px">
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#8a7590">Total vendido (${totalCount(vendidas)} un.)</span><strong>R$ ${Number(d.total_vendido_valor).toFixed(2)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#8a7590">Comissão (${String(d.comissao_percentual).replace('.', ',')}%)</span><span>− R$ ${Number(d.comissao_valor).toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #ddd;font-weight:700;font-size:15px"><span>A receber</span><span>R$ ${Number(d.valor_a_receber).toFixed(2)}</span></div>
    </div>
    <div style="display:flex;gap:60px;margin-top:40px">
      <div style="flex:1;border-top:1px solid #ccc;padding-top:8px;font-size:12px;color:#8a7590">Assinatura da revendedora</div>
      <div style="flex:1;border-top:1px solid #ccc;padding-top:8px;font-size:12px;color:#8a7590">Assinatura Lizzie Semijoias</div>
    </div>`;

  document.getElementById('print-overlay').classList.add('show');
  setTimeout(() => window.print(), 300);
}

// Ação destrutiva: exclui SOMENTE a maleta AGUARDANDO (a próxima já montada).
// A maleta ATIVA (que está com a revendedora) nunca é tocada.
export async function deletarCicloRev(revId) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const nome = state.revNameMap[revId] || 'esta revendedora';

  const { data: aguardando, error: qErr } = await sbQ(sb.from('maletas')
    .select('id').eq('revendedora_id', revId).eq('status', 'aguardando'));
  if (await handleSupabaseError(qErr, 'Erro ao buscar maletas')) return;
  const ids = (aguardando || []).map(m => m.id);
  if (!ids.length) { toast('Esta revendedora não tem maleta aguardando para excluir.'); return; }

  confirmarAcao('⚠ Excluir maleta aguardando',
    `Excluir a maleta AGUARDANDO de ${nome}?\n\nAs peças dessa maleta serão removidas permanentemente. A maleta que está com a revendedora (ativa) NÃO é afetada.`,
    'Excluir maleta aguardando', async () => {
      let error;
      try {
        // 1) remove as peças da(s) maleta(s) aguardando (escopo por maleta_id — nunca por revendedora solta)
        ({ error } = await sb.from('consignados').delete().in('maleta_id', ids));
        // 2) remove a linha da maleta (para não contar no limite de 2)
        if (!error) ({ error } = await sb.from('maletas').delete().in('id', ids));
      } catch (e) { error = e; }
      if (await handleSupabaseError(error, 'Erro ao excluir maleta aguardando')) return;
      toast(`Maleta aguardando de ${nome} excluída`);
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
  document.getElementById('f-tel').value = '';
  document.getElementById('f-nasc').value = '';
  document.getElementById('f-data').value = hojeBR();
  document.getElementById('f-forma').value = 'Pix';
  document.getElementById('f-combinada').value = '';
  document.getElementById('f-obs').value = '';
  ajustarValorPago();
  openModal('modal-finalizar');
}

export function ajustarValorPago() {
  const total = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const forma = document.getElementById('f-forma').value;
  const aVista = ['Dinheiro', 'Pix', 'Cartão débito', 'Cartão crédito'].includes(forma);
  document.getElementById('f-pago').value = aVista ? moneyToInput(total) : '';
  // Data combinada só faz sentido no fiado.
  document.getElementById('f-combinada-wrap').style.display = forma === 'Fiado' ? 'block' : 'none';
}

export async function confirmarVendaCarrinho(btn) {
  const cliente = document.getElementById('f-cliente').value.trim();
  const tel = soDigitos(document.getElementById('f-tel').value);
  const nasc = brToISO(document.getElementById('f-nasc').value);
  const data = brToISO(document.getElementById('f-data').value);
  const forma = document.getElementById('f-forma').value;
  const pago = parseMoneyBR(document.getElementById('f-pago').value);
  const obs = document.getElementById('f-obs').value.trim();
  const combinada = forma === 'Fiado' ? diaMesParaISO(document.getElementById('f-combinada').value) : null;

  if (!cliente) { toast('Informe o nome da cliente'); return; }
  if (tel.length < 10) { toast('Informe o WhatsApp da cliente com DDD'); return; }
  if (!nasc) { toast('Informe o aniversário da cliente (dd/mm/aaaa)'); return; }
  if (!data) { toast('Data inválida (use dd/mm/aaaa)'); return; }
  if (forma === 'Fiado' && !combinada) { toast('Informe a data combinada de pagamento'); return; }
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
        p_tel: tel,
        p_nasc: nasc,
        p_combinada: combinada,
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
  const { data: revs } = await sb.from('profiles').select('id,nome').eq('is_revendedora', true).eq('aprovada',true);
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

// Garante que a revendedora tenha uma maleta ATIVA e devolve o id.
// Usa a existente; se não houver, cria. (Só gestor/staff insere — respeita RLS.)
// Usado nos caminhos legados que criam consignados ativos fora do Lançador.
export async function garantirMaletaAtiva(revId) {
  if (!revId) return null;
  const { data } = await sbQ(sb.from('maletas').select('id').eq('revendedora_id', revId).eq('status', 'ativa').limit(1));
  if (data && data.length) return data[0].id;
  const { data: nova, error } = await sb.from('maletas').insert({ revendedora_id: revId, status: 'ativa', numero: 1 }).select('id').single();
  if (error) { console.error('garantirMaletaAtiva', error); return null; }
  return nova?.id || null;
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

  const maletaId = await garantirMaletaAtiva(revId);
  const { error } = await sb.from('consignados').insert({
    revendedora_id: revId,
    maleta_id: maletaId,
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

// Esqueleto do fechamento em tela inteira (mesmo id #fechamento-content).
function fechTelaSkeletonHtml() {
  return `<button class="btn-voltar-ciclo" onclick="voltarFechamentoTela()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg> Voltar</button>
    <div class="card">
      <div class="modal-title"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg> Fechamento do Catálogo</div>
      <div id="fechamento-content"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn-primary" onclick="gerarPdfFechamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg> Gerar PDF</button>
      </div>
    </div>`;
}

export function voltarFechamentoTela() {
  fechTelaAberta = false;
  renderCicloGrid();
}

export function openFechamento() {
  const restantes = state.allConsignados.filter(c =>
    qtdDisp(c) > 0 && (!state.maletaAtivaId || c.maleta_id === state.maletaAtivaId)
  );

  if (!restantes.length) {
    toast('Nenhuma peça restante — catálogo já está limpo!');
    return;
  }

  // Renderiza a sub-tela (skeleton) antes de preencher o #fechamento-content.
  fechTelaAberta = true;
  renderCicloGrid();

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
}

export function gerarPdfFechamento() {
  const restantes = state.allConsignados.filter(c =>
    qtdDisp(c) > 0 && (!state.maletaAtivaId || c.maleta_id === state.maletaAtivaId)
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

  fechTelaAberta = false;
  renderCicloGrid();
  document.getElementById('print-overlay').classList.add('show');
  setTimeout(() => window.print(), 300);
}

export function fecharPrint() {
  document.getElementById('print-overlay').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════════
// PDF da grid do mostruário (jsPDF + autotable, import dinâmico para
// não pesar o bundle inicial). Exporta o que está filtrado na tela.
// ═══════════════════════════════════════════════════════════════════
function sanitizeArquivo(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function baixarPdfMostruario() {
  try {
    const isAdmin = ehStaff();
    let nomeRev, ativos;
    if (isAdmin) {
      if (!state.cicloRevSelecionada) { toast('Abra o mostruário de uma revendedora primeiro'); return; }
      nomeRev = state.revNameMap[state.cicloRevSelecionada] || 'Revendedora';
      ativos = soAtivos(state.allConsignados).filter(c => c.revendedora_id === state.cicloRevSelecionada);
    } else {
      nomeRev = state.currentProfile.nome;
      ativos = soAtivos(state.allConsignados);
      if (state.maletaAtivaId) ativos = ativos.filter(c => c.maleta_id === state.maletaAtivaId);
    }
    if (!ativos.length) { toast('Nenhum mostruário ativo para exportar'); return; }

    // Mesmo filtro/busca aplicado na tela no momento.
    const termo = (document.getElementById('c-search')?.value || '').toLowerCase().trim();
    let lista = ativos;
    if (termo) {
      lista = lista.filter(c =>
        (c.descricao || '').toLowerCase().includes(termo) ||
        (c.referencia || '').toLowerCase().includes(termo));
    }
    if (state.cicloSoVendidos) lista = lista.filter(foiVendida);
    if (state.cicloSoNaoVendidos) lista = lista.filter(c => !foiVendida(c));
    lista = cicloSortRows(lista);
    if (!lista.length) { toast('Nenhuma peça para exportar com o filtro atual'); return; }

    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable')
    ]);

    const totalEnv  = ativos.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
    const totalVend = ativos.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
    const totalRecv = ativos.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
    const totalDiverg = ativos.filter(c => c.vendido_por_divergencia && (c.quantidade_vendida || 0) > 0).length;
    const peds = pedidosDoCatalogo(ativos);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const filtroLabel = state.cicloSoVendidos ? ' · filtro: apenas vendidos'
      : state.cicloSoNaoVendidos ? ' · filtro: apenas não vendidos'
      : termo ? ` · busca: "${termo}"` : '';

    const doc = new jsPDF();
    // Cabeçalho
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(212, 168, 75); // --gold
    doc.text('L I Z Z I E   S E M I J O I A S', 14, 14);
    doc.setFontSize(18); doc.setTextColor(26, 10, 46); // --plum
    doc.text('Mostruário', 14, 23);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 100, 120);
    doc.text(`Revendedora: ${nomeRev}${peds.length ? `  ·  Pedido${peds.length > 1 ? 's' : ''} #${peds.join(', #')}` : ''}  ·  Gerado em ${hoje}`, 14, 30);
    doc.text(`Resumo: ${ativos.length} peça${ativos.length !== 1 ? 's' : ''} · vendidas ${totalVend}/${totalEnv} · vendido ${fmtBRL(totalRecv)}${totalDiverg ? ` · ${totalDiverg} peça${totalDiverg !== 1 ? 's' : ''} vendida${totalDiverg !== 1 ? 's' : ''} por divergência` : ''}${filtroLabel}`, 14, 36);

    autoTable(doc, {
      startY: 42,
      head: [['Descrição', 'Código', 'Categoria', 'Enviadas', 'Preço', 'Status']],
      body: lista.map(c => {
        const cat = c.categoria || detectarCategoria(c.descricao);
        const vendida = c.quantidade_vendida || 0;
        return [
          c.descricao || '—',
          c.referencia || '—',
          CAT_LABEL[cat] || cat,
          String(c.quantidade_enviada ?? '—'),
          c.preco_venda ? 'R$ ' + Number(c.preco_venda).toFixed(2) : '—',
          vendida > 0
            ? (c.vendido_por_divergencia ? 'Vendido (divergência)' : `Vendido${vendida > 1 ? ` (${vendida})` : ''}`)
            : '—',
        ];
      }),
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.5, textColor: [45, 31, 53] },
      headStyles: { fillColor: [201, 116, 138], textColor: 255, fontStyle: 'bold' }, // --rose
      alternateRowStyles: { fillColor: [250, 247, 242] },
      columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' } },
      didDrawPage: () => {
        const page = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Página ${page}`, doc.internal.pageSize.getWidth() - 14,
          doc.internal.pageSize.getHeight() - 8, { align: 'right' });
      },
    });

    doc.save(`Mostruario_${sanitizeArquivo(nomeRev)}_Pedido${peds.length ? sanitizeArquivo(peds[0]) : 's-n'}.pdf`);
  } catch (e) {
    console.error('Erro ao gerar PDF do mostruário:', e);
    toast('Erro ao gerar o PDF — tente novamente.');
  }
}
