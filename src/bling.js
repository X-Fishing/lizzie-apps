// Integracao Bling (Edge Functions) + sincronizacao de maletas/pedidos.
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { state } from './state.js';
import { esc, toast, sbQ, fetchPaginado, handleSupabaseError, openModal, closeModal, fmtBRL, confirmarAcao, formatDate, hojeBR, brToISO, isAuthError, qtdDisp } from './utils.js';
import { garantirMaletaAtiva } from './consignados.js';
export const BLING_FN       = `${SUPABASE_URL}/functions/v1/bling-pedidos`;

export const BLING_ITENS_FN = `${SUPABASE_URL}/functions/v1/bling-pedido-itens`;

export const BLING_HEADERS  = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

export function normalizarNome(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g,'').trim();
}

export function tokensNome(s) {
  const stop = new Set(['dos','das','de','da','do','e']);
  return normalizarNome(s)
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stop.has(t));
}

export function openBlingSync() {
  const isAdmin = ehGestor();
  document.getElementById('bling-resultado').innerHTML = '';
  if (isAdmin) {
    const mes = new Date(); mes.setDate(1);
    document.getElementById('bling-data-ini').value = `${String(mes.getDate()).padStart(2,'0')}/${String(mes.getMonth()+1).padStart(2,'0')}/${mes.getFullYear()}`;
    document.getElementById('bling-data-fim').value = hojeBR();
    document.getElementById('bling-header').style.display = 'block';
  } else {
    document.getElementById('bling-header').style.display = 'none';
    openModal('modal-bling');
    buscarUltimoPedidoRev();
    return;
  }
  openModal('modal-bling');
}

export async function fetchTodosBling(ini, fim) {
  const todos = [];
  let pagina = 1;
  while (true) {
    const resp = await fetch(`${BLING_FN}?pagina=${pagina}&dataInicial=${ini}&dataFinal=${fim}`, { headers: BLING_HEADERS });
    if (!resp.ok) return null;
    const json = await resp.json();
    const pedidos = json.data || [];
    todos.push(...pedidos);
    if (pedidos.length < 100 || pagina >= 10) break;
    pagina++;
  }
  return todos;
}

// ── PRÓXIMA TROCA DE MALETA (via Bling) ──
// Bling: situacao.id === 6 = "Em aberto" (maleta em campo)
//        situacao.id === 9 = "Atendido"  (maleta já voltou)
export const SITUACAO_ABERTO = 6;

