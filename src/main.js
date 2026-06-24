// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
// AUDITORIA RLS — 11/06/2026 — <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> RESOLVIDO
// Toda a autorizacao do app e client-side; a seguranca REAL depende de
// Row Level Security no Postgres. O teste anonimo (anon key publica) inicial
// mostrou profiles (7 linhas, telefones = PII/LGPD) e consignados (100 linhas)
// LEGIVEIS sem login — vazamento causado por policy template permissiva
// (using(true)) somada por OU. Corrigido aplicando RLS-policies.sql (dropa
// todas as policies das 6 tabelas e recria so as corretas: revendedora ve so
// o proprio, admin ve tudo). Re-teste anonimo: as 6 tabelas retornam 0 linhas.
// Se criar tabela nova, lembrar de habilitar RLS + policies antes de publicar.
import './styles.css';
import { sb, SUPABASE_URL, SUPABASE_KEY, RECOVERY_IN_URL, URL_AUTH_ERROR } from './supabase.js';
import { state } from './state.js';
import { CAT_LABEL, brToISO, closeModal, confirmarAcao, detectarCategoria, esc, fecharConfirma, fetchPaginado, fmtBRL, formatDate, handleSupabaseError, hojeBR, isAuthError, isoToBR, maskDateBR, maskMoneyBR, moneyToInput, openModal, parseMoneyBR, previewFoto, qtdDisp, sbQ, showMsg, toast } from './utils.js';
import { showPanel, toggleCadastros } from './nav.js';
import { mostrarRecovery, ROLE_LABELS, ehAdmin, ehGestor, ehStaff, loadUser, maskTelBR, salvarComplemento, showSplash, switchTab, fazerLogin, mostrarRecuperar, voltarLogin, loginGoogle, enviarLinkRecuperacao, salvarNovaSenha, fazerCadastro } from './auth.js';
import { loadDashboard, loadFinanceiro, loadCalculadora, loadClientes, loadMarketing, loadFuncionarios, loadFormasPagamento, loadCategoriasFinanceiras } from './dashboard.js';
import { calcPrazoGarantia, loadGarantias, filtrarGarantias, sortGarantiasStaff, setGFilter, renderGarantiaCard, verGarantia, openNovaGarantia, editarGarantia, salvarGarantia, mudarStatus, atualizarStatusCard, excluirGarantia } from './garantias.js';
import { openBlingSync, buscarBling, filtrarBling, verItensBling, voltarListaBling, importarItensBling, atualizarMaleta, previewMaletaPorId, confirmarMaleta, salvarBlingId, detectarBlingId, escolherBlingCandidato, normalizarNome, fetchTodosBling, SITUACAO_ABERTO, BLING_ITENS_FN, BLING_HEADERS } from './bling.js';
import { loadVendas, setPFilter, verVenda, excluirVenda, registrarPagamento } from './pagamentos.js';
import { loadHistorico, filtrarHistorico, toggleHistorico } from './historico.js';
import { loadTrocasDashboard, setTrocaFiltro, toggleOrdemTroca, carregarProximasTrocas, compararPorTroca, atualizarBadgesTroca } from './trocas.js';








// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
async function init() {
  // Listener ANTES do getSession para nao perder o evento PASSWORD_RECOVERY.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { mostrarRecovery(); return; }
    if (state.recoveryAtiva) return; // durante a redefinicao, ignora SIGNED_IN/OUT
    // IMPORTANTE: nao usar await/chamadas Supabase direto aqui — isso causa
    // deadlock do lock de auth (login novo travava em "carregando"). Adia com
    // setTimeout(0) para o callback liberar o lock antes de loadUser consultar.
    if (event === 'SIGNED_IN' && session) {
      // O supabase re-dispara SIGNED_IN ao voltar o foco da aba / refresh de token.
      // Se já é o mesmo usuário carregado, NÃO recarrega (senão pula pro dashboard).
      if (state.currentUser && state.currentUser.id === session.user.id) return;
      setTimeout(() => loadUser(session.user), 0);
    }
    if (event === 'SIGNED_OUT') { state.currentUser = null; state.currentProfile = null; showSplash(); }
  });

  const { data: { session } } = await sb.auth.getSession();

  if (URL_AUTH_ERROR) {
    // Link de recuperacao invalido ou expirado: avisa em vez de cair no login mudo.
    history.replaceState(null, '', location.pathname);
    showSplash();
    showMsg(document.getElementById('login-msg'),
      'O link expirou ou já foi usado. Clique em "Esqueci minha senha" para receber um novo.', 'error');
  }
  // Veio pelo link de recuperacao do e-mail: mostra a tela de nova senha,
  // nao entra no app (mesmo que o link tenha criado uma sessao temporaria).
  else if (RECOVERY_IN_URL) { mostrarRecovery(); }
  else if (session) await loadUser(session.user);
  else showSplash();

  document.getElementById('g-entrada').value = hojeBR();
  calcPrazoGarantia();
}



                                  // gestão de acesso (papéis, excluir)
          // Bling, catálogo, aprovar
 // vê tudo (não-revendedora)






// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════









// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════




// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════


// ═══════════════════════════════════════════════
// GARANTIAS
// ═══════════════════════════════════════════════












// ═══════════════════════════════════════════════
// CICLO (CONSIGNADOS)
// ═══════════════════════════════════════════════

async function loadConsignados() {
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

function sortConsignados(col) {
  if (state.cSort.col === col) state.cSort.dir = state.cSort.dir === 'asc' ? 'desc' : 'asc';
  else { state.cSort.col = col; state.cSort.dir = 'asc'; }
  renderCicloGrid();
}



function renderCicloGrid() {
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

function cicloSortRows(list) {
  return [...list].sort((a, b) => {
    let va = a[state.cSort.col] ?? '', vb = b[state.cSort.col] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return state.cSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return state.cSort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function cicloArrow(col) {
  return state.cSort.col !== col ? '<span style="opacity:0.3">⇅</span>' : (state.cSort.dir === 'asc' ? '▲' : '▼');
}

function cicloTh(col, label) {
  return `<th class="ciclo-th${state.cSort.col === col ? ' sorted' : ''}" onclick="sortConsignados('${col}')">${label} ${cicloArrow(col)}</th>`;
}

function cicloRowHtml(c, isAdmin, historico = false) {
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

function cicloTableHtml(list, isAdmin, historico = false) {
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

function renderCicloRevendedora() {
  const ativos = soAtivos(state.allConsignados);
  const temAtivos = ativos.some(c => qtdDisp(c) > 0);
  const btnFechamento = temAtivos
    ? `<button class="btn-secondary" style="width:100%;margin-top:16px;border-color:var(--gold);color:var(--gold)" onclick="openFechamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg> Fechamento do Catálogo</button>`
    : '';

  const historico = historicoCatalogosHtml(state.allConsignados);
  const cabecalho = pedidoLabelHtml(ativos, 12);

  const termo = (document.getElementById('c-search')?.value || '').toLowerCase().trim();
  if (termo) {
    const lista = ativos.filter(c =>
      (c.descricao || '').toLowerCase().includes(termo) ||
      (c.referencia || '').toLowerCase().includes(termo)
    );
    if (!lista.length) {
      return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma peça encontrada com "${termo}"</p></div>` + historico;
    }
    return cabecalho + cicloTableHtml(lista, false) + btnFechamento + historico;
  }

  // Sem catálogo ativo: mostra aviso + histórico (se houver), em vez de tabela vazia.
  if (!ativos.length) {
    return `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></div><p>Nenhum catálogo ativo no momento</p></div>` + historico;
  }

  return cabecalho + cicloTableHtml(ativos, false) + btnFechamento + historico;
}

function agruparPorRevendedora() {
  const groups = {};
  state.allConsignados.forEach(c => {
    const id = c.revendedora_id || '__sem__';
    if (!groups[id]) groups[id] = [];
    groups[id].push(c);
  });
  return groups;
}

function pedidosDoCatalogo(list) {
  return [...new Set((list || []).map(c => c.pedido_numero).filter(Boolean))];
}

function pedidoLabelHtml(list, fontSize) {
  const peds = pedidosDoCatalogo(list);
  if (!peds.length) return '';
  const label = peds.length > 1 ? 'Pedidos' : 'Pedido';
  return `<div style="font-size:${fontSize}px;color:var(--rose);font-family:monospace;margin-top:2px">${label} ${peds.map(n => '#' + n).join(', ')}</div>`;
}

const soAtivos     = list => list.filter(c => c.status === 'ativo');
const soEncerrados = list => list.filter(c => c.status === 'encerrado');

// Agrupa peças encerradas em ciclos (1 ciclo = 1 fechamento), pela data de encerramento.
// Retorna [[ 'YYYY-MM-DD', [pecas...] ], ...] — mais recente primeiro.
function ciclosEncerrados(list) {
  const map = {};
  soEncerrados(list).forEach(c => {
    const chave = (c.encerrado_em || c.created_at || '').slice(0, 10); // YYYY-MM-DD
    (map[chave] = map[chave] || []).push(c);
  });
  return Object.entries(map).sort((a, b) => a[0] < b[0] ? 1 : -1);
}

// Bloco "Histórico de catálogos" (somente leitura). Retorna '' se não houver ciclos encerrados.
// Usa cicloTableHtml(..., true): coluna "Status" (sem botão Vender), portanto read-only.
function historicoCatalogosHtml(list) {
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
function pecasDoCiclo(chave) {
  let base = state.allConsignados;
  if (ehStaff() && state.cicloRevSelecionada) base = base.filter(c => c.revendedora_id === state.cicloRevSelecionada);
  return soEncerrados(base).filter(c => (c.encerrado_em || c.created_at || '').slice(0, 10) === chave);
}

// Tela própria de um ciclo encerrado (somente leitura).
function renderHistoricoCicloDetalhe(chave) {
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

function abrirHistoricoCiclo(chave) {
  state.historicoCicloSel = chave;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  renderCicloGrid();
}

function voltarHistoricoCiclo() {
  state.historicoCicloSel = null;
  renderCicloGrid();
}

function statsRevendedora(list) {
  const ativos = soAtivos(list);
  // Totais refletem APENAS o catálogo atual (ativo). A receita histórica fica no bloco de histórico.
  const totalEnv = ativos.reduce((s, c) => s + (c.quantidade_enviada || 0), 0);
  const totalVend = ativos.reduce((s, c) => s + (c.quantidade_vendida || 0), 0);
  const totalRecv = ativos.reduce((s, c) => s + ((c.quantidade_vendida || 0) * Number(c.preco_venda || 0)), 0);
  return { ativos, temAtivos: ativos.length > 0, totalEnv, totalVend, totalRecv };
}


function renderCicloAdmin() {
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

function renderCicloAdminDetalhe(revId, list) {
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
    listaTabela = ativos.filter(c =>
      (c.descricao || '').toLowerCase().includes(termo) ||
      (c.referencia || '').toLowerCase().includes(termo)
    );
  }
  const tabelaHtml = (termo && !listaTabela.length)
    ? `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma peça encontrada com "${termo}"</p></div>`
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

function abrirCicloRev(revId) {
  state.cicloRevSelecionada = revId;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  renderCicloGrid();
}

function voltarCardsCiclo() {
  state.cicloRevSelecionada = null;
  state.historicoCicloSel = null;
  const cs = document.getElementById('c-search');
  if (cs) cs.value = '';
  renderCicloGrid();
}

function openBuscaPeca() {
  const input = document.getElementById('bp-search');
  input.value = '';
  renderBuscaPeca();
  openModal('modal-busca-peca');
  setTimeout(() => input.focus(), 100);
}

function renderBuscaPeca() {
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

async function finalizarCicloRev(revId) {
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

async function deletarCicloRev(revId) {
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

// ═══════════════════════════════════════════════
// CARRINHO DE VENDA
// ═══════════════════════════════════════════════

function openVenda(id) {
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

function atualizarTotalVenda() {
  const qtd = parseInt(document.getElementById('v-qtd').value) || 1;
  const preco = parseFloat(document.getElementById('v-preco-unit').value) || 0;
  document.getElementById('v-total').value = 'R$ ' + (qtd * preco).toFixed(2);
}

function adicionarAoCarrinho() {
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

function removerDoCarrinho(idx) {
  state.carrinhoVenda.splice(idx, 1);
  renderCartBar();
  if (document.getElementById('modal-finalizar').classList.contains('show')) {
    if (!state.carrinhoVenda.length) { closeModal('modal-finalizar'); return; }
    abrirFinalizarVenda();
  }
}

function renderCartBar() {
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

function abrirFinalizarVenda() {
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

function ajustarValorPago() {
  const total = state.carrinhoVenda.reduce((s, i) => s + i.quantidade * i.preco_unit, 0);
  const forma = document.getElementById('f-forma').value;
  const aVista = ['Dinheiro', 'Pix', 'Cartão débito', 'Cartão crédito'].includes(forma);
  document.getElementById('f-pago').value = aVista ? moneyToInput(total) : '';
}

async function confirmarVendaCarrinho(btn) {
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

async function openNovoConsignado() {
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

async function salvarConsignado() {
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

// ═══════════════════════════════════════════════
// BLING
// ═══════════════════════════════════════════════






















// ═══════════════════════════════════════════════
// PAGAMENTOS (vendas)
// ═══════════════════════════════════════════════






// ═══════════════════════════════════════════════
// HISTÓRICO
// ═══════════════════════════════════════════════






// ═══════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════
async function loadAdmin() {
  document.getElementById('rev-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  document.getElementById('pendentes-list').innerHTML = '';
  const [{ data: pendentes, error: e1 }, { data: aprovadas, error: e2 }] = await Promise.all([
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',false).order('created_at')),
    sbQ(sb.from('profiles').select('*').eq('role','revendedora').eq('aprovada',true).order('nome'))
  ]);
  if (e1 || e2) {
    const msg = (e1||e2).message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar revendedoras.';
    document.getElementById('rev-list').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }

  const pendDiv = document.getElementById('pendentes-list');
  if (pendentes && pendentes.length) {
    pendDiv.innerHTML = `<div class="alert alert-warning"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> ${pendentes.length} cadastro${pendentes.length>1?'s':''} aguardando aprovação</div>` +
      pendentes.map(r => renderRevCard(r, true)).join('');
  } else pendDiv.innerHTML = '';

  state.aprovadasCache = aprovadas || [];
  await renderAprovadas();
}

async function renderAprovadas() {
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


// ═══════════════════════════════════════════════
// DASHBOARD DE TROCAS (admin)
// ═══════════════════════════════════════════════










function renderRevCard(r, pendente) {
  const inicial = r.nome.charAt(0).toUpperCase();
  const trocaSlot = pendente ? '' : `<div data-troca-bling-id="${r.bling_contato_id || ''}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><span style="font-size:11px;color:var(--muted)">Carregando próxima troca...</span></div>`;
  return `<div class="card rev-card" onclick="verRevendedora('${r.id}')">
    <div class="rev-header">
      <div class="rev-avatar">${inicial}</div>
      <div>
        <div class="rev-nome">${esc(r.nome)}</div>
        <div class="rev-cidade">${esc(r.cidade || 'Cidade não informada')} · ${esc(r.telefone || '—')}</div>
      </div>
      <div class="rev-status">
        ${pendente ? '<span class="badge badge-pendente"><span class="pending-dot"></span>Pendente</span>' : '<span class="badge badge-ativo"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Ativa</span>'}
      </div>
    </div>
    ${trocaSlot}
  </div>`;
}

async function verRevendedora(id) {
  const { data: r } = await sb.from('profiles').select('*').eq('id', id).single();
  const { data: gcount } = await sb.from('garantias').select('id', { count: 'exact' }).eq('revendedora_id', id);
  const { data: ccount } = await sb.from('consignados').select('id', { count: 'exact' }).eq('revendedora_id', id);

  document.getElementById('detalhe-rev-content').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div class="rev-avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 12px">${r.nome.charAt(0)}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--plum)">${esc(r.nome)}</div>
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

async function aprovarRev(id) {
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

async function revogarRev(id) {
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

async function definirPapel(id, novoPapel) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('profiles').update({ role: novoPapel }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao definir papel')) return;
  toast('Nível atualizado: ' + (ROLE_LABELS[novoPapel] || novoPapel));
  state.blingRevs = []; state.aprovadasCache = [];
  loadAdmin();
}

// Confirmacao embutida (sem confirm() nativo, que nao aparece no PWA).
function confirmarExclusaoRev(id, btn) {
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

async function excluirRevendedora(id, btn) {
  if (!ehAdmin()) { toast('Sem permissão'); return; }
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

// ── Atualizar itens da maleta (Bling -> app, append-only, gestor) ──────








// ═══════════════════════════════════════════════
// FECHAMENTO DO CICLO
// ═══════════════════════════════════════════════
function openFechamento() {
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

function gerarPdfFechamento() {
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

function fecharPrint() {
  document.getElementById('print-overlay').classList.remove('show');
}

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════


document.querySelectorAll('.modal-overlay').forEach(o => {
  // data-lock-outside: so fecha pelo botao Fechar/Cancelar (ex.: garantia),
  // evitando perder dados por um clique acidental fora do pop-up.
  o.addEventListener('click', e => {
    if (e.target === o && !o.hasAttribute('data-lock-outside')) o.classList.remove('show');
  });
});






// Expoe no window TODAS as funcoes chamadas via on* no HTML (estatico e gerado),
// pois main.js agora e um ES module (escopo proprio). Lista derivada dos handlers on*.
Object.assign(window, { renderAprovadas, renderGarantiaCard, ehAdmin, ehStaff, ehGestor, loadDashboard, loadGarantias, loadConsignados, loadVendas, loadHistorico, loadTrocasDashboard, loadAdmin, loadFinanceiro, loadCalculadora, loadClientes, loadMarketing, loadFuncionarios, loadFormasPagamento, loadCategoriasFinanceiras, sb, abrirCicloRev, abrirFinalizarVenda, abrirHistoricoCiclo, adicionarAoCarrinho, ajustarValorPago, aprovarRev, atualizarMaleta, atualizarStatusCard, atualizarTotalVenda, buscarBling, calcPrazoGarantia, closeModal, confirmarExclusaoRev, confirmarMaleta, confirmarVendaCarrinho, definirPapel, deletarCicloRev, detectarBlingId, editarGarantia, enviarLinkRecuperacao, escolherBlingCandidato, excluirGarantia, excluirRevendedora, excluirVenda, fazerCadastro, fazerLogin, fecharConfirma, fecharPrint, filtrarBling, filtrarGarantias, filtrarHistorico, finalizarCicloRev, gerarPdfFechamento, importarItensBling, loginGoogle, maskDateBR, maskMoneyBR, maskTelBR, mostrarRecuperar, mudarStatus, openBlingSync, openBuscaPeca, openFechamento, openNovaGarantia, openNovoConsignado, openVenda, previewFoto, previewMaletaPorId, registrarPagamento, removerDoCarrinho, renderBuscaPeca, renderCicloGrid, revogarRev, salvarBlingId, salvarComplemento, salvarConsignado, salvarGarantia, salvarNovaSenha, setGFilter, setPFilter, setTrocaFiltro, showPanel, sortConsignados, sortGarantiasStaff, switchTab, toggleCadastros, toggleHistorico, toggleOrdemTroca, verGarantia, verItensBling, verRevendedora, verVenda, voltarCardsCiclo, voltarHistoricoCiclo, voltarListaBling, voltarLogin });

// START
init();

// PWA — install prompt + iOS banner + service worker
(function () {
  const installBtn = document.getElementById('install-btn');
  const iosBanner = document.getElementById('ios-install-banner');
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    let deferredPrompt = null;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    const ehMobile = isIOS || isAndroid;

    // "Instalar app" só faz sentido no celular/tablet — no desktop não aparece.
    if (ehMobile) installBtn.classList.add('show');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });

    function abrirInstrucoesInstalar() {
      const el = document.getElementById('install-instrucoes');
      if (isIOS) {
        el.innerHTML = `No iPhone/iPad, use o <b>Safari</b>:<br><br>
          1. Toque no botão <b>Compartilhar</b> (quadradinho com a seta ↑, na barra de baixo)<br>
          2. Role e toque em <b>Adicionar à Tela de Início</b><br>
          3. Toque em <b>Adicionar</b><br><br>
          <span style="color:var(--muted);font-size:12px">Pelo Chrome do iPhone não dá — tem que ser o Safari.</span>`;
      } else if (isAndroid) {
        el.innerHTML = `No Android, use o <b>Chrome</b>:<br><br>
          1. Toque no menu <b>⋮</b> (três pontinhos, canto superior direito)<br>
          2. Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b><br>
          3. Confirme em <b>Instalar</b><br><br>
          <span style="color:var(--muted);font-size:12px">Se você abriu pelo Instagram/WhatsApp, toque em ⋮ → "Abrir no Chrome" antes.</span>`;
      } else {
        el.innerHTML = `No computador, use o <b>Chrome</b> ou <b>Edge</b>:<br><br>
          1. Clique no ícone de <b>instalar</b> (⊕ / monitor) no fim da barra de endereço<br>
          2. Confirme em <b>Instalar</b>`;
      }
      openModal('modal-install');
    }

    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') installBtn.classList.remove('show');
        return;
      }
      // Sem prompt nativo (iOS, navegador embutido, etc.) → instruções por aparelho.
      abrirInstrucoesInstalar();
    });

    window.addEventListener('appinstalled', () => {
      installBtn.classList.remove('show');
      iosBanner.classList.remove('show');
      closeModal('modal-install');
    });

    // Tarja automática no iOS, só na primeira vez.
    if (isIOS && !localStorage.getItem('lizzie-ios-banner-dismissed')) {
      setTimeout(() => iosBanner.classList.add('show'), 2500);
      iosBanner.querySelector('.ios-close').addEventListener('click', () => {
        iosBanner.classList.remove('show');
        localStorage.setItem('lizzie-ios-banner-dismissed', '1');
      });
    }
  }

  // Registro do service worker e feito pelo vite-plugin-pwa (registerType: 'autoUpdate').
})();
