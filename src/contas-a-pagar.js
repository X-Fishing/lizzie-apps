// Contas a Pagar (financeiro): grid editável inline, estilo planilha.
// Topo = resumo do mês (◀ mês ▶ + Previsto/Pago/Falta); abas por grupo
// (fixa/variavel/pessoas/impostos); chips de status; edição direto na linha;
// menu de contexto (▼) por título; anexo em bucket privado 'documentos'.
// "Atrasado" é derivado (aberto + vencimento < hoje), nunca persistido.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  esc, toast, sbQ, fmtBRL, formatDate,
  confirmarAcao, handleSupabaseError, maskMoneyBR, parseMoneyBR, moneyToInput,
} from './utils.js';
import { ehGestor, ehAdmin } from './auth.js';
import { cadastroCache, cadNovo } from './cadastros.js';

const hojeISO = () => new Date().toISOString().slice(0, 10);

const FORMAS_PGTO = ['PIX', 'Boleto', 'Cartão de crédito', 'Cartão de débito',
  'Dinheiro', 'Transferência', 'Cheque', 'Outro'];

const GRUPOS = [
  { key: 'fixa',     label: 'Despesas fixas' },
  { key: 'variavel', label: 'Despesas variáveis' },
  { key: 'pessoas',  label: 'Pessoas' },
  { key: 'impostos', label: 'Impostos' },
];
const grupoDe = t => t.grupo || 'variavel';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const mesLabel = ym => { const [y, m] = ym.split('-'); return `${MESES[+m - 1].toUpperCase()} ${y}`; };
const mesRange = ym => {
  const [y, m] = ym.split('-').map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { ini: `${ym}-01`, fim: `${ym}-${String(ult).padStart(2, '0')}` };
};
const mesShift = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// dd do mês seguinte, com clamp p/ o último dia (31/01 → 28/02 etc.)
const proximoMesVenc = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(y, m, 1); // m já é o próximo mês (m-1+1)
  const ult = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  const dd = Math.min(d, ult);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

// Status efetivo: aberto vencido vira "atrasado" só na exibição.
const statusEfetivo = t =>
  t.status === 'aberto' && t.vencimento && t.vencimento < hojeISO() ? 'atrasado' : t.status;

const fornecedoresAtivos = () => (cadastroCache.fornecedores || []).filter(f => f.ativo !== false);
const categoriasAtivas   = () => (cadastroCache.categorias_financeiras || [])
  .filter(c => c.ativo !== false && (c.tipo || 'despesa') === 'despesa');

let capTitulos = [];
let capMes = hojeISO().slice(0, 7);          // 'YYYY-MM'
let capAba = 'variavel';
let capFiltros = { busca: '', status: '' };
const capDetAbertos = new Set();             // ids com detalhe expandido
let capNovaAberta = false;
let capQuickAdd = null;                       // contexto do "+ Novo..." nos selects
let capMenuId = null;

// ═══════════════════════════════════════════════════════════════════
// Ícones
// ═══════════════════════════════════════════════════════════════════
const IC_PREV  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const IC_NEXT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const IC_CHEV  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const IC_CARET = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const IC_CLIP  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
const IC_X     = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const IC_COPY  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const IC_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_MOVE  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICONE_CARTEIRA = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';

