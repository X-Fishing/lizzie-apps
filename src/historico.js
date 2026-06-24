// Historico de vendas das clientes (agrupado por cliente).
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast } from './utils.js';
export async function loadHistorico() {
  if (!state.allVendas.length) {
    document.getElementById('h-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
    let q = sb.from('vendas').select('*').eq('revendedora_id', state.currentUser.id);
    const { data, error } = await sbQ(q.order('data_venda', { ascending: false }));
    if (error) {
      document.getElementById('h-list').innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao carregar.</p></div>';
      return;
    }
    state.allVendas = data || [];
    state.vendaItensCache = {};
  }
  filtrarHistorico();
}

export function filtrarHistorico() {
  const div = document.getElementById('h-list');
  const termo = (document.getElementById('h-search').value || '').toLowerCase().trim();

  const porCliente = {};
  for (const v of state.allVendas) {
    const key = (v.nome_cliente || '').toLowerCase();
    if (termo && !key.includes(termo)) continue;
    if (!porCliente[key]) porCliente[key] = { nome: v.nome_cliente, vendas: [] };
    porCliente[key].vendas.push(v);
  }

  const clientes = Object.values(porCliente).sort((a, b) => a.nome.localeCompare(b.nome));

  if (!clientes.length) {
    div.innerHTML = termo
      ? `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>Nenhuma cliente encontrada com "${termo}"</p></div>`
      : '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg></div><p>Nenhuma venda ainda. As compras das suas clientes aparecerão aqui.</p></div>';
    return;
  }

  div.innerHTML = clientes.map(c => {
    const total = c.vendas.reduce((s, v) => s + Number(v.valor_total), 0);
    const pago = c.vendas.reduce((s, v) => s + Number(v.valor_pago), 0);
    const pendente = total - pago;
    const aberto = state.historicoExpandido === c.nome.toLowerCase();
    return `<div class="hist-card${aberto?' open':''}" data-hist-key="${esc(c.nome.toLowerCase())}" onclick="toggleHistorico(this.dataset.histKey)">
      <div class="hist-nome">${esc(c.nome)}</div>
      <div class="hist-stats">
        <b>${c.vendas.length}</b> compra${c.vendas.length!==1?'s':''} ·
        Total <b>R$ ${total.toFixed(2)}</b> ·
        Pago <b style="color:var(--success)">R$ ${pago.toFixed(2)}</b>
        ${pendente > 0 ? ` · Pendente <b style="color:var(--danger)">R$ ${pendente.toFixed(2)}</b>` : ''}
      </div>
      ${aberto ? `<div class="hist-detalhe" onclick="event.stopPropagation()">${renderHistoricoDetalhes(c.vendas)}</div>` : ''}
    </div>`;
  }).join('');

  if (state.historicoExpandido) {
    const aberta = clientes.find(c => c.nome.toLowerCase() === state.historicoExpandido);
    if (aberta) carregarItensDasVendas(aberta.vendas);
  }
}

export function toggleHistorico(nomeKey) {
  state.historicoExpandido = state.historicoExpandido === nomeKey ? null : nomeKey;
  filtrarHistorico();
}

export function renderHistoricoDetalhes(vendas) {
  return vendas.map(v => {
    const itens = state.vendaItensCache[v.id];
    const itensHtml = itens
      ? itens.map(it => `<div class="hist-item-row"><span>${it.quantidade}× ${esc(it.descricao)}</span><span>R$ ${(it.quantidade*Number(it.preco_unit)).toFixed(2)}</span></div>`).join('')
      : `<div class="hist-item-row" id="v-load-${v.id}" style="color:var(--muted);font-style:italic">Carregando itens…</div>`;
    const pend = Number(v.valor_total) - Number(v.valor_pago);
    return `<div class="hist-venda-bloco">
      <div class="hist-venda-head">
        <b>${formatDate(v.data_venda)} · ${v.forma_pagamento}</b>
        <span>R$ ${Number(v.valor_total).toFixed(2)} ${pend>0?`<span style="color:var(--danger)">(pendente R$ ${pend.toFixed(2)})</span>`:'<span style="color:var(--success)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> quitado</span>'}</span>
      </div>
      ${itensHtml}
    </div>`;
  }).join('');
}

export async function carregarItensDasVendas(vendas) {
  const faltam = vendas.filter(v => !state.vendaItensCache[v.id]).map(v => v.id);
  if (!faltam.length) return;
  const { data, error } = await sbQ(sb.from('venda_itens').select('*').in('venda_id', faltam).order('created_at'));
  if (error) return;
  for (const v of vendas) {
    if (!state.vendaItensCache[v.id]) state.vendaItensCache[v.id] = [];
  }
  (data || []).forEach(it => {
    if (!state.vendaItensCache[it.venda_id]) state.vendaItensCache[it.venda_id] = [];
    state.vendaItensCache[it.venda_id].push(it);
  });
  filtrarHistorico();
}
