// Trocas: proximas trocas por revendedora (a partir de pedidos Bling) + painel.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast, confirmarAcao } from './utils.js';
import { fetchTodosBling, SITUACAO_ABERTO } from './bling.js';
export async function carregarProximasTrocas(forcar = false) {
  if (state.proximaTrocaCarregado && !forcar) return true;
  if (state.proximaTrocaPromessa && !forcar) return state.proximaTrocaPromessa;
  state.proximaTrocaPromessa = _carregarProximasTrocasImpl();
  try { return await state.proximaTrocaPromessa; }
  finally { state.proximaTrocaPromessa = null; }
}

export async function _carregarProximasTrocasImpl() {
  const hoje = new Date().toISOString().split('T')[0];
  const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 6);
  const todos = await fetchTodosBling(inicio.toISOString().split('T')[0], hoje);
  if (!todos) return false;
  console.log('[trocas] janela:', inicio.toISOString().split('T')[0], '→', hoje, '| total pedidos:', todos.length);

  // Agrupa por contato.id, mantendo só os pedidos EM ABERTO
  const abertosPorContato = {};
  const todosPorContato = {};
  for (const p of todos) {
    const cid = String(p.contato?.id || '');
    if (!cid || !p.data) continue;
    (todosPorContato[cid] = todosPorContato[cid] || []).push(p);
    if (p.situacao?.id === SITUACAO_ABERTO) {
      (abertosPorContato[cid] = abertosPorContato[cid] || []).push(p);
    }
  }

  state.proximaTrocaMap = {};
  // Para cada contato: escolhe o pedido que representa a próxima troca
  // (entre os abertos, prioriza os COM dataPrevista válida — clones de
  // fechamento normalmente vêm sem dataPrevista).
  for (const [cid, todasDoContato] of Object.entries(todosPorContato)) {
    todasDoContato.sort((a, b) => b.data.localeCompare(a.data));
    const aberto = abertosPorContato[cid] || [];
    let escolhido = null;
    if (aberto.length) {
      const comData = aberto.filter(p => p.dataPrevista && p.dataPrevista !== '0000-00-00');
      if (comData.length) {
        comData.sort((a, b) => b.data.localeCompare(a.data));
        escolhido = comData[0];
      } else {
        aberto.sort((a, b) => b.data.localeCompare(a.data));
        escolhido = aberto[0];
      }
    }
    const dp = escolhido?.dataPrevista && escolhido.dataPrevista !== '0000-00-00' ? escolhido.dataPrevista : null;
    state.proximaTrocaMap[cid] = {
      dataPrevista: dp,
      dataPedido: escolhido?.data || todasDoContato[0].data,
      nome: todasDoContato[0].contato?.nome || '',
      abertos: aberto.length,
      temAberto: aberto.length > 0,
      ultimaTroca: todasDoContato[1]?.data || null
    };
  }

  state.proximaTrocaCarregado = true;

  // Diagnóstico — ajuda quando algum ID aprovado não aparece
  const idsAprovados = new Set((state.aprovadasCache || []).map(r => String(r.bling_contato_id || '')).filter(Boolean));
  const semPedido = [...idsAprovados].filter(id => !todosPorContato[id]);
  if (semPedido.length) {
    const aprovadasPorId = Object.fromEntries((state.aprovadasCache || []).map(r => [String(r.bling_contato_id || ''), r.nome]));
    const desaparecidas = semPedido.map(id => `${id}=${aprovadasPorId[id] || '?'}`);
    const idsNoBling = Object.entries(todosPorContato)
      .map(([id, lista]) => `${id}=${lista[0].contato?.nome || '?'}`);
    console.warn('[trocas] APROVADAS sem pedido:\n  ' + desaparecidas.join('\n  '));
    console.log('[trocas] IDs encontrados no Bling (' + idsNoBling.length + '):\n  ' + idsNoBling.join('\n  '));
  } else {
    console.log('[trocas] todos os IDs aprovados têm pedido na janela');
  }
  return true;
}