// ═══════════════════════════════════════════════════════════════════
// Carga (escopo do MÊS exibido)
// ═══════════════════════════════════════════════════════════════════
export async function loadContasAPagar() {
  const panel = document.getElementById('panel-contas-a-pagar');
  panel.innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';

  const { ini, fim } = mesRange(capMes);
  const { data, error } = await sbQ(sb.from('contas_a_pagar')
    .select('*').gte('vencimento', ini).lte('vencimento', fim)
    .order('vencimento', { ascending: true }).limit(500));
  if (error) {
    const dica = /relation|column|schema cache/i.test(error.message || '') ? ' Rode as migrações 0024 e 0026 no Supabase.' : '';
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICONE_CARTEIRA}</div><p>Erro ao carregar Contas a Pagar.${dica}</p></div>`;
    return;
  }
  capTitulos = data || [];

  if (!fornecedoresAtivos().length || !(cadastroCache.categorias_financeiras || []).length) {
    const [f, cf] = await Promise.all([
      sbQ(sb.from('fornecedores').select('id,nome,ativo').order('nome')),
      sbQ(sb.from('categorias_financeiras').select('id,nome,tipo,ativo').order('nome')),
    ]);
    if (f.data) cadastroCache.fornecedores = f.data;
    if (cf.data) cadastroCache.categorias_financeiras = cf.data;
  }
  render();
}

// ═══════════════════════════════════════════════════════════════════
// Render base
// ═══════════════════════════════════════════════════════════════════
function render() {
  const panel = document.getElementById('panel-contas-a-pagar');
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-eyebrow" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)">Financeiro</div>
        <div class="section-title">Contas a Pagar</div>
        <div class="section-subtitle">Títulos de despesa — edite direto na tabela</div>
      </div>
    </div>
    <div class="cap-topo">
      <div class="cap-mes-nav">
        <button class="btn-icon" onclick="capMudarMes(-1)" title="Mês anterior">${IC_PREV}</button>
        <span id="cap-mes-label">${mesLabel(capMes)}</span>
        <button class="btn-icon" onclick="capMudarMes(1)" title="Próximo mês">${IC_NEXT}</button>
      </div>
      <div id="cap-resumo" class="cap-resumo"></div>
    </div>
    <div id="cap-abas" class="chips" style="margin-bottom:12px"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <input type="text" class="form-control" style="max-width:260px" placeholder="Buscar por fornecedor, descrição, boleto..."
        value="${esc(capFiltros.busca)}" oninput="capBuscar(this.value)">
      <div id="cap-chips" class="chips"></div>
    </div>
    <div id="cap-grid"></div>
    <input type="file" id="cap-anexo-file" accept="application/pdf,image/*" style="display:none" onchange="capAnexoUpload(this)">`;
  capRenderResumo();
  capRenderAbas();
  capRenderChips();
  capRenderGrid();
}

function capRenderResumo() {
  const el = document.getElementById('cap-resumo');
  const lbl = document.getElementById('cap-mes-label');
  if (lbl) lbl.textContent = mesLabel(capMes);
  if (!el) return;
  let previsto = 0, pago = 0, falta = 0;
  capTitulos.forEach(t => {
    if (t.status === 'cancelado') return;
    const v = Number(t.valor || 0);
    previsto += v;
    if (t.status === 'pago') pago += v; else falta += v;
  });
  el.innerHTML = `
    <div class="cap-resumo-item"><span>Previsto</span><b>${fmtBRL(previsto)}</b></div>
    <div class="cap-resumo-item"><span>Pago</span><b style="color:var(--success)">${fmtBRL(pago)}</b></div>
    <div class="cap-resumo-item"><span>Falta</span><b style="color:var(--danger)">${fmtBRL(falta)}</b></div>`;
}

function capRenderAbas() {
  const el = document.getElementById('cap-abas');
  if (!el) return;
  const cont = k => capTitulos.filter(t => grupoDe(t) === k).length;
  el.innerHTML = GRUPOS.map(g =>
    `<button class="chip${capAba === g.key ? ' active' : ''}" onclick="capTrocarAba('${g.key}')">${g.label} <span style="opacity:.6">${cont(g.key)}</span></button>`).join('');
}

function capRenderChips() {
  const el = document.getElementById('cap-chips');
  if (!el) return;
  const naAba = capTitulos.filter(t => grupoDe(t) === capAba);
  const cont = st => st === '' ? naAba.length : naAba.filter(t => statusEfetivo(t) === st).length;
  const chip = (st, label) => `<button class="chip${capFiltros.status === st ? ' active' : ''}" onclick="capChipStatus('${st}')">${label} <span style="opacity:.6">${cont(st)}</span></button>`;
  el.innerHTML = chip('', 'Todas') + chip('aberto', 'Em aberto') + chip('atrasado', 'Atrasadas') + chip('pago', 'Pagas') + chip('cancelado', 'Canceladas');
}

