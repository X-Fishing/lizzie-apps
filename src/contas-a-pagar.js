// Contas a Pagar (financeiro): títulos de despesa com KPIs, filtros e boleto.
// "Atrasado" é derivado (aberto + vencimento < hoje), nunca persistido.
// Campos origem/entrada_id ficam prontos p/ a Entrada de Mercadoria (futuro).
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  esc, toast, sbQ, fmtBRL, formatDate, openModal, closeModal,
  confirmarAcao, handleSupabaseError, maskMoneyBR, parseMoneyBR, moneyToInput,
} from './utils.js';
import { ehGestor, ehAdmin } from './auth.js';
import { cadastroCache } from './cadastros.js';

const hojeISO = () => new Date().toISOString().slice(0, 10);

const FORMAS_PGTO = ['PIX', 'Boleto', 'Cartão de crédito', 'Cartão de débito',
  'Dinheiro', 'Transferência', 'Cheque', 'Outro'];

const STATUS_BADGE = {
  aberto:    { cls: 'badge-aberta',   label: 'Em aberto' },
  atrasado:  { cls: 'badge-pendente', label: 'Atrasada' },
  pago:      { cls: 'badge-ativo',    label: 'Pago' },
  cancelado: { cls: 'badge-entregue', label: 'Cancelado' },
};

let capTitulos = [];
let capFiltros = { busca: '', fornecedor_id: '', categoria_id: '', dataInicio: '', dataFim: '', status: '' };

// Status efetivo: aberto vencido vira "atrasado" só na exibição.
const statusEfetivo = t =>
  t.status === 'aberto' && t.vencimento && t.vencimento < hojeISO() ? 'atrasado' : t.status;

const fornecedoresAtivos = () => (cadastroCache.fornecedores || []).filter(f => f.ativo !== false);
const categoriasAtivas   = () => (cadastroCache.categorias_financeiras || [])
  .filter(c => c.ativo !== false && (c.tipo || 'despesa') === 'despesa');