export function infoProximaTroca(blingId) {
  if (!blingId) return { status: 'sem-vinculo' };
  const e = state.proximaTrocaMap[String(blingId)];
  if (!e) return { status: 'sem-pedido' };
  if (!e.temAberto) return { status: 'sem-aberto', dataPedido: e.dataPedido, abertos: 0 };
  if (!e.dataPrevista) return { status: 'sem-data', dataPedido: e.dataPedido, abertos: e.abertos };
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const prev = new Date(e.dataPrevista + 'T00:00:00');
  const dias = Math.round((prev - hoje) / 86400000);
  let status = 'normal';
  if (dias < 0) status = 'vencida';
  else if (dias <= 7) status = 'proximo';
  return { status, dataPrevista: e.dataPrevista, diasRestantes: dias, dataPedido: e.dataPedido, abertos: e.abertos };
}

// Carrega as maletas ATIVAS do app com data de troca (hibrido: a maleta manda).
export async function carregarMaletasTroca() {
  state.maletasTrocaMap = {};
  const { data } = await sbQ(sb.from('maletas').select('*').eq('status', 'ativa'));
  (data || []).forEach(m => {
    if (m.data_troca) state.maletasTrocaMap[m.revendedora_id] = { dataTroca: m.data_troca, criadaEm: m.created_at };
  });
}

// Info de troca a partir de uma data conhecida. refDate identifica o "ciclo" desta
// troca (p/ saber se uma resolucao antiga ainda vale) — usa a criacao da maleta,
// pra funcionar mesmo com data de troca no futuro.
function infoDaData(dataIso, refDate) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const prev = new Date(dataIso + 'T00:00:00');
  const dias = Math.round((prev - hoje) / 86400000);
  let status = 'normal';
  if (dias < 0) status = 'vencida';
  else if (dias <= 7) status = 'proximo';
  return { status, dataPrevista: dataIso, diasRestantes: dias, dataPedido: refDate || dataIso, abertos: 0, fonte: 'maleta' };
}

// Hibrido: se a revendedora tem maleta ativa no app com data_troca, ela manda;
// senao cai no calculo do Bling.
export function infoTrocaRev(r) {
  const m = state.maletasTrocaMap[r.id];
  if (m) return infoDaData(m.dataTroca, m.criadaEm);
  return infoProximaTroca(r.bling_contato_id);
}

// Finaliza a troca direto na tela de Trocas (sai da lista ate a proxima maleta/
// pedido). Serve p/ trocas do Bling, que nao tem "Finalizar catalogo" no app.
// Reversivel: reaparece quando surge maleta/pedido mais novo.
export function resolverTroca(revId) {
  const r = state.aprovadasCache.find(x => x.id === revId);
  const nome = r ? r.nome : 'esta revendedora';
  confirmarAcao('Finalizar troca', `Marcar a troca de ${nome} como feita?\n\nEla sai da lista de trocas e volta quando tiver uma maleta ou pedido novo.`, 'Finalizar', async () => {
    const { error } = await sbQ(sb.from('profiles').update({ troca_resolvida_em: new Date().toISOString() }).eq('id', revId));
    if (error) { toast('Erro ao finalizar troca'); return; }
    toast('Troca finalizada');
    state.aprovadasCache = [];
    loadTrocasDashboard();
  });
}

export function renderProximaTrocaBadge(info) {
  const aviso = info.abertos > 1
    ? ` <span style="color:var(--warning);font-weight:600">· <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${info.abertos} em aberto</span>`
    : '';
  if (info.status === 'sem-vinculo') return `<span style="font-size:11px;color:var(--muted)">Sem vínculo Bling</span>`;
  if (info.status === 'sem-pedido') return `<span style="font-size:11px;color:var(--muted)">Sem pedidos nos últimos 6 meses</span>`;
  if (info.status === 'sem-aberto') return `<span style="font-size:11px;color:var(--muted)">Sem maleta em aberto</span>`;
  if (info.status === 'sem-data') return `<span style="font-size:11px;color:var(--muted)">Próxima troca não informada no Bling${aviso}</span>`;
  if (info.status === 'vencida') {
    const d = -info.diasRestantes;
    return `<span style="font-size:11px;color:var(--danger);font-weight:600"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> Troca vencida há ${d} dia${d!==1?'s':''}</span>${aviso}`;
  }
  if (info.status === 'proximo') {
    return `<span style="font-size:11px;color:var(--warning);font-weight:600"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Próxima troca: ${formatDate(info.dataPrevista)} (em ${info.diasRestantes} dia${info.diasRestantes!==1?'s':''})</span>${aviso}`;
  }
  return `<span style="font-size:11px;color:var(--muted)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Próxima troca: ${formatDate(info.dataPrevista)}${aviso}</span>`;
}

