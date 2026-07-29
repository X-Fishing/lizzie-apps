// Busca global (topbar, staff): acha cliente/pedido/produto/conta num só lugar,
// igual ao "Zenplay" que o Rondon pediu. Consultas paralelas por entidade
// (.ilike().or()), no padrão do f3Buscar (lancador.js) — RLS já filtra o que
// cada papel pode ver, então não precisa reimplementar o gate aqui.
import { sb } from './supabase.js';
import { esc, toast, sbQ, fmtBRL, openModal, closeModal, debounce } from './utils.js';
import { ehStaff, ehGestor } from './auth.js';
import { showPanel, abrirRevendedora } from './nav.js';
import { podeAcessarPanel } from './menu.js';
import { clienteAbrirPorId } from './clientes.js';
import { produtoAbrirPorId } from './produtos.js';
import { finIrParaMes } from './financeiro.js';
import { capIrParaMes } from './contas-a-pagar.js';

let bgResultados = [];   // lista achatada, na ordem em que aparece na tela
let bgSel = 0;

export function buscaGlobalAbrir() {
  if (!ehStaff()) return;
  const input = document.getElementById('bg-search');
  input.value = '';
  bgResultados = []; bgSel = 0;
  document.getElementById('bg-results').innerHTML =
    '<div class="empty-state" style="padding:20px 0"><p style="font-size:13px;color:var(--muted)">Digite para buscar em clientes, pedidos, produtos e contas.</p></div>';
  openModal('modal-busca-global');
  setTimeout(() => input.focus(), 60);
}

export function buscaGlobalFechar() { closeModal('modal-busca-global'); }

const buscaGlobalDebounced = debounce(() => buscaGlobalRun(), 250);
export function buscaGlobalInput() { buscaGlobalDebounced(); }

