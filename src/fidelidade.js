// Programa de Fidelidade — cartela de selos da CLIENTE FINAL.
// 1 selo a cada R$150 cheios da venda; 10 selos = R$300 em peças (retirada na
// loja). Os selos são creditados no banco (trigger aplicar_fidelidade, 0029).
// Staff vê todas as clientes; a revendedora só as clientes p/ quem já vendeu
// (a RLS 0028 faz o filtro — a MESMA query serve os dois papéis).
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, toast, confirmarAcao, openModal, handleSupabaseError, fmtBRL, isoToBR } from './utils.js';
import { ehStaff, ehGestor } from './auth.js';

const IC_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_GIFT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>';
const IC_STAMP = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 6.5a4 4 0 0 0-8 0c0 2.5 3 4 3.5 6h1c.5-2 3.5-3.5 3.5-6z"/><circle cx="12" cy="12" r="10"/></svg>';

let cache = [];        // [{id, nome, celular, selos, premios}]
let busca = '';

const panel = () => document.getElementById('panel-fidelidade');
const soDigitos = s => (s || '').replace(/\D/g, '');
const telFmt = c => { const d = soDigitos(c); if (!d) return '—'; return d.length > 10 ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}` : `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6,10)}`; };

// Cartela visual de 10 casinhas (5×2). Exportada — o modal pós-venda reusa.
export function renderCartelaFidelidade(selos) {
  const n = Math.max(0, Math.min(10, Number(selos) || 0));
  const casas = Array.from({ length: 10 }, (_, i) =>
    i < n
      ? `<div class="fid-selo on">${IC_CHECK}</div>`
      : `<div class="fid-selo">${i + 1}</div>`).join('');
  return `<div class="fid-cartela">${casas}</div>`;
}

export async function loadFidelidade() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const [cRes, cartRes, premRes] = await Promise.all([
    sbQ(sb.from('clientes').select('id,nome,celular').order('nome')),
    sbQ(sb.from('fidelidade_cartelas').select('cliente_id,selos').eq('status', 'aberta')),
    sbQ(sb.from('fidelidade_premios').select('cliente_id').eq('status', 'pendente')),
  ]);
  if (cRes.error) {
    if (/relation|does not exist|schema cache/i.test(cRes.error.message || '')) {
      panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_STAMP}</div><p>Rode as migrações <b>0028</b> e <b>0029</b> no Supabase para ativar a fidelidade.</p></div>`;
      return;
    }
    if (await handleSupabaseError(cRes.error, 'Erro ao carregar fidelidade')) return;
  }
  const selosPorCli = {};
  (cartRes.data || []).forEach(c => { selosPorCli[c.cliente_id] = c.selos; });
  const premiosPorCli = {};
  (premRes.data || []).forEach(p => { premiosPorCli[p.cliente_id] = (premiosPorCli[p.cliente_id] || 0) + 1; });
  cache = (cRes.data || []).map(c => ({
    ...c, selos: selosPorCli[c.id] || 0, premios: premiosPorCli[c.id] || 0,
  }));
  render();
}