export const PRIORIDADE_TROCA = { vencida: 0, proximo: 1, normal: 2, 'sem-data': 3, 'sem-aberto': 4, 'sem-pedido': 5, 'sem-vinculo': 6 };

export function compararPorTroca(a, b) {
  const ia = infoTrocaRev(a);
  const ib = infoTrocaRev(b);
  const pa = PRIORIDADE_TROCA[ia.status] ?? 9;
  const pb = PRIORIDADE_TROCA[ib.status] ?? 9;
  if (pa !== pb) return pa - pb;
  if (ia.dataPrevista && ib.dataPrevista) return ia.dataPrevista.localeCompare(ib.dataPrevista);
  return (a.nome || '').localeCompare(b.nome || '');
}

export async function atualizarBadgesTroca() {
  const ok = await carregarProximasTrocas();
  if (!ok) {
    document.querySelectorAll('[data-troca-bling-id]').forEach(el => {
      el.innerHTML = `<span style="font-size:11px;color:var(--muted)">Erro ao consultar Bling</span>`;
    });
    return;
  }
  document.querySelectorAll('[data-troca-bling-id]').forEach(el => {
    const id = el.getAttribute('data-troca-bling-id');
    el.innerHTML = renderProximaTrocaBadge(infoProximaTroca(id));
  });
  const ct = document.getElementById('troca-count');
  if (ct) {
    const n = state.aprovadasCache.filter(r => {
      const i = infoProximaTroca(r.bling_contato_id);
      return i.status === 'vencida' || i.status === 'proximo';
    }).length;
    ct.textContent = n ? ` · ${n} com troca próxima` : '';
  }
}

export function toggleOrdemTroca() {
  state.ordemTrocaProxima = !state.ordemTrocaProxima;
  renderAprovadas();
}

export const TROCAS_FILTROS = [
  { id: 'todas', label: 'Todas' },
  { id: 'vencidas', label: '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;vertical-align:middle"></span>Vencidas' },
  { id: 'proximos-7', label: '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#e8932f;margin-right:5px;vertical-align:middle"></span>Próximos 7 dias' },
  { id: 'proximos-30', label: '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--success);margin-right:5px;vertical-align:middle"></span>Próximos 30 dias' },
  { id: 'sem-data', label: 'Sem data' },
  { id: 'sem-vinculo', label: 'Sem vínculo' }
];

export function trocaMatchFiltro(rev, filtro) {
  const info = infoTrocaRev(rev);
  switch (filtro) {
    case 'todas': return true;
    case 'vencidas': return info.status === 'vencida';
    case 'proximos-7': return info.status === 'proximo';
    case 'proximos-30': return (info.status === 'proximo' || info.status === 'normal') && info.diasRestantes >= 0 && info.diasRestantes <= 30;
    case 'sem-data': return info.status === 'sem-data' || info.status === 'sem-aberto';
    case 'sem-vinculo': return info.status === 'sem-vinculo';
  }
  return true;
}

// Troca "resolvida": marcada ao Finalizar catálogo (profiles.troca_resolvida_em).
// Esconde a revendedora da lista enquanto a resolução cobre o pedido atual;
// reaparece sozinha quando surge uma maleta/pedido mais novo (data maior).
export function trocaResolvida(r) {
  if (!r.troca_resolvida_em) return false;
  const dp = infoTrocaRev(r).dataPedido;
  if (!dp) return false;
  return r.troca_resolvida_em >= dp; // compara timestamps completos (trata mesmo-dia)
}

export function isoNoMesAtual(iso) {
  if (!iso) return false;
  const hoje = new Date();
  const d = new Date(iso + 'T00:00:00');
  return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
}

export function whatsappLink(telefone, mensagem) {
  const tel = (telefone || '').replace(/\D/g, '');
  if (!tel) return null;
  const cel = tel.startsWith('55') ? tel : '55' + tel;
  return `https://wa.me/${cel}?text=${encodeURIComponent(mensagem)}`;
}

