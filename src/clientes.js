// Clientes finais das revendedoras (base própria). CRUD com dedup por celular.
// Só staff (RLS). As colunas de venda (total gasto/última compra) entram quando
// vendas.cliente_id existir — hoje mostramos os dados de cadastro reais.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, toast, confirmarAcao, openModal, closeModal, handleSupabaseError,
         isoToBR, brToISO } from './utils.js';
// maskTelBR/maskDateBR são usados só em handlers inline (oninput=) via window.

const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_USERS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
const IC_CAKE  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/></svg>';

let cache = [];
let busca = '';

const panel = () => document.getElementById('panel-clientes');
const soDigitos = s => (s || '').replace(/\D/g, '');
const telFmt = c => { const d = soDigitos(c); if (!d) return '—'; return d.length > 10 ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}` : `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6,10)}`; };
const mesAtual = () => new Date().getMonth() + 1;

export async function loadClientes() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from('clientes').select('*').order('nome'));
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || '')) {
      panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_USERS}</div><p>Rode a migração <b>0021_clientes.sql</b> no Supabase para ativar a base de clientes.</p></div>`;
      return;
    }
    if (await handleSupabaseError(error, 'Erro ao carregar clientes')) return;
  }
  cache = data || [];
  render();
}

function render() {
  const mes = mesAtual();
  const aniv = cache.filter(c => c.data_nascimento && Number(c.data_nascimento.slice(5, 7)) === mes).length;
  const comContato = cache.filter(c => c.celular).length;

  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Clientes</h2><div class="sub">${cache.length} cliente${cache.length !== 1 ? 's' : ''} cadastrado${cache.length !== 1 ? 's' : ''}</div></div>
      <div class="acts"><button class="btn-primary btn-sm" onclick="clienteNovo()">${IC_PLUS} Novo cliente</button></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Total</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${cache.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Aniversariantes do mês</span><span class="kpi-ic">${IC_CAKE}</span></div><div class="kpi-val">${aniv}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Com celular</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${comContato}</div></div>
    </div>
    <div style="margin-bottom:14px"><input type="text" class="form-control" placeholder="Buscar por nome, telefone, cidade ou e-mail..." value="${esc(busca)}" oninput="clienteBuscar(this.value)"></div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Cliente</th><th class="pag-th">Telefone</th><th class="pag-th">Cidade</th><th class="pag-th">Nascimento</th>
      <th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody id="cli-tbody">${linhasClientes()}</tbody></table></div>`;
}

// Só as linhas — a busca atualiza só isto (o input fica intacto, sem perder foco).
function linhasClientes() {
  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? cache.filter(c => [c.nome, c.cidade, c.celular, c.email].some(v => (v || '').toLowerCase().includes(termo)))
    : cache;
  return lista.length ? lista.map(c => `
    <tr class="pag-row" style="cursor:pointer" onclick="clienteVer('${c.id}')">
      <td class="pag-td"><span class="ciclo-desc">${esc(c.nome)}</span>${c.email ? `<div style="font-size:11px;color:var(--muted)">${esc(c.email)}</div>` : ''}</td>
      <td class="pag-td">${esc(telFmt(c.celular))}</td>
      <td class="pag-td">${esc(c.cidade || '—')}</td>
      <td class="pag-td">${c.data_nascimento ? esc(isoToBR(c.data_nascimento)) : '—'}</td>
      <td class="pag-td" style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">
        <button class="btn-icon" title="Editar" onclick="clienteEditar('${c.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="clienteExcluir('${c.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="5"><div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_USERS}</div><p>${termo ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</p></div></td></tr>`;
}

export function clienteBuscar(v) {
  busca = v;
  const tb = document.getElementById('cli-tbody');
  if (tb) tb.innerHTML = linhasClientes(); else render();
}

// ── Detalhe (modal) ────────────────────────────────────────────────
export function clienteVer(id) {
  const c = cache.find(x => String(x.id) === String(id));
  if (!c) return;
  const linha = (k, v) => `<div style="display:flex;gap:8px;padding:6px 0"><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;min-width:120px">${k}</div><div style="font-size:14px;flex:1">${esc(v || '—')}</div></div>`;
  document.getElementById('cad-modal-titulo').textContent = c.nome;
  document.getElementById('cad-modal-body').innerHTML = `
    ${c.created_at ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Cliente desde ${esc(isoToBR(c.created_at))}</div>` : ''}
    ${linha('Telefone', telFmt(c.celular))}
    ${linha('E-mail', c.email)}
    ${linha('Cidade', c.cidade)}
    ${linha('Nascimento', c.data_nascimento ? isoToBR(c.data_nascimento) : '')}
    ${c.observacao ? linha('Observação', c.observacao) : ''}
    <button class="btn-secondary btn-sm" style="margin-top:14px" onclick="clienteEditar('${c.id}')">${IC_EDIT} Editar</button>`;
  document.getElementById('cad-modal-salvar').style.display = 'none';
  openModal('modal-cadastro');
}

// ── Formulário (reusa o modal-cadastro genérico) ───────────────────
export function clienteNovo() { abrirForm(null); }
export function clienteEditar(id) { abrirForm(cache.find(x => String(x.id) === String(id))); }

function abrirForm(c) {
  const r = c || {};
  document.getElementById('cad-modal-titulo').textContent = c ? 'Editar cliente' : 'Novo cliente';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="cli-nome" class="form-control" value="${esc(r.nome || '')}"></div>
    <div class="form-group"><label class="form-label">Celular (com DDD)</label>
      <input type="text" id="cli-cel" class="form-control" inputmode="numeric" placeholder="(00) 00000-0000" value="${esc(telFmt(r.celular) === '—' ? '' : telFmt(r.celular))}" oninput="maskTelBR(this)"></div>
    <div class="form-group"><label class="form-label">E-mail</label>
      <input type="text" id="cli-email" class="form-control" inputmode="email" value="${esc(r.email || '')}"></div>
    <div class="form-group"><label class="form-label">Cidade</label>
      <input type="text" id="cli-cidade" class="form-control" value="${esc(r.cidade || '')}"></div>
    <div class="form-group"><label class="form-label">Data de nascimento</label>
      <input type="text" id="cli-nasc" class="form-control" inputmode="numeric" placeholder="dd/mm/aaaa" value="${esc(r.data_nascimento ? isoToBR(r.data_nascimento) : '')}" oninput="maskDateBR(this)"></div>
    <div class="form-group"><label class="form-label">Observação</label>
      <textarea id="cli-obs" class="form-control" rows="2">${esc(r.observacao || '')}</textarea></div>`;
  const salvar = document.getElementById('cad-modal-salvar');
  salvar.style.display = '';
  salvar.setAttribute('onclick', `clienteSalvar(${c ? `'${r.id}'` : 'null'})`);
  openModal('modal-cadastro');
}

export async function clienteSalvar(id) {
  const val = elId => (document.getElementById(elId)?.value || '').trim();
  const nome = val('cli-nome');
  if (!nome) { toast('Nome é obrigatório'); return; }
  const nb = v => v || null;
  const payload = {
    nome,
    celular: soDigitos(val('cli-cel')) || null,
    email: nb(val('cli-email')),
    cidade: nb(val('cli-cidade')),
    data_nascimento: brToISO(val('cli-nasc')),
    observacao: nb(val('cli-obs')),
  };
  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true;
  let error;
  if (id) {
    ({ error } = await sbQ(sb.from('clientes').update(payload).eq('id', id)));
  } else {
    payload.criado_por = state.currentUser.id;
    ({ error } = await sbQ(sb.from('clientes').insert(payload)));
  }
  btn.disabled = false;
  if (error) {
    if (/duplicate key|unique/i.test(error.message || '')) { toast('Já existe um cliente com esse celular.'); return; }
    if (await handleSupabaseError(error, 'Erro ao salvar')) return;
    toast('Erro ao salvar'); return;
  }
  toast('Cliente salvo!');
  closeModal('modal-cadastro');
  loadClientes();
}

export function clienteExcluir(id) {
  const c = cache.find(x => String(x.id) === String(id));
  confirmarAcao('Excluir cliente', `Excluir "${c?.nome || ''}"? Isso não pode ser desfeito.`, 'Excluir', async () => {
    const { error } = await sbQ(sb.from('clientes').delete().eq('id', id));
    if (error) { if (await handleSupabaseError(error, 'Erro ao excluir')) return; toast('Erro ao excluir'); return; }
    toast('Cliente excluído.');
    loadClientes();
  });
}
