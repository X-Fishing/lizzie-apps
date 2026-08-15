// "Minhas Clientes" — a agenda da REVENDEDORA: as clientes para quem ela já
// vendeu, com edição do cadastro. Fica no grupo "Vendas" do menu gaveta.
//
// Até aqui a revendedora não tinha nenhuma tela de clientes: o "Histórico de
// Vendas" agrupa por vendas.nome_cliente COMO STRING (então o mesmo nome
// digitado diferente vira duas pessoas) e ela não podia corrigir nada — a RLS
// de `clientes` dá a ela SELECT e zero escrita (0021/0028). A escrita passa
// pela RPC cliente_editar (0056), que valida permissão no servidor.
//
// ESCOPO: filtrado NA QUERY, não na RLS — mesmo motivo documentado em
// fidelidade.js:37-44 ("Entrar como Revendedora" troca o papel só na memória
// da sessão, então para o banco a funcionária continua staff).
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, escAttrJs, sbQ, fetchPaginado, handleSupabaseError, fmtBRL, fmtDiaMes, telFmt, telValido } from './utils.js';
import { abrirEdicaoCliente } from './cliente-form.js';

const IC_USERS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

let cache = [];   // [{...cliente, compras, total, selos}]
let busca = '';

const panel = () => document.getElementById('panel-minhas-clientes');
const telRuim = c => !!c && !telValido(c);

export async function loadMinhasClientes() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';

  // 1) As vendas DELA dizem quem são "as clientes dela" e já trazem os totais.
  //    Paginado: o PostgREST corta em 1000 linhas por requisição, e sem isso
  //    clientes antigas sumiriam da lista sem nenhum aviso. O .order() garante
  //    ordem estável entre as páginas (senão o range() repete/pula linhas).
  const { data: minhas, error: vErr } = await fetchPaginado(() => sb.from('vendas')
    .select('cliente_id,valor_total')
    .eq('revendedora_id', state.currentUser.id)
    .not('cliente_id', 'is', null)
    .order('id'));
  if (vErr) {
    // handleSupabaseError devolve TRUE para qualquer erro (utils.js): usar o
    // retorno dele como "já tratei, pode sair" deixaria a tela presa no
    // spinner. Chamar para o toast/sessão e SEMPRE renderizar o estado.
    await handleSupabaseError(vErr, 'Erro ao carregar suas clientes');
    panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_USERS}</div><p>Não foi possível carregar suas clientes. Tente de novo.</p></div>`;
    return;
  }

  const agg = new Map();
  for (const v of (minhas || [])) {
    const a = agg.get(v.cliente_id) || { compras: 0, total: 0 };
    a.compras += 1;
    a.total += Number(v.valor_total || 0);
    agg.set(v.cliente_id, a);
  }
  const ids = [...agg.keys()];
  if (!ids.length) { cache = []; render(); return; }

  // 2) Cadastro + cartela aberta das mesmas clientes.
  const [cRes, cartRes] = await Promise.all([
    sbQ(sb.from('clientes').select('*').in('id', ids).order('nome')),
    sbQ(sb.from('fidelidade_cartelas').select('cliente_id,selos').eq('status', 'aberta').in('cliente_id', ids)),
  ]);
  if (cRes.error) { if (await handleSupabaseError(cRes.error, 'Erro ao carregar suas clientes')) return; }
  // A cartela é acessório: se a fidelidade não estiver instalada, a tela segue.
  const selosPorCli = {};
  (cartRes.data || []).forEach(c => { selosPorCli[c.cliente_id] = c.selos; });

  cache = (cRes.data || []).map(c => ({
    ...c,
    compras: agg.get(c.id)?.compras || 0,
    total: agg.get(c.id)?.total || 0,
    selos: selosPorCli[c.id] || 0,
  }));
  render();
}

function render() {
  const comAniversario = cache.filter(c => c.aniversario_mes).length;
  panel().innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Minhas Clientes</div>
        <div class="section-subtitle">As clientes para quem você já vendeu</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Clientes</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${cache.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Com aniversário</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${comAniversario}</div></div>
    </div>
    <div class="search-bar">
      <input class="search-input" id="mc-search" placeholder="Buscar por nome ou telefone..." value="${esc(busca)}" oninput="minhasClientesBuscar(this.value)">
    </div>
    <div id="mc-lista">${linhas()}</div>`;
}

function linhas() {
  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? cache.filter(c => [c.nome, c.celular, c.cidade].some(v => (v || '').toLowerCase().includes(termo)))
    : cache;
  if (!lista.length) {
    return `<div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_USERS}</div><p>${
      termo ? 'Nenhuma cliente encontrada' : 'Você ainda não tem clientes. Elas aparecem aqui depois da primeira venda com WhatsApp informado.'}</p></div>`;
  }
  return lista.map(c => `
    <div class="hist-card" onclick="abrirCliente('${escAttrJs(c.id)}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="flex:1;min-width:0">
          <div class="hist-nome">${esc(c.nome)}</div>
          <div class="hist-stats">
            ${esc(telFmt(c.celular))}${telRuim(c.celular) ? ' <span class="badge badge-pendente">telefone inválido</span>' : ''}
            ${fmtDiaMes(c.aniversario_dia, c.aniversario_mes) ? ' · 🎂 ' + esc(fmtDiaMes(c.aniversario_dia, c.aniversario_mes)) : ''}
          </div>
          <div class="hist-stats">
            <b>${esc(c.compras)}</b> compra${c.compras !== 1 ? 's' : ''} · ${fmtBRL(c.total)} · <b>${esc(c.selos)}/10</b> selos
          </div>
        </div>
        <button class="btn-icon" title="Editar cadastro" style="color:var(--rose)"
                onclick="event.stopPropagation();minhaClienteEditar('${escAttrJs(c.id)}')">${IC_EDIT}</button>
      </div>
    </div>`).join('');
}

export function minhasClientesBuscar(v) {
  busca = v;
  const el = document.getElementById('mc-lista');
  if (el) el.innerHTML = linhas(); else render();
}

// ── Edição: formulário compartilhado (src/cliente-form.js) ─────────
export function minhaClienteEditar(id) {
  const c = cache.find(x => String(x.id) === String(id));
  abrirEdicaoCliente(c, loadMinhasClientes);
}