export function mensagemTroca(nome, dataIso) {
  if (dataIso) {
    const [y, m, d] = dataIso.split('T')[0].split('-');
    const ddmm = `${d}/${m}`;
    return `Bom dia amor, tudo bem??\n\nAqui é a Gabi, estou entrando em contato porque a troca da sua maleta está chegando, dia ${ddmm} está tudo certo para você vir??`;
  }
  return `Bom dia amor, tudo bem??\n\nAqui é a Gabi, estou entrando em contato para combinarmos a troca da sua maleta, qual o melhor dia para você vir??`;
}

export async function loadTrocasDashboard() {
  const stats = document.getElementById('trocas-stats');
  const lista = document.getElementById('trocas-lista');
  const filtros = document.getElementById('trocas-filtros');
  lista.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando trocas...</div>';
  stats.innerHTML = '';
  filtros.innerHTML = '';

  if (!state.aprovadasCache.length) {
    const { data } = await sb.from('profiles').select('*').eq('is_revendedora', true).eq('aprovada',true).order('nome');
    state.aprovadasCache = data || [];
  }
  const ok = await carregarProximasTrocas();
  await carregarMaletasTroca();
  if (!ok) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>Erro ao consultar Bling.</p></div>';
    return;
  }
  renderTrocas();
}

export function renderTrocas() {
  const stats = document.getElementById('trocas-stats');
  const filtros = document.getElementById('trocas-filtros');
  const lista = document.getElementById('trocas-lista');
  if (!stats || !filtros || !lista) return;

  // Stats
  let vencidas = 0, prox7 = 0, noMes = 0, semVinculo = 0;
  for (const r of state.aprovadasCache) {
    if (trocaResolvida(r)) continue; // resolvida: fora dos contadores tambem
    const info = infoTrocaRev(r);
    if (info.status === 'vencida') vencidas++;
    if (info.status === 'proximo') prox7++;
    if (info.dataPrevista && isoNoMesAtual(info.dataPrevista)) noMes++;
    if (info.status === 'sem-vinculo') semVinculo++;
  }
  const kpi = (lbl, val, cor) => `<div class="kpi-card" style="border-left:3px solid ${cor}"><div class="kpi-top"><span class="kpi-label">${lbl}</span></div><div class="kpi-val" style="color:${cor}">${val}</div></div>`;
  stats.innerHTML =
    kpi('Vencidas', vencidas, 'var(--danger)') +
    kpi('Próximos 7 dias', prox7, '#e8932f') +
    kpi('Este mês', noMes, 'var(--success)') +
    kpi('Sem data / vínculo', semVinculo, 'var(--muted)');

  // Busca renderizada UMA vez (fora do renderTrocasLista) — senão o input era
  // recriado a cada tecla e o foco se perdia.
  filtros.innerHTML = `<input type="text" class="form-control" placeholder="Buscar revendedora..." value="${esc(state.trocaBusca || '')}" oninput="trocaBuscar(this.value)">`;

  renderTrocasLista();
}

// Só a lista (agrupada por urgência). A busca chama SÓ isto, preservando o foco.
function renderTrocasLista() {
  const lista = document.getElementById('trocas-lista');
  if (!lista) return;
  const t = (state.trocaBusca || '').trim().toLowerCase();
  let itens = state.aprovadasCache.filter(r => !trocaResolvida(r));
  if (t) itens = itens.filter(r => (r.nome || '').toLowerCase().includes(t) || (r.telefone || '').includes(t));

  const g = { venc: [], p7: [], mes: [], frente: [], sem: [] };
  for (const r of itens) {
    const info = infoTrocaRev(r);
    if (info.status === 'vencida') g.venc.push(r);
    else if (info.status === 'proximo') g.p7.push(r);
    else if (info.status === 'normal') (isoNoMesAtual(info.dataPrevista) ? g.mes : g.frente).push(r);
    else g.sem.push(r);
  }
  const secoes = [
    { itens: g.venc, label: 'Vencidas', cor: 'var(--danger)' },
    { itens: g.p7, label: 'Próximos 7 dias', cor: '#e8932f' },
    { itens: g.mes, label: 'Este mês', cor: 'var(--success)' },
    { itens: g.frente, label: 'Mais à frente', cor: 'var(--plum)' },
    { itens: g.sem, label: 'Sem data / vínculo', cor: 'var(--muted)' },
  ].filter(s => s.itens.length);

  if (!secoes.length) {
    lista.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div><p>Nenhuma revendedora encontrada.</p></div>';
    return;
  }
  lista.innerHTML = secoes.map(s => {
    s.itens.sort(compararPorTroca);
    return `<div style="margin:18px 0 10px;display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;color:var(--plum)">
        <span style="width:9px;height:9px;border-radius:50%;background:${s.cor};display:inline-block"></span>${s.label}
        <span style="color:var(--muted);font-weight:400;font-size:12px">${s.itens.length} revendedora${s.itens.length !== 1 ? 's' : ''}</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">${s.itens.map(r => renderTrocaRow(r, s.cor)).join('')}</div>`;
  }).join('');
}

