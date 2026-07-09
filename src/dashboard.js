// Dashboard (revendedora + staff/PC) e stubs 'Em breve' das secoes do PC.
import { sb } from './supabase.js';
import { state } from './state.js';
import { sbQ, fetchPaginado, fmtBRL, esc, ehRevTeste, marcarRevsTeste } from './utils.js';
// ── Seções do dashboard PC (stubs "Em breve" — implementadas por etapa) ──
export function emBreveHtml(titulo, descricao, icone) {
  return `<div class="section-header"><div><div class="section-title">${titulo} <span class="badge-soon">Em breve</span></div></div></div>
    <div class="empty-state"><div class="empty-icon">${icone}</div><p>${descricao}</p></div>`;
}

export function loadCalculadora() {
  document.getElementById('panel-calculadora').innerHTML = emBreveHtml('Calculadora de custo',
    'Cálculo de custo das peças, leitura de foto por IA e envio ao Bling — em construção.', '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>');
}

export function loadClientes() {
  document.getElementById('panel-clientes').innerHTML = emBreveHtml('Clientes finais',
    'Base de clientes (aniversários, garantias e contato) — em construção.', '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>');
}

export function loadMarketing() {
  document.getElementById('panel-marketing').innerHTML = emBreveHtml('Marketing',
    'Aniversários de revendedoras e clientes, bônus e disparos por WhatsApp — em construção.', '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>');
}

export function loadFormasPagamento() {
  document.getElementById('panel-formas-pagamento').innerHTML = emBreveHtml('Formas de Pagamento',
    'Cadastro das formas de pagamento aceitas — em construção.', '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>');
}

export function loadCategoriasFinanceiras() {
  document.getElementById('panel-categorias-financeiras').innerHTML = emBreveHtml('Categorias Financeiras',
    'Cadastro de categorias de Despesas e Recebimentos — em construção.', '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>');
}

