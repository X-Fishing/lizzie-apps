// Dashboard (revendedora + staff/PC) e stubs 'Em breve' das secoes do PC.
import { sb } from './supabase.js';
import { state } from './state.js';
import { sbQ, fetchPaginado, fmtBRL, esc, ehRevTeste, marcarRevsTeste } from './utils.js';
import { avatarHtml, urlFotoPerfil } from './perfil.js';
// ── Seções do dashboard PC (stubs "Em breve" — implementadas por etapa) ──
export function emBreveHtml(titulo, descricao, icone) {
  return `<div class="section-header"><div><div class="section-title">${titulo} <span class="badge-soon">Em breve</span></div></div></div>
    <div class="empty-state"><div class="empty-icon">${icone}</div><p>${descricao}</p></div>`;
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

// Dashboard da REVENDEDORA: foto de perfil, régua de vendas (faixas de
// comissão + raspadinha), comissão estimada e resumo de garantias.
// SEMPRE rebusca do Supabase ao montar (nada de cache local de vendas).
export async function loadDashboard() {
  if (ehStaff()) return loadDashboardStaff();   // dashboard PC (vendas/operação)
  const panel = document.getElementById('panel-dashboard');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const uid = state.currentUser.id;

  // Buscas em paralelo (garantias, maleta ativa, faixas, raspadinha, peças).
  const [gRes, mRes, fxRes, rspRes, cRes] = await Promise.all([
    sbQ(sb.from('garantias').select('id,status,prazo_maximo,created_at,descricao_item,nome_cliente,foto_url,data_entrada')
      .eq('revendedora_id', uid).order('created_at', { ascending: false })),
    sbQ(sb.from('maletas').select('id').eq('revendedora_id', uid).eq('status', 'ativa').maybeSingle()),
    sbQ(sb.from('faixas_comissao').select('valor_min,valor_max,percentual').eq('ativo', true).order('valor_min')),
    sbQ(sb.from('config_raspadinha').select('valor_por_raspadinha').eq('ativo', true).limit(1)),
    sbQ(sb.from('consignados').select('quantidade_vendida,preco_venda,maleta_id')
      .eq('revendedora_id', uid).eq('status', 'ativo')),
  ]);

  if (gRes.error || cRes.error) {
    const err = gRes.error || cRes.error;
    const msg = err.message === 'timeout' ? 'Conexão lenta. Aguarde e tente novamente.' : 'Erro ao carregar dados.';
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }

  const garantias = gRes.data || [];
  const maletaId = mRes.data?.id || null;
  const faixas = fxRes.data || [];               // pode falhar se SQL não rodou -> régua se adapta
  const valorRaspadinha = Number(rspRes.data?.[0]?.valor_por_raspadinha || 0);

  // ── Faturamento da maleta vigente (mesma base do fechamento) ──
  const pecas = (cRes.data || []).filter(c => !maletaId || c.maleta_id === maletaId);
  const fat = pecas.reduce((s, c) => s + (c.quantidade_vendida || 0) * Number(c.preco_venda || 0), 0);

  // ── Faixa atual / próxima ──
  const dentro = f => Number(f.valor_min) <= fat && (f.valor_max == null || fat <= Number(f.valor_max));
  const faixaAtual = [...faixas].reverse().find(dentro) || null;
  const proxFaixa = faixas.find(f => Number(f.valor_min) > fat) || null;
  const pctAtual = faixaAtual ? Number(faixaAtual.percentual) : 0;
  const comissao = fat * pctAtual / 100;

  // ── Régua (escala: do zero ao início da última faixa, ou além se já passou) ──
  const topoEscala = Math.max(fat, ...faixas.map(f => Number(f.valor_min)), 1) * 1.05;
  const pctBarra = Math.min(100, fat / topoEscala * 100);
  const marcadores = faixas.filter(f => Number(f.valor_min) > 0).map(f => {
    const left = Math.min(100, Number(f.valor_min) / topoEscala * 100);
    const atingida = fat >= Number(f.valor_min);
    return `<div class="regua-marker${atingida ? ' ok' : ''}" style="left:${left}%" title="${fmtBRL(f.valor_min)} · ${Number(f.percentual)}%"></div>`;
  }).join('');

  const txtProxima = !faixas.length
    ? '<span style="color:var(--muted)">Faixas de comissão ainda não configuradas.</span>'
    : (proxFaixa
      ? `Faltam <b>${fmtBRL(Number(proxFaixa.valor_min) - fat)}</b> para a faixa de <b>${Number(proxFaixa.percentual).toLocaleString('pt-BR')}%</b> (a partir de ${fmtBRL(proxFaixa.valor_min)})`
      : '<b style="color:var(--success)">Você está na faixa máxima!</b>');

  // ── Raspadinha (a cada X vendidos, ganha 1) ──
  let htmlRaspadinha = '';
  if (valorRaspadinha > 0) {
    const ganhas = Math.floor(fat / valorRaspadinha);
    const resto = fat % valorRaspadinha;
    const falta = resto === 0 ? valorRaspadinha : valorRaspadinha - resto;
    htmlRaspadinha = `<div class="regua-rasp">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>
      Faltam <b>${fmtBRL(falta)}</b> para sua próxima raspadinha!
      <span class="regua-rasp-count">${ganhas} conquistada${ganhas !== 1 ? 's' : ''}</span>
    </div>`;
  }

  // ── Garantias (contadores + alerta + recentes) ──
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const abertas = garantias.filter(g => g.status === 'aberta').length;
  const conserto = garantias.filter(g => g.status === 'em_conserto').length;
  const prontas = garantias.filter(g => g.status === 'pronta').length;
  const vencendo = garantias.filter(g => {
    const diff = Math.ceil((new Date(g.prazo_maximo + 'T00:00:00') - hoje) / 86400000);
    return diff <= 7 && diff >= 0 && g.status !== 'entregue';
  }).length;
  const alertaHtml = vencendo > 0
    ? `<div class="alert alert-warning"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${vencendo} garantia${vencendo > 1 ? 's' : ''} vencendo em até 7 dias</div>`
    : '';
  const recentes = garantias.slice(0, 5);
  const recentesHtml = recentes.length
    ? recentes.map(g => renderGarantiaCard(g)).join('')
    : '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg></div><p>Nenhuma garantia ainda</p></div>';

  // ── Foto de perfil (URL assinada; bucket privado) ──
  const fotoUrl = await urlFotoPerfil();
  const nome = state.currentProfile.nome || '';

  panel.innerHTML = `
    <div class="section-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="position:relative;cursor:pointer" onclick="perfilAbrirFoto()" title="Alterar foto de perfil">
          ${avatarHtml(nome, fotoUrl, 54)}
          <span class="avatar-edit"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></span>
        </div>
        <div>
          <div class="section-title">Olá, ${esc(nome.split(' ')[0])}!</div>
          <div class="section-subtitle">${maletaId ? 'Sua maleta atual' : 'Sem maleta ativa no momento'}</div>
        </div>
      </div>
    </div>

    <div class="card regua-card">
      <div class="regua-topo">
        <div>
          <div class="regua-label">Vendas nesta maleta</div>
          <div class="regua-valor">${fmtBRL(fat)}</div>
        </div>
        <div style="text-align:right">
          <div class="regua-label">Comissão estimada${pctAtual ? ` (${pctAtual.toLocaleString('pt-BR')}%)` : ''}</div>
          <div class="regua-valor" style="color:var(--success)">${fmtBRL(comissao)}</div>
        </div>
      </div>
      <div class="regua-bar"><div class="regua-fill" style="width:${pctBarra}%"></div>${marcadores}</div>
      <div class="regua-texto">${txtProxima}</div>
      ${htmlRaspadinha}
      <div class="regua-obs">Valores aproximados, sujeitos ao fechamento da maleta.</div>
    </div>

    <div class="stats-grid" id="dash-stats">
      <div class="stat-card"><div class="stat-num stat-info">${abertas}</div><div class="stat-label">Em aberto</div></div>
      <div class="stat-card"><div class="stat-num stat-gold">${conserto}</div><div class="stat-label">Em conserto</div></div>
      <div class="stat-card stat-green"><div class="stat-num" style="color:var(--success)">${prontas}</div><div class="stat-label">Prontas</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--danger)">${vencendo}</div><div class="stat-label">Vencendo</div></div>
    </div>
    ${alertaHtml}
    <div class="section-header" style="margin-top:4px">
      <div class="section-title" style="font-size:18px">Garantias recentes</div>
    </div>
    <div id="dash-recentes">${recentesHtml}</div>`;
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

  let vendidoMes = 0, recebidoMes = 0, vendidoAnt = 0, aReceber = 0, vendasMesCount = 0;
  vendas.forEach(v => {
    const m = ym(v.data_venda);
    if (m === ymAtual) { vendidoMes += num(v.valor_total); recebidoMes += num(v.valor_pago); vendasMesCount++; }
    if (m === ymAnt) vendidoAnt += num(v.valor_total);
    aReceber += Math.max(0, num(v.valor_total) - num(v.valor_pago));
  });
  const ticketMedio = vendasMesCount > 0 ? vendidoMes / vendasMesCount : 0;
  const variacao = vendidoAnt > 0 ? ((vendidoMes - vendidoAnt) / vendidoAnt * 100) : (vendidoMes > 0 ? 100 : 0);

  const MES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    meses.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, lbl: MES[d.getMonth()], total: 0 });
  }
  vendas.forEach(v => { const mm = meses.find(x => x.ym === ym(v.data_venda)); if (mm) mm.total += num(v.valor_total); });
  const maxMes = Math.max(1, ...meses.map(m => m.total));

  const porRev = {}, porRevCount = {};
  vendas.forEach(v => {
    porRev[v.revendedora_id] = (porRev[v.revendedora_id] || 0) + num(v.valor_total);
    porRevCount[v.revendedora_id] = (porRevCount[v.revendedora_id] || 0) + 1;
  });
  const ranking = Object.entries(porRev).map(([id, tot]) => ({ id, nome: nomeDe[id] || '—', tot, n: porRevCount[id] || 0 }))
    .sort((a, b) => b.tot - a.tot).slice(0, 5);

  // Barras dos últimos 7 dias (agrega o MESMO array vendas por dia).
  const DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const dias7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - i);
    dias7.push({ iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, lbl: DIA[d.getDay()], total: 0 });
  }
  vendas.forEach(v => { const dd = dias7.find(x => (v.data_venda || '').slice(0, 10) === x.iso); if (dd) dd.total += num(v.valor_total); });
  const max7 = Math.max(1, ...dias7.map(d => d.total));

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diasPrazo = g => Math.ceil((new Date(g.prazo_maximo + 'T00:00:00') - hoje) / 86400000);
  const gAbertas = garantias.filter(g => g.status === 'aberta').length;
  const gConserto = garantias.filter(g => g.status === 'em_conserto').length;
  const gVencendo = garantias.filter(g => g.status !== 'entregue' && diasPrazo(g) <= 7 && diasPrazo(g) >= 0).length;
  const gAtraso = garantias.filter(g => g.status !== 'entregue' && diasPrazo(g) < 0).length;

  const revsAtivas = revs.filter(r => r.aprovada).length;
  const mesLabel = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  const pct = vendidoMes > 0 ? Math.round(recebidoMes / vendidoMes * 100) : 0;

  const IC_MONEY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
  const IC_BAG   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
  const IC_TICKET = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
  const IC_CLOCK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  const primeiroNome = (state.currentProfile?.nome || '').split(' ')[0] || 'Dashboard';
  const iniciais = n => (n || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const diasAtras = iso => { const d = new Date((iso || '').slice(0, 10) + 'T00:00:00'); const n2 = Math.round((hoje - d) / 86400000); return n2 <= 0 ? 'hoje' : n2 === 1 ? 'ontem' : `há ${n2}d`; };
  const atividades = [...vendas].sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || '')).slice(0, 6)
    .map(v => ({ texto: `Venda de ${fmtBRL(num(v.valor_total))}${nomeDe[v.revendedora_id] ? ' — ' + nomeDe[v.revendedora_id] : ''}`, tempo: diasAtras(v.data_venda) }));

  panel.innerHTML = `
    <div class="page-head"><div>
      <h2>Olá, ${esc(primeiroNome)}</h2>
      <div class="sub">${mesLabel} · ${revsAtivas} revendedora${revsAtivas !== 1 ? 's' : ''} ativa${revsAtivas !== 1 ? 's' : ''}${temTeste ? ' · totais não incluem contas de teste' : ''}</div>
    </div></div>
    <div class="dash-grid" style="grid-template-columns:1.6fr 1fr;margin-bottom:16px">
      <div class="dash-card">
        <h3>Vendas nos últimos 7 dias</h3><div class="dash-sub">Total vendido por dia</div>
        <div class="dash-bars">
          ${dias7.map(d => `<div class="dash-bar-col">
            <div class="dash-bar" style="height:${Math.round(d.total / max7 * 100)}%" title="${fmtBRL(d.total)}"></div>
            <div class="dash-bar-lbl">${d.lbl}</div></div>`).join('')}
        </div>
      </div>
      <div class="dash-card">
        <h3>Top revendedoras</h3><div class="dash-sub">Por total vendido no período</div>
        ${ranking.length ? ranking.map(r => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0">
          <div style="width:30px;height:30px;border-radius:9px;background:var(--blush);color:var(--rose);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none">${iniciais(r.nome)}</div>
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--plum);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.nome)}</div><div style="font-size:11px;color:var(--muted)">${r.n} venda${r.n !== 1 ? 's' : ''}</div></div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--plum)">${fmtBRL(r.tot)}</div>
        </div>`).join('') : '<div class="dash-sub">Sem vendas ainda.</div>'}
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Faturamento do mês</span><span class="kpi-ic">${IC_MONEY}</span></div>
        <div class="kpi-val">${fmtBRL(vendidoMes)}</div>
        <div class="kpi-delta ${variacao >= 0 ? 'up' : 'down'}">${variacao >= 0 ? '▲' : '▼'} ${Math.abs(variacao).toFixed(0)}% vs mês anterior</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Vendas no mês</span><span class="kpi-ic">${IC_BAG}</span></div>
        <div class="kpi-val">${vendasMesCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">Ticket médio</span><span class="kpi-ic">${IC_TICKET}</span></div>
        <div class="kpi-val">${fmtBRL(ticketMedio)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><span class="kpi-label">A receber</span><span class="kpi-ic">${IC_CLOCK}</span></div>
        <div class="kpi-val" style="color:var(--danger)">${fmtBRL(aReceber)}</div>
      </div>
    </div>
    <div class="dash-grid">
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
    </div>
    <div class="dash-card" style="margin-top:16px">
      <h3>Atividade recente</h3><div class="dash-sub">Últimas vendas</div>
      ${atividades.length ? atividades.map(a => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:9px;background:rgba(76,175,130,0.12);color:var(--success);display:flex;align-items:center;justify-content:center;flex:none">${IC_MONEY}</div>
        <div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text)">${esc(a.texto)}</div><div style="font-size:11px;color:var(--muted)">${a.tempo}</div></div>
      </div>`).join('') : '<div class="dash-sub">Sem vendas recentes.</div>'}
    </div>`;
}