export function trocaBuscar(v) { state.trocaBusca = v; renderTrocasLista(); }

export function setTrocaFiltro(id) {
  state.trocasFiltroAtivo = id;
  renderTrocas();
}

export function renderTrocaRow(r, cor = 'var(--muted)') {
  const info = infoTrocaRev(r);
  const inicial = (r.nome || '?').charAt(0).toUpperCase();
  const tel = (r.telefone || '').trim();

  let dcor = 'var(--muted)', dataTxt = '—', diasTxt = '';
  if (info.status === 'vencida') { dcor = 'var(--danger)'; dataTxt = formatDate(info.dataPrevista); diasTxt = `venceu há ${-info.diasRestantes}d`; }
  else if (info.status === 'proximo') { dcor = 'var(--warning)'; dataTxt = formatDate(info.dataPrevista); diasTxt = `em ${info.diasRestantes}d`; }
  else if (info.status === 'normal') { dcor = 'var(--plum)'; dataTxt = formatDate(info.dataPrevista); diasTxt = `em ${info.diasRestantes}d`; }
  else if (info.status === 'sem-aberto') dataTxt = 'Sem maleta';
  else if (info.status === 'sem-data') dataTxt = 'Sem data';
  else if (info.status === 'sem-pedido') dataTxt = 'Sem pedidos 6m';
  else if (info.status === 'sem-vinculo') dataTxt = 'Sem vínculo';

  const ultima = info.ultimaTroca ? `Última: ${formatDate(info.ultimaTroca)}` : 'Sem troca anterior';
  const aviso = info.abertos > 1
    ? `<div style="font-size:11px;color:var(--warning);font-weight:600;margin-top:8px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${info.abertos} pedidos em aberto</div>`
    : '';

  const waUrl = whatsappLink(tel, mensagemTroca(r.nome, info.dataPrevista));
  const avisar = waUrl
    ? `<a href="${waUrl}" target="_blank" rel="noopener" class="btn" style="flex:1;background:#25d366;color:#fff;text-decoration:none;justify-content:center;gap:6px" onclick="event.stopPropagation()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Avisar</a>`
    : `<span class="btn" style="flex:1;justify-content:center;opacity:.5">Sem telefone</span>`;
  const feita = `<button class="btn btn-outline" style="justify-content:center;gap:6px" onclick="event.stopPropagation();resolverTroca('${r.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Feita</button>`;

  return `<div class="card" onclick="verRevendedora('${r.id}')" style="cursor:pointer;border-left:3px solid ${cor}">
    <div style="display:flex;gap:12px;align-items:flex-start">
      <div class="rev-avatar">${inicial}</div>
      <div style="flex:1;min-width:0">
        <div class="rev-nome">${esc(r.nome)}</div>
        <div class="rev-cidade">${tel ? esc(tel) : 'sem telefone'} · ${ultima}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <div style="font-family:'Cormorant Garamond',serif;font-size:16px;color:${dcor}">${dataTxt}</div>
        ${diasTxt ? `<div style="font-size:10.5px;color:${dcor};text-transform:uppercase;letter-spacing:.3px">${diasTxt}</div>` : ''}
      </div>
    </div>
    ${aviso}
    <div style="display:flex;gap:8px;margin-top:12px">${avisar}${feita}</div>
  </div>`;
}