export async function loadDashboard() {
  if (ehStaff()) return loadDashboardStaff();   // dashboard PC (vendas/operação)
  const isAdmin = ehStaff();
  // Sem .limit(): os contadores (abertas/conserto/prontas/vencendo) precisam
  // de TODAS as garantias. Seleciona so os campos usados nos cards/contadores.
  let q = sb.from('garantias').select('id,status,prazo_maximo,created_at,descricao_item,nome_cliente,foto_url,data_entrada');
  if (!isAdmin) q = q.eq('revendedora_id', state.currentUser.id);
  const { data, error } = await sbQ(q.order('created_at', { ascending: false }));

  if (error) {
    const msg = error.message === 'timeout' ? 'Conexão lenta. Aguarde e tente novamente.' : 'Erro ao carregar dados.';
    document.getElementById('dash-recentes').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }
  if (!data) return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  const abertas = data.filter(g => g.status === 'aberta').length;
  const conserto = data.filter(g => g.status === 'em_conserto').length;
  const prontas = data.filter(g => g.status === 'pronta').length;
  const vencendo = data.filter(g => {
    const prazo = new Date(g.prazo_maximo + 'T00:00:00');
    const diff = Math.ceil((prazo - hoje) / 86400000);
    return diff <= 7 && diff >= 0 && g.status !== 'entregue';
  }).length;

  document.getElementById('s-abertas').textContent = abertas;
  document.getElementById('s-conserto').textContent = conserto;
  document.getElementById('s-prontas').textContent = prontas;
  document.getElementById('s-vencendo').textContent = vencendo;

  const sub = isAdmin ? 'Todas as revendedoras' : state.currentProfile.nome.split(' ')[0];
  document.getElementById('dash-subtitle').textContent = sub;

  const alertDiv = document.getElementById('dash-alertas');
  if (vencendo > 0) {
    alertDiv.innerHTML = `<div class="alert alert-warning"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${vencendo} garantia${vencendo>1?'s':''} vencendo em até 7 dias</div>`;
  } else alertDiv.innerHTML = '';

  const recentes = data.slice(0, 5);
  const recentDiv = document.getElementById('dash-recentes');
  if (!recentes.length) { recentDiv.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div><p>Nenhuma garantia ainda</p></div>'; return; }
  recentDiv.innerHTML = recentes.map(g => renderGarantiaCard(g)).join('');
}

// Dashboard PC (staff) estilo Zenply — vendas/operação. Cards de despesa/DRE
// ficam "Em breve" até o módulo Financeiro existir.
export async function loadDashboardStaff() {
  const panel = document.getElementById('panel-dashboard');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando dashboard...</div>';

  const [vRes, gRes, pRes] = await Promise.all([
    fetchPaginado(() => sb.from('vendas').select('valor_total,valor_pago,status,data_venda,revendedora_id')),
    sbQ(sb.from('garantias').select('status,prazo_maximo')),
    sbQ(sb.from('profiles').select('*').eq('role', 'revendedora'))
  ]);
  // Métricas de faturamento IGNORAM revendedoras TESTE (profiles.teste).
  const todasRevs = pRes.data || [];
  marcarRevsTeste(todasRevs);
  const vendas = (vRes.data || []).filter(v => !ehRevTeste(v.revendedora_id));
  const garantias = gRes.data || [];
  const revs = todasRevs.filter(r => !r.teste);
  const temTeste = todasRevs.some(r => r.teste);
  const nomeDe = {}; revs.forEach(r => { nomeDe[r.id] = r.nome; });

  const num = v => Number(v) || 0;
  const ym = d => (d || '').slice(0, 7);
  const agora = new Date();
  const ymAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const dAnt = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const ymAnt = `${dAnt.getFullYear()}-${String(dAnt.getMonth() + 1).padStart(2, '0')}`;

  let vendidoMes = 0, recebidoMes = 0, vendidoAnt = 0, aReceber = 0;
  vendas.forEach(v => {
    const m = ym(v.data_venda);
    if (m === ymAtual) { vendidoMes += num(v.valor_total); recebidoMes += num(v.valor_pago); }
    if (m === ymAnt) vendidoAnt += num(v.valor_total);
    aReceber += Math.max(0, num(v.valor_total) - num(v.valor_pago));
  });
  const variacao = vendidoAnt > 0 ? ((vendidoMes - vendidoAnt) / vendidoAnt * 100) : (vendidoMes > 0 ? 100 : 0);

  const MES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    meses.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, lbl: MES[d.getMonth()], total: 0 });
  }
  vendas.forEach(v => { const mm = meses.find(x => x.ym === ym(v.data_venda)); if (mm) mm.total += num(v.valor_total); });
  const maxMes = Math.max(1, ...meses.map(m => m.total));

  const porRev = {};
  vendas.forEach(v => { porRev[v.revendedora_id] = (porRev[v.revendedora_id] || 0) + num(v.valor_total); });
  const ranking = Object.entries(porRev).map(([id, tot]) => ({ nome: nomeDe[id] || '—', tot }))
    .sort((a, b) => b.tot - a.tot).slice(0, 5);

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diasPrazo = g => Math.ceil((new Date(g.prazo_maximo + 'T00:00:00') - hoje) / 86400000);
  const gAbertas = garantias.filter(g => g.status === 'aberta').length;
  const gConserto = garantias.filter(g => g.status === 'em_conserto').length;
  const gVencendo = garantias.filter(g => g.status !== 'entregue' && diasPrazo(g) <= 7 && diasPrazo(g) >= 0).length;
  const gAtraso = garantias.filter(g => g.status !== 'entregue' && diasPrazo(g) < 0).length;

  const revsAtivas = revs.filter(r => r.aprovada).length;
  const mesLabel = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  const pct = vendidoMes > 0 ? Math.round(recebidoMes / vendidoMes * 100) : 0;

  panel.innerHTML = `
    <div class="section-header"><div>
      <div class="section-title">Dashboard</div>
      <div class="section-subtitle">${mesLabel} · ${revsAtivas} revendedora${revsAtivas !== 1 ? 's' : ''} ativa${revsAtivas !== 1 ? 's' : ''}${temTeste ? ' · <span style="font-size:11px">totais não incluem contas de teste</span>' : ''}</div>
    </div></div>
    <div class="dash-grid">
      <div class="dash-card">
        <h3>Vendas do mês</h3><div class="dash-sub">Realizado em ${mesLabel}</div>
        <div class="dash-kpi">${fmtBRL(vendidoMes)}</div>
        <div style="font-size:12px;margin-top:6px;color:${variacao >= 0 ? 'var(--success)' : 'var(--danger)'}">
          ${variacao >= 0 ? '▲' : '▼'} ${Math.abs(variacao).toFixed(0)}% vs mês anterior (${fmtBRL(vendidoAnt)})</div>
        <div style="margin-top:16px">
          <div class="dash-row"><span>Recebido no mês</span><b style="color:var(--success)">${fmtBRL(recebidoMes)}</b></div>
          <div class="dash-row"><span>A receber (pendente)</span><b style="color:var(--danger)">${fmtBRL(aReceber)}</b></div>
        </div>
      </div>
      <div class="dash-card">
        <h3>Vendas — últimos 6 meses</h3><div class="dash-sub">Total vendido por mês</div>
        <div class="dash-bars">
          ${meses.map(m => `<div class="dash-bar-col">
            <div class="dash-bar" style="height:${Math.round(m.total / maxMes * 100)}%" title="${fmtBRL(m.total)}"></div>
            <div class="dash-bar-lbl">${m.lbl}</div></div>`).join('')}
        </div>
      </div>
      <div class="dash-card">
        <h3>Recebido do mês</h3><div class="dash-sub">% do vendido já recebido</div>
        <div class="dash-donut" style="background: conic-gradient(var(--rose) ${pct}%, var(--blush) ${pct}% 100%)"><span>${pct}%</span></div>
        <div class="dash-row"><span>Vendido</span><b>${fmtBRL(vendidoMes)}</b></div>
        <div class="dash-row"><span>Recebido</span><b style="color:var(--success)">${fmtBRL(recebidoMes)}</b></div>
      </div>
      <div class="dash-card">
        <h3>Ranking de revendedoras</h3><div class="dash-sub">Por total vendido</div>
        ${ranking.length ? ranking.map((r, i) => `<div class="dash-row"><span>${i + 1}. ${esc(r.nome)}</span><b>${fmtBRL(r.tot)}</b></div>`).join('') : '<div class="dash-sub">Sem vendas ainda.</div>'}
      </div>
      <div class="dash-card">
        <h3>Garantias</h3><div class="dash-sub">Situação atual</div>
        <div class="dash-row"><span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#3f7fe0;margin-right:5px;vertical-align:middle"></span>Abertas</span><b>${gAbertas}</b></div>
        <div class="dash-row"><span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warning);margin-right:5px;vertical-align:middle"></span>Em conserto</span><b>${gConserto}</b></div>
        <div class="dash-row"><span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Vencendo (7 dias)</span><b style="color:var(--warning)">${gVencendo}</b></div>
        <div class="dash-row"><span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;vertical-align:middle"></span>Em atraso</span><b style="color:var(--danger)">${gAtraso}</b></div>
      </div>
      <div class="dash-card">
        <h3>Demonstração de Resultados <span class="badge-soon">Em breve</span></h3>
        <div class="dash-sub">Despesas, lucro e DRE chegam com o módulo Financeiro</div>
        <div class="empty-state" style="padding:18px 0"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div><p style="font-size:12px">Em construção</p></div>
      </div>
    </div>`;
}