function capGridLista() {
  const q = capFiltros.busca.trim().toLowerCase();
  return capTitulos.filter(t => {
    if (grupoDe(t) !== capAba) return false;
    if (capFiltros.status && statusEfetivo(t) !== capFiltros.status) return false;
    if (q) {
      const hay = `${t.fornecedor_nome || ''} ${t.descricao || ''} ${t.boleto_codigo || ''} ${t.observacao || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── selects (options montadas por linha; lista é mensal, então é curta) ──
const optsForn = sel => `<option value="">—</option>` +
  fornecedoresAtivos().map(f => `<option value="${f.id}" ${String(f.id) === String(sel || '') ? 'selected' : ''}>${esc(f.nome)}</option>`).join('') +
  `<option value="__novo__">+ Novo fornecedor...</option>`;
const optsCat = sel => `<option value="">—</option>` +
  categoriasAtivas().map(c => `<option value="${c.id}" ${String(c.id) === String(sel || '') ? 'selected' : ''}>${esc(c.nome)}</option>`).join('') +
  `<option value="__novo__">+ Nova categoria...</option>`;
const optsForma = sel => `<option value="">—</option>` +
  FORMAS_PGTO.map(f => `<option value="${f}" ${f === (sel || '') ? 'selected' : ''}>${f}</option>`).join('');

function capRenderGrid() {
  const el = document.getElementById('cap-grid');
  if (!el) return;
  const lista = capGridLista();
  const abaLabel = GRUPOS.find(g => g.key === capAba)?.label || '';
  const novaRow = (ehGestor() && !capNovaAberta)
    ? `<tr class="cap-add-row" onclick="capNovaAbrir()"><td class="ciclo-td" colspan="10">+ Adicionar título em "${abaLabel}"</td></tr>` : '';
  const novaEdit = (ehGestor() && capNovaAberta) ? capNovaRowHtml() : '';

  let corpo;
  if (!lista.length && !capNovaAberta) {
    const msg = (capFiltros.busca || capFiltros.status) ? 'Nenhum título com esse filtro.' : 'Nenhum título neste mês/grupo.';
    corpo = `<tr><td colspan="10"><div class="empty-state" style="padding:28px 0"><div class="empty-icon">${ICONE_CARTEIRA}</div><p>${msg}</p></div></td></tr>`;
  } else {
    corpo = lista.map(t => capLinhaHtml(t) + (capDetAbertos.has(String(t.id)) ? capDetalheHtml(t) : '')).join('');
  }

  el.innerHTML = `<div class="pag-wrap"><table class="pag-table cap-grid-table"><thead><tr>
    <th class="pag-th" style="width:26px"></th><th class="pag-th">Pago?</th><th class="pag-th">Vencimento</th>
    <th class="pag-th">Descrição</th><th class="pag-th">Fornecedor</th><th class="pag-th">Categoria</th>
    <th class="pag-th">Forma</th><th class="pag-th" style="text-align:right">Valor</th>
    <th class="pag-th">Anexo</th><th class="pag-th"></th>
  </tr></thead><tbody>${novaEdit}${novaRow}${corpo}</tbody></table></div>`;
}

function capLinhaHtml(t) {
  const ef = statusEfetivo(t);
  const cancel = t.status === 'cancelado';
  const dis = (!ehGestor() || cancel) ? 'disabled' : '';
  const temDet = t.observacao || t.boleto_codigo || t.boleto_url;
  const aberto = capDetAbertos.has(String(t.id));
  const pagoCel = cancel
    ? `<span class="badge badge-entregue">Cancelado</span>`
    : `<label class="cap-switch"><input type="checkbox" ${t.status === 'pago' ? 'checked' : ''} ${!ehGestor() ? 'disabled' : ''} onchange="capTogglePago('${t.id}',this.checked)"><span></span></label>`;
  return `<tr class="cap-row${cancel ? ' cap-cancelada' : ''}" data-id="${t.id}">
    <td class="ciclo-td" style="width:26px"><button class="cap-chevron${aberto ? ' aberto' : ''}" onclick="capToggleDetalhe('${t.id}')" title="Detalhes">${IC_CHEV}</button></td>
    <td class="ciclo-td" style="text-align:center">${pagoCel}</td>
    <td class="ciclo-td"><input type="date" class="cap-inp${ef === 'atrasado' ? ' cap-atrasada' : ''}" value="${esc(t.vencimento || '')}" ${dis} onchange="capCampoChange('${t.id}','vencimento',this)"></td>
    <td class="ciclo-td"><input type="text" class="cap-inp" style="min-width:130px" value="${esc(t.descricao || '')}" ${dis} onchange="capCampoChange('${t.id}','descricao',this)">${temDet ? '<span class="cap-dot" title="tem observação/boleto"></span>' : ''}</td>
    <td class="ciclo-td"><select class="cap-inp" data-cap-sel="fornecedores" ${dis} onchange="capCampoChange('${t.id}','fornecedor_id',this)">${optsForn(t.fornecedor_id)}</select></td>
    <td class="ciclo-td"><select class="cap-inp" data-cap-sel="categorias_financeiras" ${dis} onchange="capCampoChange('${t.id}','categoria_id',this)">${optsCat(t.categoria_id)}</select></td>
    <td class="ciclo-td"><select class="cap-inp" ${dis} onchange="capCampoChange('${t.id}','forma_pagamento',this)">${optsForma(t.forma_pagamento)}</select></td>
    <td class="ciclo-td" style="text-align:right"><input type="text" class="cap-inp cap-valor" inputmode="numeric" value="${t.valor ? moneyToInput(t.valor) : ''}" ${dis} oninput="maskMoneyBR(this)" onchange="capCampoChange('${t.id}','valor',this)"></td>
    <td class="ciclo-td" style="white-space:nowrap">${capAnexoCel(t)}</td>
    <td class="ciclo-td" style="text-align:right">${ehGestor() ? `<button class="btn-icon" data-cap-menu-btn onclick="capMenuAbrir('${t.id}',this)" title="Ações">${IC_CARET}</button>` : '—'}</td>
  </tr>`;
}

function capDetalheHtml(t) {
  const dis = (!ehGestor() || t.status === 'cancelado') ? 'disabled' : '';
  return `<tr class="cap-det" data-det="${t.id}"><td class="ciclo-td" colspan="10"><div class="cap-det-grid">
    <div><label class="form-label">Observação</label>
      <textarea class="form-control" rows="2" ${dis} onchange="capCampoChange('${t.id}','observacao',this)">${esc(t.observacao || '')}</textarea></div>
    <div><label class="form-label">Código do boleto</label>
      <div style="display:flex;gap:6px"><input type="text" class="form-control" value="${esc(t.boleto_codigo || '')}" ${dis} onchange="capCampoChange('${t.id}','boleto_codigo',this)">${t.boleto_codigo ? `<button class="btn-secondary btn-sm" onclick="capCopiarBoleto('${esc(t.boleto_codigo)}')">Copiar</button>` : ''}</div></div>
    <div><label class="form-label">Link do boleto</label>
      <div style="display:flex;gap:6px"><input type="url" class="form-control" value="${esc(t.boleto_url || '')}" ${dis} onchange="capCampoChange('${t.id}','boleto_url',this)">${t.boleto_url ? `<a class="btn-secondary btn-sm" href="${esc(t.boleto_url)}" target="_blank" rel="noopener">Abrir</a>` : ''}</div></div>
    ${t.status === 'pago' ? `<div><label class="form-label">Data do pagamento</label>
      <input type="date" class="form-control" value="${esc(t.data_pagamento || '')}" ${dis} onchange="capCampoChange('${t.id}','data_pagamento',this)"></div>` : ''}
    <div style="font-size:11px;color:var(--muted);align-self:end">Origem: ${esc(t.origem || 'manual')} · criado ${formatDate((t.created_at || '').slice(0, 10))}</div>
  </div></td></tr>`;
}

function capAnexoCel(t) {
  if (t.anexo_path) {
    const nome = t.anexo_nome || 'anexo';
    const curto = nome.length > 14 ? nome.slice(0, 12) + '…' : nome;
    return `<button class="btn-link" onclick="capAnexoAbrir('${t.id}')" title="${esc(nome)}">${IC_CLIP} ${esc(curto)}</button>${ehGestor() ? ` <button class="btn-icon" style="color:var(--danger)" onclick="capAnexoRemover('${t.id}')" title="Remover anexo">${IC_X}</button>` : ''}`;
  }
  return ehGestor() ? `<button class="btn-icon" onclick="capAnexoEscolher('${t.id}')" title="Anexar boleto/comprovante">${IC_CLIP}</button>` : '—';
}

function capNovaRowHtml() {
  const vencDefault = capMes === hojeISO().slice(0, 7) ? hojeISO() : `${capMes}-01`;
  return `<tr class="cap-nova">
    <td class="ciclo-td"></td><td class="ciclo-td"></td>
    <td class="ciclo-td"><input type="date" id="cap-novo-venc" class="cap-inp" value="${vencDefault}"></td>
    <td class="ciclo-td"><input type="text" id="cap-novo-desc" class="cap-inp" placeholder="Descrição"></td>
    <td class="ciclo-td"><select id="cap-novo-forn" class="cap-inp" data-cap-sel="fornecedores" onchange="capCampoChange('novo','fornecedor_id',this)">${optsForn('')}</select></td>
    <td class="ciclo-td"><select id="cap-novo-cat" class="cap-inp" data-cap-sel="categorias_financeiras" onchange="capCampoChange('novo','categoria_id',this)">${optsCat('')}</select></td>
    <td class="ciclo-td"><select id="cap-novo-forma" class="cap-inp">${optsForma('')}</select></td>
    <td class="ciclo-td" style="text-align:right"><input type="text" id="cap-novo-valor" class="cap-inp cap-valor" inputmode="numeric" oninput="maskMoneyBR(this)" placeholder="0,00"></td>
    <td class="ciclo-td"></td>
    <td class="ciclo-td" style="text-align:right;white-space:nowrap"><button class="btn-primary btn-sm" id="cap-novo-salvar" onclick="capNovaSalvar()">Salvar</button> <button class="btn-secondary btn-sm" onclick="capNovaCancelar()">×</button></td>
  </tr>`;
}

// Atualiza SÓ um <tr> (+ detalhe) sem re-render da grid inteira.
function capAtualizarLinha(id) {
  const tr = document.querySelector(`tr.cap-row[data-id="${id}"]`);
  if (!tr) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  const det = tr.nextElementSibling;
  if (det && det.classList.contains('cap-det')) det.remove();
  tr.outerHTML = capLinhaHtml(t) + (capDetAbertos.has(String(id)) ? capDetalheHtml(t) : '');
}

// ═══════════════════════════════════════════════════════════════════
// Navegação / filtros
// ═══════════════════════════════════════════════════════════════════
export function capMudarMes(delta) { capMes = mesShift(capMes, delta); capNovaAberta = false; capDetAbertos.clear(); loadContasAPagar(); }
export function capTrocarAba(grupo) { capAba = grupo; capFiltros.status = ''; capNovaAberta = false; capRenderAbas(); capRenderChips(); capRenderGrid(); }
export function capChipStatus(st) { capFiltros.status = capFiltros.status === st ? '' : st; capRenderChips(); capRenderGrid(); }
export function capBuscar(v) { capFiltros.busca = v; capRenderGrid(); }

// ═══════════════════════════════════════════════════════════════════
// Autosave por campo
// ═══════════════════════════════════════════════════════════════════
export async function capCampoChange(id, campo, el) {
  if (!ehGestor()) return;

  // sentinela do quick-add ("+ Novo fornecedor/categoria...")
  if ((campo === 'fornecedor_id' || campo === 'categoria_id') && el.value === '__novo__') {
    const tabela = campo === 'fornecedor_id' ? 'fornecedores' : 'categorias_financeiras';
    const t0 = capTitulos.find(x => String(x.id) === String(id));
    capQuickAdd = { tabela, campo, alvoId: String(id), anterior: String((t0 && t0[campo]) || ''), idsAntes: new Set((cadastroCache[tabela] || []).map(x => String(x.id))) };
    el.value = capQuickAdd.anterior;
    cadNovo(tabela);
    return;
  }

  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return; // linha nova (id 'novo'): valor fica no select, lido no capNovaSalvar

  const patch = {};
  if (campo === 'valor') {
    const v = parseMoneyBR(el.value);
    if (!(v > 0)) { toast('Valor inválido.'); el.value = t.valor ? moneyToInput(t.valor) : ''; return; }
    patch.valor = v;
  } else if (campo === 'vencimento') {
    if (!el.value) { toast('Informe o vencimento.'); el.value = t.vencimento || ''; return; }
    patch.vencimento = el.value;
  } else if (campo === 'descricao') {
    const d = el.value.trim();
    if (!d) { toast('A descrição não pode ficar vazia.'); el.value = t.descricao || ''; return; }
    patch.descricao = d;
  } else if (campo === 'fornecedor_id') {
    patch.fornecedor_id = el.value || null;
    patch.fornecedor_nome = fornecedoresAtivos().find(f => String(f.id) === el.value)?.nome || null;
  } else if (campo === 'categoria_id') {
    patch.categoria_id = el.value || null;
    patch.categoria_nome = categoriasAtivas().find(c => String(c.id) === el.value)?.nome || null;
  } else if (campo === 'forma_pagamento') {
    patch.forma_pagamento = el.value || null;
  } else if (campo === 'observacao') {
    patch.observacao = el.value.trim() || null;
  } else if (campo === 'boleto_codigo') {
    patch.boleto_codigo = el.value.trim() || null;
  } else if (campo === 'boleto_url') {
    patch.boleto_url = el.value.trim() || null;
  } else if (campo === 'data_pagamento') {
    patch.data_pagamento = el.value || null;
  } else { return; }

  const { error } = await sbQ(sb.from('contas_a_pagar').update(patch).eq('id', id));
  if (error) { await handleSupabaseError(error, 'Erro ao salvar'); capReverterCampo(t, campo, el); return; }
  Object.assign(t, patch);

  const cell = el.closest('td');
  if (cell) { cell.classList.remove('cap-flash'); void cell.offsetWidth; cell.classList.add('cap-flash'); }
  capRenderResumo();
  capRenderChips();

  if (campo === 'vencimento') {
    if (el.value.slice(0, 7) !== capMes) { toast('Movido para outro mês.'); capRenderGrid(); return; }
    el.classList.toggle('cap-atrasada', statusEfetivo(t) === 'atrasado');
  }
}

function capReverterCampo(t, campo, el) {
  el.value = campo === 'valor' ? (t.valor ? moneyToInput(t.valor) : '') : (t[campo] || '');
}

export async function capTogglePago(id, checked) {
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  const patch = checked ? { status: 'pago', data_pagamento: hojeISO() } : { status: 'aberto', data_pagamento: null };
  const { error } = await sbQ(sb.from('contas_a_pagar').update(patch).eq('id', id));
  if (error) {
    await handleSupabaseError(error, 'Erro ao atualizar');
    const chk = document.querySelector(`tr.cap-row[data-id="${id}"] .cap-switch input`);
    if (chk) chk.checked = !checked;
    return;
  }
  Object.assign(t, patch);
  capRenderResumo();
  capRenderChips();
  if (capFiltros.status) capRenderGrid(); else capAtualizarLinha(id);
}

export function capToggleDetalhe(id) {
  const k = String(id);
  if (capDetAbertos.has(k)) capDetAbertos.delete(k); else capDetAbertos.add(k);
  capAtualizarLinha(id);
}

// ═══════════════════════════════════════════════════════════════════
// Linha nova
// ═══════════════════════════════════════════════════════════════════
export function capNovaAbrir() {
  if (!ehGestor()) return;
  capNovaAberta = true;
  capRenderGrid();
  document.getElementById('cap-novo-desc')?.focus();
}
export function capNovaCancelar() { capNovaAberta = false; capRenderGrid(); }
export async function capNovaSalvar() {
  if (!ehGestor()) return;
  const fornId = document.getElementById('cap-novo-forn').value;
  const descricao = document.getElementById('cap-novo-desc').value.trim();
  const valor = parseMoneyBR(document.getElementById('cap-novo-valor').value);
  const vencimento = document.getElementById('cap-novo-venc').value;
  const catId = document.getElementById('cap-novo-cat').value;
  const forma = document.getElementById('cap-novo-forma').value;
  if (!fornId || fornId === '__novo__') { toast('Selecione o fornecedor.'); return; }
  if (!descricao) { toast('Informe a descrição.'); return; }
  if (!(valor > 0)) { toast('Informe um valor maior que zero.'); return; }
  if (!vencimento) { toast('Informe o vencimento.'); return; }

  const forn = fornecedoresAtivos().find(f => String(f.id) === String(fornId));
  const cat = categoriasAtivas().find(c => String(c.id) === String(catId));
  const payload = {
    status: 'aberto', grupo: capAba,
    fornecedor_id: fornId, fornecedor_nome: forn?.nome || null,
    descricao, valor, vencimento,
    categoria_id: catId && catId !== '__novo__' ? catId : null, categoria_nome: cat?.nome || null,
    forma_pagamento: forma || null,
    created_by: state.currentUser?.id || null,
  };
  const btn = document.getElementById('cap-novo-salvar');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const { error } = await sbQ(sb.from('contas_a_pagar').insert(payload));
  if (error) { if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; } await handleSupabaseError(error, 'Erro ao criar o título'); return; }
  toast('Título criado!');
  capNovaAberta = false;
  loadContasAPagar();
}

// ═══════════════════════════════════════════════════════════════════
// Menu de contexto (▼)
// ═══════════════════════════════════════════════════════════════════
function capMenuEl() {
  let m = document.getElementById('cap-menu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'cap-menu'; m.className = 'cap-menu'; m.style.display = 'none';
    document.body.appendChild(m);
    document.addEventListener('pointerdown', e => {
      if (m.style.display !== 'none' && !m.contains(e.target) && !e.target.closest('[data-cap-menu-btn]')) capMenuFechar();
    }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && m.style.display !== 'none') { e.stopPropagation(); capMenuFechar(); }
    }, true);
    window.addEventListener('scroll', () => { if (m.style.display !== 'none') capMenuFechar(); }, true);
    window.addEventListener('resize', () => { if (m.style.display !== 'none') capMenuFechar(); });
  }
  return m;
}
function capMenuFechar() { const m = document.getElementById('cap-menu'); if (m) m.style.display = 'none'; capMenuId = null; }

export function capMenuAbrir(id, btn) {
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  capMenuId = String(id);
  const ef = statusEfetivo(t);
  const m = capMenuEl();

  const marcar = [];
  if (ef === 'aberto' || ef === 'atrasado') { marcar.push(['Pago', `capMarcarStatus('${id}','pago')`], ['Cancelado', `capMarcarStatus('${id}','cancelado')`]); }
  if (t.status === 'pago' || t.status === 'cancelado') marcar.push(['Em aberto', `capMarcarStatus('${id}','aberto')`]);
  const mover = GRUPOS.filter(g => g.key !== grupoDe(t)).map(g => [g.label, `capMoverGrupo('${id}','${g.key}')`]);
  const sub = itens => itens.map(([lab, act]) => `<button class="cap-menu-sub-item" onclick="${act}">${lab}</button>`).join('');

  m.innerHTML = `
    <button class="cap-menu-item" onclick="capMenuSub(0)">${IC_COPY} Duplicar<span class="cap-menu-arrow">›</span></button>
    <div class="cap-submenu" data-sub="0">${sub([['No mês atual', `capDuplicar('${id}','atual')`], ['No próximo mês', `capDuplicar('${id}','proximo')`]])}</div>
    <button class="cap-menu-item" onclick="capMenuSub(1)">${IC_CHECK} Marcar como<span class="cap-menu-arrow">›</span></button>
    <div class="cap-submenu" data-sub="1">${sub(marcar)}</div>
    <button class="cap-menu-item" onclick="capMenuSub(2)">${IC_MOVE} Mover para<span class="cap-menu-arrow">›</span></button>
    <div class="cap-submenu" data-sub="2">${sub(mover)}</div>
    ${ehAdmin() ? `<button class="cap-menu-item" style="color:var(--danger)" onclick="capExcluirTitulo('${id}')">${IC_TRASH} Excluir</button>` : ''}`;

  m.style.display = 'block';
  const r = btn.getBoundingClientRect();
  const mw = 210;
  let left = r.right - mw; if (left < 8) left = 8;
  m.style.left = left + 'px';
  m.style.top = (r.bottom + 4) + 'px';
  const mh = m.offsetHeight;
  if (r.bottom + 4 + mh > window.innerHeight - 8) m.style.top = Math.max(8, r.top - mh - 4) + 'px';
}

export function capMenuSub(n) {
  const m = document.getElementById('cap-menu');
  if (!m) return;
  m.querySelectorAll('.cap-submenu').forEach(s => {
    if (s.dataset.sub === String(n)) s.classList.toggle('aberto'); else s.classList.remove('aberto');
  });
}

export async function capDuplicar(id, quando) {
  capMenuFechar();
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  const venc = quando === 'proximo' ? proximoMesVenc(t.vencimento) : t.vencimento;
  const payload = {
    status: 'aberto', grupo: grupoDe(t),
    fornecedor_id: t.fornecedor_id, fornecedor_nome: t.fornecedor_nome,
    descricao: t.descricao, valor: t.valor, vencimento: venc,
    categoria_id: t.categoria_id, categoria_nome: t.categoria_nome,
    forma_pagamento: t.forma_pagamento, observacao: t.observacao,
    boleto_codigo: t.boleto_codigo, boleto_url: t.boleto_url,
    created_by: state.currentUser?.id || null,
  };
  const { error } = await sbQ(sb.from('contas_a_pagar').insert(payload));
  if (await handleSupabaseError(error, 'Erro ao duplicar')) return;
  toast(quando === 'proximo' ? 'Duplicado para o próximo mês.' : 'Título duplicado.');
  loadContasAPagar();
}

export async function capMarcarStatus(id, status) {
  capMenuFechar();
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  const patch = status === 'pago' ? { status: 'pago', data_pagamento: hojeISO() }
    : status === 'cancelado' ? { status: 'cancelado' }
      : { status: 'aberto', data_pagamento: null };
  const { error } = await sbQ(sb.from('contas_a_pagar').update(patch).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao atualizar')) return;
  Object.assign(t, patch);
  capRenderResumo();
  capRenderChips();
  if (capFiltros.status) capRenderGrid(); else capAtualizarLinha(id);
}

export async function capMoverGrupo(id, grupo) {
  capMenuFechar();
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  const { error } = await sbQ(sb.from('contas_a_pagar').update({ grupo }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao mover')) return;
  t.grupo = grupo;
  toast('Movido para ' + (GRUPOS.find(g => g.key === grupo)?.label || grupo));
  capRenderAbas();
  capRenderChips();
  capRenderGrid(); // sai da aba atual
}

export function capExcluirTitulo(id) {
  capMenuFechar();
  if (!ehAdmin()) { toast('Apenas admin pode excluir.'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  confirmarAcao('Excluir título', `Excluir definitivamente "${t.descricao}" (${fmtBRL(t.valor)})? Esta ação não pode ser desfeita.`, 'Excluir', async () => {
    if (t.anexo_path) { try { await sb.storage.from('documentos').remove([t.anexo_path]); } catch { /* best-effort */ } }
    const { error } = await sbQ(sb.from('contas_a_pagar').delete().eq('id', id));
    if (await handleSupabaseError(error, 'Erro ao excluir')) return;
    toast('Título excluído.');
    loadContasAPagar();
  });
}

export function capCopiarBoleto(codigo) {
  navigator.clipboard.writeText(codigo)
    .then(() => toast('Código copiado!'))
    .catch(() => toast('Não foi possível copiar.'));
}

// ═══════════════════════════════════════════════════════════════════
// Quick-add fornecedor/categoria (via evento 'cadastro-salvo')
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('cadastro-salvo', e => {
  const tabela = e.detail?.tabela;
  if (tabela !== 'fornecedores' && tabela !== 'categorias_financeiras') return;
  if (!document.getElementById('cap-grid')) return; // tela não está aberta
  capRepopularSelects(tabela);
});

function capRepopularSelects(tabela) {
  const build = tabela === 'fornecedores' ? optsForn : optsCat;
  let novoId = null;
  if (capQuickAdd && capQuickAdd.tabela === tabela) {
    novoId = (cadastroCache[tabela] || []).map(x => String(x.id)).find(idv => !capQuickAdd.idsAntes.has(idv)) || null;
  }
  document.querySelectorAll(`#cap-grid select[data-cap-sel="${tabela}"]`).forEach(sel => {
    const atual = sel.value === '__novo__' ? '' : sel.value;
    sel.innerHTML = build(atual);
  });
  if (capQuickAdd && capQuickAdd.tabela === tabela && novoId) {
    if (capQuickAdd.alvoId === 'novo') {
      const sel = document.getElementById(tabela === 'fornecedores' ? 'cap-novo-forn' : 'cap-novo-cat');
      if (sel) sel.innerHTML = build(novoId);
    } else {
      const sel = document.querySelector(`tr.cap-row[data-id="${capQuickAdd.alvoId}"] select[data-cap-sel="${tabela}"]`);
      if (sel) { sel.innerHTML = build(novoId); sel.value = novoId; capCampoChange(capQuickAdd.alvoId, capQuickAdd.campo, sel); }
    }
  }
  capQuickAdd = null;
}

// ═══════════════════════════════════════════════════════════════════
// Anexo (bucket privado 'documentos')
// ═══════════════════════════════════════════════════════════════════
const sanitizarNome = nome => (nome || 'arquivo').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);