// ═══════════════════════════════════════════════════════════════════
// Carga
// ═══════════════════════════════════════════════════════════════════
export async function loadContasAPagar() {
  const panel = document.getElementById('panel-contas-a-pagar');
  panel.innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';

  const { data, error } = await sbQ(sb.from('contas_a_pagar')
    .select('*').order('vencimento', { ascending: true }).limit(500));
  if (error) {
    const dica = /relation|schema cache/i.test(error.message || '') ? ' Rode a migração 0024 no Supabase.' : '';
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICONE_CARTEIRA}</div><p>Erro ao carregar Contas a Pagar.${dica}</p></div>`;
    return;
  }
  capTitulos = data || [];

  // Fornecedores + categorias financeiras p/ selects (uma vez, se vazios).
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
// Render
// ═══════════════════════════════════════════════════════════════════
function render() {
  const panel = document.getElementById('panel-contas-a-pagar');
  panel.innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <div class="section-eyebrow" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)">Financeiro</div>
        <div class="section-title">Contas a Pagar</div>
        <div class="section-subtitle">Títulos manuais e gerados pela Entrada de Mercadoria</div>
      </div>
      ${ehGestor() ? `<button class="btn btn-primary" onclick="capNovoTitulo()">+ Novo Título</button>` : ''}
    </div>
    <div id="cap-kpis" class="dash-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
      <input type="text" class="form-control" style="max-width:240px" placeholder="Fornecedor, descrição, cód. boleto..."
        value="${esc(capFiltros.busca)}" oninput="capBuscar(this.value)">
      <select class="form-control" style="max-width:220px" onchange="capFiltrarFornecedor(this.value)">
        <option value="">Todos os fornecedores</option>
        ${fornecedoresAtivos().map(f => `<option value="${f.id}" ${String(f.id) === capFiltros.fornecedor_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}
      </select>
      <select class="form-control" style="max-width:200px" onchange="capFiltrarCategoria(this.value)">
        <option value="">Todas as categorias</option>
        ${categoriasAtivas().map(c => `<option value="${c.id}" ${String(c.id) === capFiltros.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>
      <input type="date" class="form-control" style="max-width:150px" title="Vencimento de"
        value="${esc(capFiltros.dataInicio)}" onchange="capFiltrarDataInicio(this.value)">
      <input type="date" class="form-control" style="max-width:150px" title="Vencimento até"
        value="${esc(capFiltros.dataFim)}" onchange="capFiltrarDataFim(this.value)">
    </div>
    <div id="cap-tabela"></div>`;
  capRenderKpis();
  capRenderTabela();
}

function capRenderKpis() {
  const el = document.getElementById('cap-kpis');
  if (!el) return;
  const grupos = { aberto: [], atrasado: [], pago: [], cancelado: [] };
  capTitulos.forEach(t => { (grupos[statusEfetivo(t)] || (grupos[statusEfetivo(t)] = [])).push(t); });
  const soma = arr => arr.reduce((s, t) => s + Number(t.valor || 0), 0);
  const card = (status, label, cor, arr) => `
    <div class="dash-card kpi-click ${capFiltros.status === status ? 'kpi-ativo' : ''}" onclick="capFiltrarStatus('${status}')">
      <h3>${label}</h3>
      <div class="dash-kpi" style="color:${cor}">${arr.length}</div>
      <div style="font-size:12px;color:var(--muted)">${fmtBRL(soma(arr))}</div>
    </div>`;
  el.innerHTML =
    card('', 'Todas', 'var(--plum)', capTitulos) +
    card('aberto', 'Em aberto', 'var(--warning)', grupos.aberto) +
    card('atrasado', 'Atrasadas', 'var(--danger)', grupos.atrasado) +
    card('pago', 'Pagas', 'var(--success)', grupos.pago) +
    card('cancelado', 'Canceladas', 'var(--muted)', grupos.cancelado);
}

function capFiltrados() {
  const q = capFiltros.busca.trim().toLowerCase();
  return capTitulos.filter(t => {
    if (capFiltros.status && statusEfetivo(t) !== capFiltros.status) return false;
    if (capFiltros.fornecedor_id && String(t.fornecedor_id) !== capFiltros.fornecedor_id) return false;
    if (capFiltros.categoria_id && String(t.categoria_id) !== capFiltros.categoria_id) return false;
    if (capFiltros.dataInicio && (!t.vencimento || t.vencimento < capFiltros.dataInicio)) return false;
    if (capFiltros.dataFim && (!t.vencimento || t.vencimento > capFiltros.dataFim)) return false;
    if (q) {
      const hay = `${t.fornecedor_nome || ''} ${t.descricao || ''} ${t.boleto_codigo || ''} ${t.observacao || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function capRenderTabela() {
  const el = document.getElementById('cap-tabela');
  if (!el) return;
  const lista = capFiltrados();
  const temFiltro = capFiltros.busca || capFiltros.fornecedor_id || capFiltros.categoria_id
    || capFiltros.dataInicio || capFiltros.dataFim || capFiltros.status;

  if (!lista.length) {
    const msg = temFiltro ? 'Nenhum título com esses filtros.' : 'Nenhum título cadastrado — clique em "Novo Título".';
    el.innerHTML = `<div class="empty-state" style="padding:32px 0"><div class="empty-icon">${ICONE_CARTEIRA}</div><p>${msg}</p></div>`;
    return;
  }

  const rows = lista.map(t => {
    const ef = statusEfetivo(t);
    const b = STATUS_BADGE[ef] || STATUS_BADGE.aberto;
    const vencido = ef === 'atrasado';
    return `<tr class="ciclo-row">
      <td class="ciclo-td"><span class="badge ${b.cls}">${b.label}</span></td>
      <td class="ciclo-td" style="white-space:nowrap;${vencido ? 'color:var(--danger);font-weight:600' : ''}">
        ${formatDate(t.vencimento)}${vencido ? ' ⚠' : ''}</td>
      <td class="ciclo-td">${esc(t.fornecedor_nome || '—')}</td>
      <td class="ciclo-td"><span class="ciclo-desc">${esc(t.descricao || '—')}</span></td>
      <td class="ciclo-td">${esc(t.categoria_nome || '—')}</td>
      <td class="ciclo-td" style="font-size:12px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.observacao || '')}</td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap"><span class="ciclo-preco">${fmtBRL(t.valor)}</span></td>
      <td class="ciclo-td">${esc(t.forma_pagamento || '—')}</td>
      <td class="ciclo-td" style="white-space:nowrap">${boletoCel(t)}</td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">${acoesCel(t, ef)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="pag-wrap"><table class="pag-table"><thead><tr>
    <th class="pag-th">Status</th><th class="pag-th">Vencimento</th><th class="pag-th">Fornecedor</th>
    <th class="pag-th">Descrição</th><th class="pag-th">Categoria</th><th class="pag-th">Observação</th>
    <th class="pag-th" style="text-align:right">Valor</th><th class="pag-th">Forma Pgto</th>
    <th class="pag-th">Boleto</th><th class="pag-th" style="text-align:right">Ações</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function boletoCel(t) {
  const partes = [];
  if (t.boleto_url) partes.push(`<a href="${esc(t.boleto_url)}" target="_blank" rel="noopener" class="btn-link">Abrir</a>`);
  if (t.boleto_codigo) partes.push(`<button class="btn-secondary btn-sm" onclick="capCopiarBoleto('${esc(t.boleto_codigo)}')">Copiar</button>`);
  return partes.join(' ') || '—';
}

function acoesCel(t, ef) {
  if (!ehGestor()) return '—';
  const btns = [];
  if (ef === 'aberto' || ef === 'atrasado') {
    btns.push(`<button class="btn-secondary btn-sm" onclick="capPagarTitulo('${t.id}')">Pagar</button>`);
  }
  btns.push(`<button class="btn-secondary btn-sm" onclick="capEditarTitulo('${t.id}')">Editar</button>`);
  if (ef === 'pago' || ef === 'cancelado') {
    btns.push(`<button class="btn-secondary btn-sm" onclick="capReabrirTitulo('${t.id}')">Reabrir</button>`);
  }
  if (ef === 'aberto' || ef === 'atrasado') {
    btns.push(`<button class="btn-secondary btn-sm" onclick="capCancelarTitulo('${t.id}')">Cancelar</button>`);
  }
  if (ehAdmin()) {
    btns.push(`<button class="btn-secondary btn-sm" style="color:var(--danger)" onclick="capExcluirTitulo('${t.id}')">Excluir</button>`);
  }
  return `<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${btns.join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// Filtros
// ═══════════════════════════════════════════════════════════════════
export function capBuscar(v) { capFiltros.busca = v; capRenderTabela(); }
export function capFiltrarFornecedor(v) { capFiltros.fornecedor_id = v; capRenderTabela(); }
export function capFiltrarCategoria(v) { capFiltros.categoria_id = v; capRenderTabela(); }
export function capFiltrarDataInicio(v) { capFiltros.dataInicio = v; capRenderTabela(); }
export function capFiltrarDataFim(v) { capFiltros.dataFim = v; capRenderTabela(); }
export function capFiltrarStatus(status) {
  capFiltros.status = capFiltros.status === status ? '' : status; // clicar de novo limpa
  capRenderKpis();
  capRenderTabela();
}

// ═══════════════════════════════════════════════════════════════════
// Formulário (novo / editar)
// ═══════════════════════════════════════════════════════════════════
function formHtml(t) {
  return `
    <div class="form-group"><label class="form-label">Fornecedor *</label>
      <select id="cap-forn" class="form-control">
        <option value="">— Selecione —</option>
        ${fornecedoresAtivos().map(f => `<option value="${f.id}" ${String(f.id) === String(t.fornecedor_id || '') ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Descrição *</label>
      <input type="text" id="cap-desc" class="form-control" value="${esc(t.descricao || '')}"></div>
    <div class="form-group"><label class="form-label">Valor (R$) *</label>
      <input type="text" id="cap-valor" class="form-control" inputmode="numeric" oninput="maskMoneyBR(this)"
        value="${t.valor ? moneyToInput(t.valor) : ''}" placeholder="0,00"></div>
    <div class="form-group"><label class="form-label">Vencimento *</label>
      <input type="date" id="cap-venc" class="form-control" value="${esc(t.vencimento || hojeISO())}"></div>
    <div class="form-group"><label class="form-label">Categoria</label>
      <select id="cap-cat" class="form-control">
        <option value="">— Sem categoria —</option>
        ${categoriasAtivas().map(c => `<option value="${c.id}" ${String(c.id) === String(t.categoria_id || '') ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Forma de pagamento</label>
      <select id="cap-forma" class="form-control">
        <option value="">—</option>
        ${FORMAS_PGTO.map(f => `<option value="${f}" ${f === (t.forma_pagamento || '') ? 'selected' : ''}>${f}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Observação</label>
      <textarea id="cap-obs" class="form-control" rows="2">${esc(t.observacao || '')}</textarea></div>
    <div class="form-group"><label class="form-label">Código do boleto</label>
      <input type="text" id="cap-boleto-cod" class="form-control" placeholder="Linha digitável" value="${esc(t.boleto_codigo || '')}"></div>
    <div class="form-group"><label class="form-label">Link do boleto</label>
      <input type="url" id="cap-boleto-url" class="form-control" placeholder="https://..." value="${esc(t.boleto_url || '')}"></div>`;
}

export function capNovoTitulo() {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  document.getElementById('cad-modal-titulo').textContent = 'Novo Título';
  document.getElementById('cad-modal-body').innerHTML = formHtml({});
  document.getElementById('cad-modal-salvar').setAttribute('onclick', 'capSalvarTitulo()');
  openModal('modal-cadastro');
}

export function capEditarTitulo(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  document.getElementById('cad-modal-titulo').textContent = 'Editar Título';
  document.getElementById('cad-modal-body').innerHTML = formHtml(t);
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `capSalvarTitulo('${t.id}')`);
  openModal('modal-cadastro');
}

export async function capSalvarTitulo(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const fornId = document.getElementById('cap-forn').value;
  const descricao = document.getElementById('cap-desc').value.trim();
  const valor = parseMoneyBR(document.getElementById('cap-valor').value);
  const vencimento = document.getElementById('cap-venc').value;
  const catId = document.getElementById('cap-cat').value;

  if (!fornId) { toast('Selecione o fornecedor.'); return; }
  if (!descricao) { toast('Informe a descrição.'); return; }
  if (!(valor > 0)) { toast('Informe um valor maior que zero.'); return; }
  if (!vencimento) { toast('Informe o vencimento.'); return; }

  const forn = fornecedoresAtivos().find(f => String(f.id) === String(fornId));
  const cat = categoriasAtivas().find(c => String(c.id) === String(catId));
  const payload = {
    fornecedor_id: fornId, fornecedor_nome: forn?.nome || null,
    descricao, valor, vencimento,
    categoria_id: catId || null, categoria_nome: cat?.nome || null,
    forma_pagamento: document.getElementById('cap-forma').value || null,
    observacao: document.getElementById('cap-obs').value.trim() || null,
    boleto_codigo: document.getElementById('cap-boleto-cod').value.trim() || null,
    boleto_url: document.getElementById('cap-boleto-url').value.trim() || null,
  };

  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';
  let error;
  if (id) {
    ({ error } = await sbQ(sb.from('contas_a_pagar').update(payload).eq('id', id)));
  } else {
    payload.status = 'aberto';
    payload.created_by = state.currentUser?.id || null;
    ({ error } = await sbQ(sb.from('contas_a_pagar').insert(payload)));
  }
  btn.disabled = false; btn.textContent = 'Salvar';
  if (await handleSupabaseError(error, 'Erro ao salvar o título')) return;
  closeModal('modal-cadastro');
  toast(id ? 'Título atualizado!' : 'Título criado!');
  loadContasAPagar();
}

// ═══════════════════════════════════════════════════════════════════
// Pagar / Cancelar / Reabrir / Excluir
// ═══════════════════════════════════════════════════════════════════
export function capPagarTitulo(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  document.getElementById('cad-modal-titulo').textContent = 'Marcar como pago';
  document.getElementById('cad-modal-body').innerHTML = `
    <div style="font-size:13.5px;margin-bottom:14px">
      <b>${esc(t.fornecedor_nome || t.descricao)}</b> · ${esc(t.descricao)}<br>
      <span style="color:var(--rose);font-weight:600">${fmtBRL(t.valor)}</span>
      <span style="color:var(--muted)"> · vence ${formatDate(t.vencimento)}</span>
    </div>
    <div class="form-group"><label class="form-label">Data do pagamento</label>
      <input type="date" id="cap-pgto-data" class="form-control" value="${hojeISO()}"></div>
    <div class="form-group"><label class="form-label">Forma de pagamento</label>
      <select id="cap-pgto-forma" class="form-control">
        <option value="">—</option>
        ${FORMAS_PGTO.map(f => `<option value="${f}" ${f === (t.forma_pagamento || '') ? 'selected' : ''}>${f}</option>`).join('')}
      </select></div>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `capConfirmarPagamento('${t.id}')`);
  openModal('modal-cadastro');
}

export async function capConfirmarPagamento(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  const data = document.getElementById('cap-pgto-data').value;
  if (!data) { toast('Informe a data do pagamento.'); return; }
  const forma = document.getElementById('cap-pgto-forma').value || t?.forma_pagamento || null;
  const { error } = await sbQ(sb.from('contas_a_pagar')
    .update({ status: 'pago', data_pagamento: data, forma_pagamento: forma }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao registrar o pagamento')) return;
  closeModal('modal-cadastro');
  toast('Pagamento registrado!');
  loadContasAPagar();
}

export function capCancelarTitulo(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  confirmarAcao('Cancelar título', `Cancelar "${t.descricao}" (${fmtBRL(t.valor)})?`, 'Cancelar título', async () => {
    const { error } = await sbQ(sb.from('contas_a_pagar').update({ status: 'cancelado' }).eq('id', id));
    if (await handleSupabaseError(error, 'Erro ao cancelar')) return;
    toast('Título cancelado.');
    loadContasAPagar();
  });
}

export async function capReabrirTitulo(id) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  const { error } = await sbQ(sb.from('contas_a_pagar')
    .update({ status: 'aberto', data_pagamento: null }).eq('id', id));
  if (await handleSupabaseError(error, 'Erro ao reabrir')) return;
  toast('Título reaberto.');
  loadContasAPagar();
}

export function capExcluirTitulo(id) {
  if (!ehAdmin()) { toast('Apenas admin pode excluir.'); return; }
  const t = capTitulos.find(x => String(x.id) === String(id));
  if (!t) return;
  confirmarAcao('Excluir título', `Excluir definitivamente "${t.descricao}" (${fmtBRL(t.valor)})? Esta ação não pode ser desfeita.`, 'Excluir', async () => {
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

const ICONE_CARTEIRA = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';