// Aspas protegem vírgulas/caracteres do .or() do PostgREST (mesmo truque do f3Buscar).
const semAspas = t => t.replace(/"/g, '');

async function buscarClientes(t) {
  if (!podeAcessarPanel('clientes')) return [];
  let q = sb.from('clientes').select('id,nome,celular,cidade,email');
  if (t) q = q.or(`nome.ilike."%${t}%",celular.ilike."%${t}%",cidade.ilike."%${t}%",email.ilike."%${t}%"`);
  const { data } = await sbQ(q.order('nome').limit(8));
  return (data || []).map(c => ({
    tipo: 'Cliente', titulo: c.nome, subtitulo: [c.celular, c.cidade].filter(Boolean).join(' · '),
    abrir: () => clienteAbrirPorId(c.id),
  }));
}

async function buscarProdutos(t) {
  if (!podeAcessarPanel('produtos')) return [];
  let q = sb.from('produtos').select('id,nome,sku,codigo_fornecedor,codigo_barras,preco_venda').eq('ativo', true);
  if (t) q = q.or(`nome.ilike."%${t}%",sku.ilike."%${t}%",codigo_fornecedor.ilike."%${t}%",codigo_barras.ilike."%${t}%"`);
  const { data } = await sbQ(q.order('nome').limit(8));
  return (data || []).map(p => ({
    tipo: 'Produto', titulo: p.nome, subtitulo: `SKU ${p.sku || '—'} · ${fmtBRL(p.preco_venda || 0)}`,
    abrir: () => produtoAbrirPorId(p.id),
  }));
}

async function buscarContasReceber(t) {
  if (!podeAcessarPanel('financeiro')) return [];
  let q = sb.from('financeiro_lancamentos').select('id,descricao,pessoa_nome,valor,vencimento,data_recebimento,pago').eq('tipo', 'receber');
  if (t) q = q.or(`descricao.ilike."%${t}%",pessoa_nome.ilike."%${t}%"`);
  const { data } = await sbQ(q.order('created_at', { ascending: false }).limit(8));
  return (data || []).map(l => ({
    tipo: 'Conta a receber', titulo: l.pessoa_nome || l.descricao, subtitulo: `${fmtBRL(l.valor)} · ${l.pago ? 'recebido' : 'pendente'}`,
    // A lista é escopada por mês — pula direto pro mês do lançamento encontrado.
    abrir: () => { showPanel('financeiro'); const ym = (l.vencimento || l.data_recebimento || '').slice(0, 7); if (ym) finIrParaMes(ym); },
  }));
}

async function buscarContasPagar(t) {
  if (!podeAcessarPanel('contas-a-pagar')) return [];
  let q = sb.from('contas_a_pagar').select('id,descricao,fornecedor_nome,valor,vencimento,status');
  if (t) q = q.or(`descricao.ilike."%${t}%",fornecedor_nome.ilike."%${t}%"`);
  const { data } = await sbQ(q.order('vencimento', { ascending: false }).limit(8));
  return (data || []).map(c => ({
    tipo: 'Conta a pagar', titulo: c.descricao, subtitulo: `${esc(c.fornecedor_nome || '—')} · ${fmtBRL(c.valor)} · ${c.status}`,
    abrir: () => { showPanel('contas-a-pagar'); const ym = (c.vencimento || '').slice(0, 7); if (ym) capIrParaMes(ym); },
  }));
}

// Pedidos (vendas): não há tela staff-wide de "todas as vendas" (Pagamentos e
// Histórico são só do próprio uso da revendedora) — então o resultado abre a
// revendedora dona da venda, não a venda em si. Exige termo (evita listar
// vendas de todas as revendedoras à toa) e só gestor (quem acessa o admin).
async function buscarVendas(t) {
  if (!ehGestor() || !t) return [];
  const { data } = await sbQ(sb.from('vendas').select('id,nome_cliente,telefone_cliente,valor_total,status,revendedora_id,data_venda')
    .or(`nome_cliente.ilike."%${t}%",telefone_cliente.ilike."%${t}%"`)
    .order('data_venda', { ascending: false }).limit(8));
  return (data || []).map(v => ({
    tipo: 'Pedido', titulo: v.nome_cliente || 'Cliente não informado', subtitulo: `${fmtBRL(v.valor_total || 0)} · ${v.status || ''}`,
    abrir: () => { if (v.revendedora_id) abrirRevendedora(v.revendedora_id); else toast('Revendedora não identificada nesta venda.'); },
  }));
}

async function buscaGlobalRun() {
  const termoBruto = (document.getElementById('bg-search')?.value || '').trim();
  const t = semAspas(termoBruto);
  document.getElementById('bg-results').innerHTML = '<div class="loading" style="padding:20px 0"><div class="spinner">⟳</div></div>';
  const [clientes, produtos, receber, pagar, vendas] = await Promise.all([
    buscarClientes(t), buscarProdutos(t), buscarContasReceber(t), buscarContasPagar(t), buscarVendas(t),
  ]);
  bgResultados = [...clientes, ...produtos, ...receber, ...pagar, ...vendas];
  bgSel = 0;
  buscaGlobalRender(termoBruto);
}

function buscaGlobalRender(termo) {
  const div = document.getElementById('bg-results');
  if (!bgResultados.length) {
    div.innerHTML = `<div class="empty-state" style="padding:20px 0"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${termo ? `Nada encontrado para "${esc(termo)}"` : 'Nenhum resultado'}</p></div>`;
    return;
  }
  div.innerHTML = bgResultados.map((r, i) => `
    <div class="f3-row${i === bgSel ? ' sel' : ''}" onclick="buscaGlobalIr(${i})">
      <div style="flex:1;min-width:0">
        <div class="ciclo-desc">${esc(r.titulo)}</div>
        <div class="f3-meta"><span style="text-transform:uppercase;font-size:10px;letter-spacing:.5px;color:var(--rose)">${esc(r.tipo)}</span><span>${esc(r.subtitulo || '')}</span></div>
      </div>
    </div>`).join('');
  div.querySelector('.f3-row.sel')?.scrollIntoView({ block: 'nearest' });
}

export function buscaGlobalTeclas(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (bgResultados.length) { bgSel = Math.min(bgSel + 1, bgResultados.length - 1); buscaGlobalRender(e.target.value.trim()); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (bgResultados.length) { bgSel = Math.max(bgSel - 1, 0); buscaGlobalRender(e.target.value.trim()); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (bgResultados.length) buscaGlobalIr(bgSel);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    buscaGlobalFechar();
  }
}

export function buscaGlobalIr(idx) {
  const r = bgResultados[idx];
  if (!r) return;
  buscaGlobalFechar();
  r.abrir();
}