// ── REVENDEDORA: busca só o último pedido dela ──
export async function buscarUltimoPedidoRev() {
  const res = document.getElementById('bling-resultado');

  const blingId = state.currentProfile.bling_contato_id;
  if (!blingId) {
    res.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
      <p>Seu perfil ainda não está vinculado ao Bling.<br>
      <span style="color:var(--muted)">Peça para a administradora vincular seu ID do Bling no painel Admin → seu nome.</span></p>
    </div>`;
    return;
  }

  // Bloquear se já há ciclo ativo
  const { data: cicloAtivo } = await sb.from('consignados')
    .select('id, quantidade_enviada, quantidade_vendida, quantidade_devolvida')
    .eq('revendedora_id', state.currentUser.id)
    .eq('status', 'ativo');
  const temPecasAtivas = (cicloAtivo || []).some(c =>
    qtdDisp(c) > 0
  );
  if (temPecasAtivas) {
    res.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
      <p><strong>Você já tem um catálogo ativo.</strong><br>
      <span style="color:var(--muted)">Finalize o catálogo atual clicando em <strong>Fechamento do Catálogo</strong> na aba Catálogo antes de baixar uma nova relação.</span></p>
    </div>`;
    return;
  }

  res.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Buscando seu último pedido...</div>';

  const hoje = new Date().toISOString().split('T')[0];
  const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 6);
  const todos = await fetchTodosBling(inicio.toISOString().split('T')[0], hoje);

  if (!todos) {
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao conectar com o Bling.</p></div>';
    return;
  }

  console.log('[Bling] Total pedidos retornados:', todos.length);
  console.log('[Bling] Procurando contato.id =', blingId);
  console.log('[Bling] Estrutura do 1º pedido:', todos[0]);
  console.log('[Bling] IDs de contato disponíveis:', [...new Set(todos.map(p => `${p.contato?.id} (${p.contato?.nome})`))]);

  let meusPedidos = todos.filter(p => String(p.contato?.id) === String(blingId));

  if (!meusPedidos.length) {
    const alvo = normalizarNome(state.currentProfile.nome);
    meusPedidos = todos.filter(p => {
      const nome = normalizarNome(p.contato?.nome);
      return nome && (nome === alvo || nome.includes(alvo) || alvo.includes(nome));
    });
    if (meusPedidos.length) {
      console.warn('[Bling] ID não bateu, mas achou', meusPedidos.length, 'pedido(s) pelo nome. Avise o admin para corrigir o ID Bling no painel.');
    }
  }

  if (!meusPedidos.length) {
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg></div><p>Nenhum pedido encontrado nos últimos 6 meses.</p></div>';
    return;
  }

  meusPedidos.sort((a, b) => b.data.localeCompare(a.data));
  const pedido = meusPedidos[0];
  res.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Último pedido — <strong>${formatDate(pedido.data)}</strong></div>`;
  await renderItensBling(pedido.id, pedido.numero, state.currentUser.id, false);
}

// ── ADMIN: busca com filtro de data, todos os pedidos ──
export async function buscarBling() {
  const ini = brToISO(document.getElementById('bling-data-ini').value);
  const fim = brToISO(document.getElementById('bling-data-fim').value);
  if (!ini || !fim) { toast('Datas inválidas (use dd/mm/aaaa)'); return; }

  const res = document.getElementById('bling-resultado');
  res.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Buscando pedidos...</div>';

  const todos = await fetchTodosBling(ini, fim);
  if (!todos) {
    state.blingPedidosCache = [];
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao conectar com o Bling.</p></div>';
    return;
  }
  if (!todos.length) {
    state.blingPedidosCache = [];
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg></div><p>Nenhum pedido nesse período.</p></div>';
    return;
  }

  state.blingPedidosCache = todos;
  state.blingFiltro = '';
  renderListaBling();
}

export function renderBlingRow(p) {
  const situMap = { 6:{label:'Em aberto',badge:'badge-pendente'}, 9:{label:'Atendido',badge:'badge-quitado'} };
  const sit = situMap[p.situacao?.id] || { label:'Outro', badge:'badge-aberta' };
  return `<div class="bling-row">
    <div class="bling-num">#${p.numero}</div>
    <div class="bling-info">
      <div class="bling-cliente">${esc(p.contato?.nome || '—')}</div>
      <div class="bling-data">${formatDate(p.data)} &nbsp;<span class="badge ${sit.badge}" style="font-size:10px">${sit.label}</span> &nbsp;<span style="font-size:10px;color:var(--muted);font-family:monospace">id:${p.contato?.id}</span></div>
    </div>
    <div class="bling-total">R$ ${Number(p.total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
    <button class="btn-import" onclick="verItensBling('${p.id}',${p.numero},this)">Ver itens</button>
  </div>`;
}

export function renderListaBling() {
  const res = document.getElementById('bling-resultado');
  res.innerHTML =
    `<input type="text" id="bling-filtro" class="form-control" style="margin-bottom:12px" placeholder="Buscar por nome da revendedora..." oninput="filtrarBling(this.value)" value="${state.blingFiltro.replace(/"/g,'&quot;')}">
     <div id="bling-lista-info" style="font-size:12px;color:var(--muted);margin-bottom:12px"></div>
     <div id="bling-lista"></div>`;
  aplicarFiltroBling();
}

export function aplicarFiltroBling() {
  const total = state.blingPedidosCache.length;
  const filtro = normalizarNome(state.blingFiltro);
  const filtrados = filtro
    ? state.blingPedidosCache.filter(p => normalizarNome(p.contato?.nome).includes(filtro))
    : state.blingPedidosCache;

  const info = document.getElementById('bling-lista-info');
  const lista = document.getElementById('bling-lista');
  if (!info || !lista) return;

  info.textContent = filtro
    ? `${filtrados.length} de ${total} pedido${total!==1?'s':''}`
    : `${total} pedido${total!==1?'s':''} encontrado${total!==1?'s':''}`;

  lista.innerHTML = filtrados.length
    ? filtrados.map(renderBlingRow).join('')
    : '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhum pedido com esse nome</p></div>';
}

export function filtrarBling(val) {
  state.blingFiltro = val;
  aplicarFiltroBling();
}

export async function verItensBling(pedidoId, numero, btn) {
  btn.textContent = '⟳'; btn.disabled = true;

  if (!state.blingRevs.length) {
    const { data, error } = await sb.from('profiles').select('id,nome').eq('is_revendedora', true).eq('aprovada',true).order('nome');
    if (error) { console.error('Erro ao buscar revendedoras:', error); }
    state.blingRevs = data || [];
  }

  document.getElementById('bling-header').style.display = 'none';
  const res = document.getElementById('bling-resultado');

  if (!state.blingRevs.length) {
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Nenhuma revendedora aprovada encontrada. Verifique o painel Admin.</p></div>';
    return;
  }

  res.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando itens...</div>';
  await renderItensBling(pedidoId, numero, null, true);
}

export async function renderItensBling(pedidoId, numero, fixedRevId, mostrarSeletor) {
  const res = document.getElementById('bling-resultado');
  const resp = await fetch(`${BLING_ITENS_FN}?id=${pedidoId}`, { headers: BLING_HEADERS });
  if (!resp.ok) {
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao buscar itens do pedido.</p></div>';
    return;
  }
  const json = await resp.json();
  const itens = json.data?.itens || json.itens || json.data || [];
  if (!itens.length) {
    res.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg></div><p>Nenhum item nesse pedido.</p></div>';
    return;
  }

  state.blingItensAtual = itens;
  if (fixedRevId) {
    window._blingFixedRevId = fixedRevId;
  } else {
    window._blingFixedRevId = null;
  }

  const revOpts = mostrarSeletor
    ? `<div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Atribuir ao catálogo de *</label>
        <select id="bling-rev-sel" class="form-control">
          <option value="">Selecione a revendedora...</option>
          ${state.blingRevs.map(r => `<option value="${r.id}">${esc(r.nome)}</option>`).join('')}
        </select>
       </div>`
    : `<div style="margin-bottom:12px;font-size:13px;color:var(--muted)">Será importado para o seu catálogo</div>`;

  const voltar = mostrarSeletor
    ? `<button class="btn-secondary btn-sm" onclick="voltarListaBling()">← Voltar</button>`
    : '';

  res.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      ${voltar}
      <span style="font-weight:500;color:var(--plum)">Pedido #${numero} — ${itens.length} ite${itens.length!==1?'ns':'m'}</span>
    </div>
    ${revOpts}
    <div class="ciclo-wrap" style="margin-bottom:16px">
      <table class="ciclo-table">
        <thead><tr>
          <th class="ciclo-th ciclo-th-nosort">SKU</th>
          <th class="ciclo-th ciclo-th-nosort">Descrição</th>
          <th class="ciclo-th ciclo-th-nosort" style="text-align:center">Qtd</th>
          <th class="ciclo-th ciclo-th-nosort">Preço</th>
        </tr></thead>
        <tbody>
          ${itens.map(it => `<tr class="ciclo-row">
            <td class="ciclo-td"><span class="ciclo-ref">${it.codigo||'—'}</span></td>
            <td class="ciclo-td"><span class="ciclo-desc">${esc(it.descricao)}</span></td>
            <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${it.quantidade}</span></td>
            <td class="ciclo-td"><span class="ciclo-preco">R$ ${Number(it.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn-primary" style="width:100%" onclick="importarItensBling(${numero},this)">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> Importar ${itens.length} ite${itens.length!==1?'ns':'m'} para o Catálogo
    </button>`;
}

export function voltarListaBling() {
  document.getElementById('bling-header').style.display = 'block';
  if (state.blingPedidosCache.length) {
    renderListaBling();
  } else {
    document.getElementById('bling-resultado').innerHTML = '';
    buscarBling();
  }
}

export async function importarItensBling(numero, btn) {
  const itens = state.blingItensAtual;
  if (!itens.length) { toast('Nenhum item para importar'); return; }

  const revId = window._blingFixedRevId
    || (document.getElementById('bling-rev-sel') && document.getElementById('bling-rev-sel').value);

  if (!revId) { toast('Selecione a revendedora'); return; }

  btn.textContent = '⟳ Importando...'; btn.disabled = true;

  const maletaId = await garantirMaletaAtiva(revId);
  const { error } = await sb.from('consignados').insert(
    itens.map(it => ({
      revendedora_id: revId,
      maleta_id: maletaId,
      descricao: it.descricao,
      referencia: it.codigo || null,
      quantidade_enviada: Number(it.quantidade),
      preco_venda: Number(it.valor),
      foto_url: null,
      status: 'ativo',
      pedido_numero: numero != null ? String(numero) : null
    }))
  );

  if (error) {
    console.error('Erro ao importar itens:', error.message, error.details, error.hint, error);
    toast('Erro: ' + (error.message || 'tente novamente'));
    btn.textContent = `Importar ${itens.length} ite${itens.length!==1?'ns':'m'} para o Catálogo`;
    btn.disabled = false;
    return;
  }

  btn.textContent = `${itens.length} ite${itens.length!==1?'ns':'m'} importado${itens.length!==1?'s':''}!`;
  toast(`Pedido #${numero} — ${itens.length} itens adicionados ao Catálogo!`);
  closeModal('modal-bling');
  loadConsignados();
}

export async function atualizarMaleta(revId, btn) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const blingId = ((btn && btn.dataset.blingId) || '').trim();
  const nome = (btn && btn.dataset.revNome) || 'revendedora';

  openModal('modal-maleta');
  const cont = document.getElementById('maleta-content');
  cont.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Buscando pedidos no Bling...</div>';

  // Pedido(s) já vinculados à maleta (carimbados na importação/sync). É a forma
  // confiável de achar o pedido: o Bling não retorna o vendedor, e o "contato"
  // do pedido pode ser o CLIENTE (não a revendedora).
  const { data: rows } = await sbQ(sb.from('consignados').select('pedido_numero').eq('revendedora_id', revId));
  const pedidoNums = [...new Set((rows || []).map(r => (r.pedido_numero || '').toString().trim()).filter(Boolean))];

  const hoje = new Date().toISOString().split('T')[0];
  const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 12);
  const todos = await fetchTodosBling(inicio.toISOString().split('T')[0], hoje);
  if (!todos) { cont.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao conectar com o Bling. Tente de novo.</p></div>'; return; }

  // Candidatos = UNIÃO de:
  //  (1) pedidos JÁ vinculados à maleta (por número carimbado) — cobre o modelo
  //      em que a revendedora é o VENDEDOR e o contato do pedido é o cliente; e
  //  (2) pedidos EM ABERTO da revendedora (por id de contato ou, se não casar,
  //      por nome) — inclui pedidos NOVOS ainda não vinculados (nova maleta).
  // Sem isso, um pedido novo em aberto (ex.: #18526) não aparecia quando a maleta
  // já tinha outros pedidos vinculados.
  const vinculados = pedidoNums.length ? todos.filter(p => pedidoNums.includes(String(p.numero))) : [];
  // Pedidos EM ABERTO da revendedora: casa por ID de contato OU por NOME (união, NÃO
  // fallback). A revendedora pode ter MAIS DE UM contato no Bling com o mesmo nome e
  // ids diferentes (ex.: Bruna #18638 id A e #18526 id B); filtrar só pelo id salvo
  // deixava o outro pedido de fora.
  const abertos = todos.filter(p => p.situacao?.id === SITUACAO_ABERTO);
  const alvoNome = nome ? normalizarNome(nome) : '';
  const abertosRev = abertos.filter(p => {
    if (blingId && String(p.contato?.id) === String(blingId)) return true;
    if (alvoNome) {
      const cn = normalizarNome(p.contato?.nome);
      return cn && (cn === alvoNome || cn.includes(alvoNome) || alvoNome.includes(cn));
    }
    return false;
  });
  const porNumero = new Map();
  [...vinculados, ...abertosRev].forEach(p => porNumero.set(String(p.numero), p));
  const candidatos = [...porNumero.values()].sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  if (!candidatos.length) {
    const dica = pedidoNums.length
      ? `Pedido(s) vinculado(s): ${pedidoNums.map(n => '#' + n).join(', ')} — não retornaram na busca (mais de 12 meses atrás?).`
      : 'Importe a relação uma vez (<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> Baixar Relação de Peças) para vincular o pedido, ou confira o ID do contato Bling.';
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
      <p>Nenhum pedido encontrado no Bling para <strong>${esc(nome)}</strong>.</p>
      <p style="font-size:12px;color:var(--muted);margin-top:6px">${dica}</p></div>`;
    return;
  }

  if (candidatos.length === 1) { previewMaleta(revId, nome, candidatos[0]); return; }

  // Mais de um pedido: o admin escolhe (não assume nada).
  state.maletaCtx = { revId, nome, pedidos: {} };
  candidatos.forEach(p => { state.maletaCtx.pedidos[p.id] = p; });
  cont.innerHTML = `<p style="font-size:13px;color:var(--muted);margin-bottom:10px"><strong>${esc(nome)}</strong> tem ${candidatos.length} pedidos no Bling. Escolha qual atualizar:</p>` +
    candidatos.map(p => `<button class="btn-secondary" style="width:100%;text-align:left;margin-bottom:8px" onclick="previewMaletaPorId('${p.id}')">Pedido #${p.numero} — ${formatDate(p.data)} ${p.situacao?.id === SITUACAO_ABERTO ? '<span style="color:var(--success);font-size:11px">• em aberto</span>' : '<span style="color:var(--muted);font-size:11px">• atendido</span>'}</button>`).join('');
}

export function previewMaletaPorId(pedidoId) {
  const p = state.maletaCtx.pedidos[pedidoId];
  if (p) previewMaleta(state.maletaCtx.revId, state.maletaCtx.nome, p);
}

export async function previewMaleta(revId, nome, pedido) {
  const cont = document.getElementById('maleta-content');
  cont.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Comparando com a maleta...</div>';

  const resp = await fetch(`${BLING_ITENS_FN}?id=${pedido.id}`, { headers: BLING_HEADERS });
  if (!resp.ok) { cont.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao buscar os itens do pedido.</p></div>'; return; }
  const json = await resp.json();
  const itensBling = json.data?.itens || json.itens || json.data || [];

  const { data: ativos, error } = await sbQ(sb.from('consignados').select('referencia,quantidade_enviada').eq('revendedora_id', revId).eq('status', 'ativo'));
  if (error) { cont.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao ler a maleta atual.</p></div>'; return; }

  // Soma por SKU na maleta (inclui vendidas, pois quantidade_enviada as conta).
  const appPorRef = {};
  (ativos || []).forEach(c => { const k = (c.referencia || '').trim(); if (k) appPorRef[k] = (appPorRef[k] || 0) + (c.quantidade_enviada || 0); });

  // Agrupa o pedido do Bling por SKU; separa itens sem código.
  const blingPorRef = {}; const semCodigo = [];
  itensBling.forEach(it => {
    const ref = (it.codigo || '').trim();
    if (!ref) { semCodigo.push(it); return; }
    if (!blingPorRef[ref]) blingPorRef[ref] = { referencia: ref, descricao: it.descricao, quantidade: 0, preco: Number(it.valor) || 0 };
    blingPorRef[ref].quantidade += Number(it.quantidade) || 0;
  });

  const novos = [], avisosNeg = [];
  Object.values(blingPorRef).forEach(b => {
    const delta = Math.floor(b.quantidade) - (appPorRef[b.referencia] || 0);
    if (delta > 0) novos.push({ ...b, delta });
    else if (delta < 0) avisosNeg.push({ ...b, app: appPorRef[b.referencia] || 0 });
  });
  const totalNovas = novos.reduce((s, n) => s + n.delta, 0);

  state.maletaCtx.revId = revId;
  state.maletaCtx.pedidoNumero = pedido.numero;
  state.maletaCtx.itensRpc = Object.values(blingPorRef).map(b => ({ referencia: b.referencia, descricao: b.descricao, quantidade: b.quantidade, preco: b.preco }));

  let html = `<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Maleta de <strong>${esc(nome)}</strong> · Pedido #${pedido.numero}</div>`;
  if (!novos.length) {
    html += `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></div><p>Maleta já está atualizada.</p></div>`;
  } else {
    html += `<div style="font-weight:600;color:var(--plum);margin-bottom:8px">${totalNovas} ite${totalNovas!==1?'ns':'m'} novo${totalNovas!==1?'s':''} serão adicionados ao final:</div>`;
    html += novos.map(n => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="color:var(--plum)">${esc(n.descricao)} ${n.referencia ? `<span style="color:var(--muted);font-size:11px">(${esc(n.referencia)})</span>` : ''}</span>
        <span style="color:var(--success);font-weight:600;white-space:nowrap">+${n.delta}</span></div>`).join('');
  }
  if (avisosNeg.length) {
    html += `<div style="margin-top:12px;background:rgba(212,168,75,0.12);border:1px solid var(--gold);border-radius:10px;padding:10px;font-size:12px;color:var(--text)">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> <strong>Conferir manualmente</strong> — no Bling estes SKUs têm MENOS unidades que a maleta (nada é removido):
      ${avisosNeg.map(a => `<div>• ${esc(a.descricao)} — Bling ${Math.floor(a.quantidade)} / maleta ${a.app}</div>`).join('')}</div>`;
  }
  if (semCodigo.length) {
    html += `<div style="margin-top:12px;background:rgba(224,85,85,0.10);border:1px solid var(--danger);border-radius:10px;padding:10px;font-size:12px;color:var(--text)">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> <strong>${semCodigo.length} item(ns) sem código no Bling</strong> — NÃO sincronizados, conferir manualmente:
      ${semCodigo.map(s => `<div>• ${esc(s.descricao || '(sem descrição)')} — qtd ${Number(s.quantidade) || 0}</div>`).join('')}</div>`;
  }
  if (novos.length) {
    html += `<button class="btn-primary" style="width:100%;margin-top:14px" onclick="confirmarMaleta(this)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> Adicionar ${totalNovas} ite${totalNovas!==1?'ns':'m'} à maleta</button>`;
  }
  cont.innerHTML = html;
}

export async function confirmarMaleta(btn) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  btn.disabled = true; btn.textContent = '⟳ Adicionando...';
  const { data, error } = await sbQ(sb.rpc('sincronizar_maleta', {
    p_revendedora_id: state.maletaCtx.revId,
    p_pedido_numero: String(state.maletaCtx.pedidoNumero || ''),
    p_itens: state.maletaCtx.itensRpc || []
  }));
  if (error) {
    console.error('Erro sincronizar_maleta:', error);
    const msg = /sincronizar_maleta|function|schema cache|does not exist/i.test(error.message || '')
      ? 'Função do banco não encontrada — rode db-functions.sql no Supabase.'
      : ('Erro: ' + (error.message || 'tente de novo'));
    toast(msg); btn.disabled = false; btn.textContent = 'Tentar de novo'; return;
  }
  const n = Number(data) || 0;
  toast(n > 0 ? `${n} ite${n!==1?'ns':'m'} adicionado${n!==1?'s':''} à maleta!` : 'Maleta já estava atualizada');
  closeModal('modal-maleta');
  state.allConsignados = [];
  if (document.getElementById('panel-consignados').style.display !== 'none') loadConsignados();
}

export async function salvarBlingId(revId) {
  const val = document.getElementById('rev-bling-id').value.trim();
  let error;
  try {
    ({ error } = await sb.from('profiles').update({ bling_contato_id: val || null }).eq('id', revId));
  } catch (e) { error = e; }
  if (error) {
    console.error('Erro ao salvar ID do Bling:', error.message, error.details, error);
    if (isAuthError(error)) return handleSupabaseError(error);
    toast('Erro: ' + (error.message || 'tente novamente'));
    return;
  }
  toast(val ? 'ID Bling vinculado!' : 'Vínculo Bling removido');
  state.blingRevs = [];
  state.proximaTrocaCarregado = false;
  closeModal('modal-detalhe-rev');
  loadAdmin();
}

export async function detectarBlingId(revId, nomeRev) {
  console.log('[detectarBling] CHAMADO com:', { revId, nomeRev });
  const input = document.getElementById('rev-bling-id');
  console.log('[detectarBling] input encontrado?', !!input);
  const tAlvo = tokensNome(nomeRev);
  console.log('[detectarBling] tokens alvo:', tAlvo);
  if (!tAlvo.length) { toast('Nome da revendedora vazio'); return; }

  toast('Buscando no Bling...');
  const hoje = new Date().toISOString().split('T')[0];
  const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 6);
  const todos = await fetchTodosBling(inicio.toISOString().split('T')[0], hoje);
  if (!todos) { toast('Erro ao conectar com o Bling'); return; }

  const primeiroAlvo = tAlvo[0];
  const setAlvo = new Set(tAlvo);

  // Candidatos com o primeiro nome igual
  const candidatos = todos.filter(p => {
    const t = tokensNome(p.contato?.nome);
    return t.length && t[0] === primeiroAlvo;
  });

  console.log('[detectarBling] alvo:', tAlvo, '| candidatos com 1º nome igual:',
    candidatos.map(p => ({ id: p.contato?.id, nome: p.contato?.nome })));

  // Pontua: primeiro nome (+2), qualquer outro token em comum (+1 cada)
  const scored = candidatos.map(p => {
    const t = tokensNome(p.contato?.nome);
    const overlap = t.filter(x => setAlvo.has(x)).length;
    return { p, score: overlap };
  }).filter(x => x.score >= 1);

  const candidatosBox = document.getElementById('bling-candidatos');
  if (candidatosBox) candidatosBox.innerHTML = '';

  if (!scored.length) {
    toast('Nenhum pedido encontrado com esse nome nos últimos 6 meses (veja console)');
    return;
  }

  // Agrupa por contato.id, mantendo o melhor score e o pedido mais recente
  const porId = {};
  for (const { p, score } of scored) {
    const id = String(p.contato?.id || '');
    if (!id) continue;
    if (!porId[id]) {
      porId[id] = { id, nome: p.contato?.nome || '', score, ultimaData: p.data };
    } else {
      if (score > porId[id].score) porId[id].score = score;
      if (p.data > porId[id].ultimaData) porId[id].ultimaData = p.data;
    }
  }
  const unicos = Object.values(porId).sort((a, b) => b.score - a.score || b.ultimaData.localeCompare(a.ultimaData));

  if (unicos.length === 1) {
    input.value = unicos[0].id;
    toast(`ID encontrado: ${unicos[0].id} — clique em Salvar`);
    return;
  }

  if (!candidatosBox) return;
  const tot = tAlvo.length;
  candidatosBox.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">
      ${unicos.length} contatos com nome parecido — clique no certo:
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto">
      ${unicos.map(c => `
        <button type="button" class="btn-secondary" style="text-align:left;padding:8px 10px;font-size:12px;line-height:1.3;display:flex;justify-content:space-between;align-items:center;gap:8px"
          onclick="escolherBlingCandidato('${c.id}')">
          <div style="min-width:0;flex:1">
            <div style="color:var(--plum);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.nome)}</div>
            <div style="color:var(--muted);font-size:11px">ID ${c.id} · último pedido ${formatDate(c.ultimaData)}</div>
          </div>
          <div style="font-size:10px;color:var(--rose);white-space:nowrap">${c.score}/${tot} nomes</div>
        </button>
      `).join('')}
    </div>
    <button type="button" class="btn-secondary btn-sm" style="margin-top:6px;font-size:11px" onclick="document.getElementById('bling-candidatos').innerHTML=''">Cancelar</button>
  `;
  toast(`Encontrei ${unicos.length} contatos. Clique no certo.`);
}

export function escolherBlingCandidato(id) {
  const input = document.getElementById('rev-bling-id');
  if (input) input.value = id;
  const box = document.getElementById('bling-candidatos');
  if (box) box.innerHTML = '';
  toast(`ID ${id} preenchido — clique em Salvar`);
}