export function capAnexoEscolher(id) {
  if (!ehGestor()) return;
  const inp = document.getElementById('cap-anexo-file');
  if (!inp) return;
  inp.dataset.id = String(id); inp.value = ''; inp.click();
}

export async function capAnexoUpload(inp) {
  const id = inp.dataset.id;
  const file = inp.files && inp.files[0];
  if (!id || !file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Arquivo muito grande (máx. 10 MB).'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  toast('Enviando anexo...');
  const path = `contas-a-pagar/${Date.now()}_${sanitizarNome(file.name)}`;
  const { error: upErr } = await sb.storage.from('documentos').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) { await handleSupabaseError(upErr, 'Erro ao enviar o anexo'); return; }
  const anterior = t.anexo_path;
  const { error } = await sbQ(sb.from('contas_a_pagar').update({ anexo_path: path, anexo_nome: file.name }).eq('id', id));
  if (error) { await handleSupabaseError(error, 'Erro ao salvar o anexo'); try { await sb.storage.from('documentos').remove([path]); } catch { /* best-effort */ } return; }
  if (anterior) { try { await sb.storage.from('documentos').remove([anterior]); } catch { /* best-effort */ } }
  t.anexo_path = path; t.anexo_nome = file.name;
  toast('Anexo salvo.');
  capAtualizarLinha(id);
}

export async function capAnexoAbrir(id) {
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t || !t.anexo_path) return;
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(t.anexo_path, 3600);
  if (error || !data?.signedUrl) { toast('Não foi possível abrir o anexo.'); return; }
  window.open(data.signedUrl, '_blank');
}

export function capAnexoRemover(id) {
  if (!ehGestor()) return;
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  confirmarAcao('Remover anexo', `Remover o anexo "${t.anexo_nome || ''}"?`, 'Remover', async () => {
    const { error } = await sbQ(sb.from('contas_a_pagar').update({ anexo_path: null, anexo_nome: null }).eq('id', id));
    if (await handleSupabaseError(error, 'Erro ao remover')) return;
    if (t.anexo_path) { try { await sb.storage.from('documentos').remove([t.anexo_path]); } catch { /* best-effort */ } }
    t.anexo_path = null; t.anexo_nome = null;
    toast('Anexo removido.');
    capAtualizarLinha(id);
  });
}