function render() {
  const emAndamento = cache.filter(c => c.selos > 0).length;
  const premios = cache.reduce((s, c) => s + c.premios, 0);
  const staff = ehStaff();
  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Fidelidade</h2><div class="sub">${staff ? 'Cartela de selos das clientes' : 'Cartela de selos das suas clientes'}</div></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Clientes</span><span class="kpi-ic">${IC_STAMP}</span></div><div class="kpi-val">${cache.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Cartelas em andamento</span><span class="kpi-ic">${IC_STAMP}</span></div><div class="kpi-val">${emAndamento}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Prêmios pendentes</span><span class="kpi-ic">${IC_GIFT}</span></div><div class="kpi-val"${premios ? ' style="color:var(--gold)"' : ''}>${premios}</div></div>
    </div>
    <div style="margin-bottom:14px"><input type="text" class="form-control" placeholder="Buscar por nome ou telefone..." value="${esc(busca)}" oninput="fidelidadeBuscar(this.value)"></div>
    <div id="fid-lista">${linhas()}</div>`;
}

function linhas() {
  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? cache.filter(c => [c.nome, c.celular].some(v => (v || '').toLowerCase().includes(termo)))
    : cache;
  if (!lista.length) {
    return `<div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_STAMP}</div><p>${termo ? 'Nenhuma cliente encontrada' : 'Nenhuma cliente com fidelidade ainda'}</p></div>`;
  }
  return `<div class="pag-wrap"><table class="pag-table"><thead><tr>
    <th class="pag-th">Cliente</th><th class="pag-th">Telefone</th><th class="pag-th" style="text-align:center">Selos</th><th class="pag-th"></th>
  </tr></thead><tbody>${lista.map(c => `
    <tr class="pag-row" style="cursor:pointer" onclick="fidelidadeVerCliente('${c.id}')">
      <td class="pag-td"><span class="ciclo-desc">${esc(c.nome)}</span></td>
      <td class="pag-td">${esc(telFmt(c.celular))}</td>
      <td class="pag-td" style="text-align:center"><span class="fid-progresso">${c.selos}/10</span></td>
      <td class="pag-td" style="text-align:right">${c.premios ? `<span class="badge badge-aberta" style="color:var(--gold);border-color:var(--gold)">${IC_GIFT} Prêmio</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

export function fidelidadeBuscar(v) {
  busca = v;
  const el = document.getElementById('fid-lista');
  if (el) el.innerHTML = linhas(); else render();
}

// ── Detalhe da cliente (reusa o modal-cadastro genérico) ───────────────
export async function fidelidadeVerCliente(id) {
  const c = cache.find(x => String(x.id) === String(id));
  if (!c) return;
  document.getElementById('cad-modal-titulo').textContent = c.nome;
  const body = document.getElementById('cad-modal-body');
  body.innerHTML = '<div class="loading" style="padding:20px"><div class="spinner">⟳</div></div>';
  document.getElementById('cad-modal-salvar').style.display = 'none';
  openModal('modal-cadastro');

  const { data, error } = await sbQ(sb.rpc('fidelidade_status', { p_cliente_id: id }));
  if (error) { body.innerHTML = '<p style="color:var(--danger)">Erro ao carregar a fidelidade.</p>'; return; }
  const selos = data?.cartela?.selos || 0;
  const premios = data?.premios_pendentes || [];
  const extrato = data?.extrato || [];
  const completas = data?.cartelas_completas || 0;

  const premiosHtml = premios.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(212,168,75,.10);border:1px solid var(--gold);border-radius:12px;padding:10px 14px;margin-bottom:8px">
      <div style="font-size:13px;color:var(--plum)"><span style="color:var(--gold);vertical-align:-3px">${IC_GIFT}</span> Prêmio de ${fmtBRL(p.valor)} disponível</div>
      ${ehGestor() ? `<button class="btn-primary btn-sm" style="width:auto" onclick="fidelidadeResgatar('${p.id}')">Registrar resgate</button>` : ''}
    </div>`).join('');

  const extratoHtml = extrato.length ? extrato.map(e => `
    <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px">
      <span style="color:var(--muted)">${esc(isoToBR((e.em || '').slice(0,10)))}${e.valor_venda ? ' · ' + fmtBRL(e.valor_venda) : ''}</span>
      <span style="color:var(--plum);font-weight:600">+${e.quantidade} selo${e.quantidade !== 1 ? 's' : ''}</span>
    </div>`).join('') : '<div style="font-size:12px;color:var(--muted)">Sem selos ainda.</div>';

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:6px">
      <div class="fid-progresso" style="font-size:22px">${selos}/10 selos</div>
      <div style="font-size:12px;color:var(--muted)">${selos >= 10 ? 'Cartela completa!' : `Faltam ${10 - selos} para R$ 300 em peças`}</div>
    </div>
    ${renderCartelaFidelidade(selos)}
    ${premiosHtml ? `<div style="margin:16px 0 6px">${premiosHtml}</div>` : ''}
    ${completas ? `<div style="font-size:12px;color:var(--muted);margin-top:10px">${completas} cartela${completas !== 1 ? 's' : ''} já completada${completas !== 1 ? 's' : ''}.</div>` : ''}
    <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:13px;color:var(--plum);margin:18px 0 4px">Histórico de selos</div>
    ${extratoHtml}`;
}

export async function fidelidadeResgatar(premioId) {
  if (!ehGestor()) { toast('Apenas gestores registram o resgate.'); return; }
  confirmarAcao('Registrar resgate', 'Confirmar a entrega das R$ 300 em peças para esta cliente? A cartela já foi zerada quando o prêmio foi gerado.', 'Registrar resgate', async () => {
    const { error } = await sbQ(sb.from('fidelidade_premios')
      .update({ status: 'resgatado', resgatado_em: new Date().toISOString(), resgatado_por: state.currentUser.id })
      .eq('id', premioId).eq('status', 'pendente'));
    if (await handleSupabaseError(error, 'Erro ao registrar resgate')) return;
    toast('Resgate registrado!');
    document.getElementById('modal-cadastro')?.classList.remove('show');
    loadFidelidade();
  });
}
