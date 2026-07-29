// Conciliação Bancária: junta a ideia do Zenplay (ver movimentações + categoria
// fácil) com a do Tiny (baixa em lote + histórico). Importa extrato OFX,
// sugere candidatos por valor exato + data próxima, permite escolher na mão,
// e dá baixa nos títulos (financeiro_lancamentos/contas_a_pagar) em lote.
// "Desconciliar" é soft (nunca apaga): volta o título a aberto/pendente e
// guarda motivo, igual ao padrão de estorno do financeiro.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, toast, sbQ, fmtBRL, formatDate, openModal, closeModal, confirmarAcao, handleSupabaseError, debounce } from './utils.js';
import { ehGestor } from './auth.js';
import { cadastroCache } from './cadastros.js';

const IC_X    = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const IC_UNDO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
const IC_CHEV = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const IC_BANK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6 12 3l7 3"/><path d="M4 10v11"/><path d="M20 10v11"/><path d="M8 14v3"/><path d="M12 14v3"/><path d="M16 14v3"/></svg>';

let bancoContas = [];
let contaAtual = null;
let movimentos = [];
let candidatosPorMov = {};   // movId -> [{tipo,id,titulo,data,valor}]
let escolhaPorMov = {};      // movId -> candidato escolhido (auto ou manual)
let buscaManualAberta = null; // movId com a busca manual aberta
let resultadosManuaisPorMov = {};
let abaAtual = 'movimentos';  // 'movimentos' | 'historico'
let historico = [];
let historicoCarregado = false;
let itensAbertos = null;      // conciliacao_id expandido no histórico

const panel = () => document.getElementById('panel-conciliacao');

export async function loadConciliacao() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from('banco_contas').select('*').order('nome'));
  if (error) {
    const dica = /relation|schema cache/i.test(error.message || '') ? ' Rode as migrações 0044 e 0045 no Supabase.' : '';
    panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_BANK}</div><p>Erro ao carregar a conciliação.${dica}</p></div>`;
    return;
  }
  bancoContas = data || [];
  if (!bancoContas.length) { panel().innerHTML = renderSemConta(); return; }
  if (!contaAtual || !bancoContas.some(c => String(c.id) === String(contaAtual))) {
    contaAtual = (bancoContas.find(c => c.ativo !== false) || bancoContas[0]).id;
  }
  if (!(cadastroCache.categorias_financeiras || []).length) {
    const { data: cf } = await sbQ(sb.from('categorias_financeiras').select('id,nome,tipo,ativo').order('nome'));
    if (cf) cadastroCache.categorias_financeiras = cf;
  }
  historicoCarregado = false;
  abaAtual = 'movimentos';
  await carregarMovimentos();
  render();
}

function renderSemConta() {
  return `<div class="page-head"><div><h2>Conciliação Bancária</h2>
    <div class="sub">Casa as movimentações do banco com as contas a receber/pagar</div></div></div>
    <div class="empty-state"><div class="empty-icon">${IC_BANK}</div><p>Nenhuma conta bancária cadastrada ainda.</p>
    ${ehGestor() ? '<button class="btn-primary btn-sm" style="margin-top:10px" onclick="conciliacaoNovaConta()">+ Nova conta</button>' : ''}</div>`;
}

// Candidatos por (valor exato + data mais próxima). Crédito casa com contas a
// receber pendentes; débito casa com contas a pagar em aberto.
async function candidatosPara(m) {
  const alvo = Math.abs(Number(m.valor));
  if (m.tipo === 'credito') {
    const { data } = await sbQ(sb.from('financeiro_lancamentos').select('id,descricao,pessoa_nome,valor,vencimento')
      .eq('tipo', 'receber').eq('pago', false).eq('estornado', false).eq('valor', alvo).limit(10));
    return ordenarPorProximidade(data || [], m.data).slice(0, 3)
      .map(x => ({ tipo: 'receber', id: x.id, titulo: x.pessoa_nome || x.descricao, data: x.vencimento, valor: x.valor }));
  }
  const { data } = await sbQ(sb.from('contas_a_pagar').select('id,descricao,fornecedor_nome,valor,vencimento')
    .eq('status', 'aberto').eq('valor', alvo).limit(10));
  return ordenarPorProximidade(data || [], m.data).slice(0, 3)
    .map(x => ({ tipo: 'pagar', id: x.id, titulo: x.fornecedor_nome || x.descricao, data: x.vencimento, valor: x.valor }));
}

function ordenarPorProximidade(lista, dataRef) {
  const t0 = new Date(dataRef).getTime();
  return [...lista].sort((a, b) => Math.abs(new Date(a.vencimento).getTime() - t0) - Math.abs(new Date(b.vencimento).getTime() - t0));
}

async function carregarMovimentos() {
  const { data, error } = await sbQ(sb.from('banco_movimentos').select('*').eq('conta_id', contaAtual)
    .order('data', { ascending: false }).limit(300));
  if (error) { console.error('Movimentos:', error); movimentos = []; return; }
  movimentos = data || [];
  candidatosPorMov = {}; escolhaPorMov = {}; buscaManualAberta = null; resultadosManuaisPorMov = {};
  const pendentes = movimentos.filter(m => !m.conciliado);
  await Promise.all(pendentes.map(async m => { candidatosPorMov[m.id] = await candidatosPara(m); }));
}

export async function conciliacaoTrocarConta(id) {
  contaAtual = id;
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  historicoCarregado = false;
  await carregarMovimentos();
  await render();
}

export async function conciliacaoTrocarAba(aba) { abaAtual = aba; await render(); }

async function render() {
  if (abaAtual === 'historico') { await renderHistorico(); return; }
  renderMovimentos();
}

function chipsHtml() {
  return `<div class="chips" style="margin-bottom:12px">
    <div class="chip${abaAtual === 'movimentos' ? ' active' : ''}" onclick="conciliacaoTrocarAba('movimentos')">Movimentações</div>
    <div class="chip${abaAtual === 'historico' ? ' active' : ''}" onclick="conciliacaoTrocarAba('historico')">Histórico</div>
  </div>`;
}

function optsContas() {
  return bancoContas.map(c => `<option value="${c.id}" ${String(c.id) === String(contaAtual) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
}

function optsCategoria(sel) {
  const cats = (cadastroCache.categorias_financeiras || []).filter(c => c.ativo !== false);
  return '<option value="">— sem categoria —</option>' +
    cats.map(c => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
}

function renderCandidatos(m) {
  if (buscaManualAberta === m.id) {
    return `<div style="min-width:220px">
      <input type="text" id="conc-manual-input-${m.id}" class="form-control" style="font-size:12.5px;padding:5px 8px"
        placeholder="Buscar por descrição/nome..." oninput="conciliacaoBuscarManualInput('${m.id}')">
      <div id="conc-manual-results-${m.id}" style="margin-top:6px;max-height:180px;overflow-y:auto"></div>
      <button class="btn-link" style="font-size:11px" onclick="conciliacaoBuscarManual('${m.id}')">cancelar</button>
    </div>`;
  }
  const cands = candidatosPorMov[m.id];
  if (cands === undefined) return '<span style="font-size:11px;color:var(--muted)">Calculando sugestões...</span>';
  if (!cands.length) return `<button class="btn-secondary btn-sm" onclick="conciliacaoBuscarManual('${m.id}')">Buscar manualmente</button>`;
  return cands.map((c, i) => `<button class="btn-secondary btn-sm" style="margin:2px 4px 2px 0" onclick="conciliacaoEscolherCandidato('${m.id}',${i})" title="${formatDate(c.data)} · ${fmtBRL(c.valor)}">${esc(c.titulo)}</button>`).join('')
    + `<button class="btn-link" style="font-size:11px" onclick="conciliacaoBuscarManual('${m.id}')">outro...</button>`;
}

function linhaMovimento(m) {
  const corValor = m.tipo === 'credito' ? 'var(--success)' : 'var(--danger)';
  const escolha = escolhaPorMov[m.id];
  const acaoCel = m.conciliado
    ? `<span class="badge badge-ativo" style="font-size:10px">Conciliado</span> ${ehGestor() ? `<button class="btn-icon" title="Desconciliar" style="color:var(--danger)" onclick="conciliacaoDesconciliarAbrir('${m.id}')">${IC_UNDO}</button>` : ''}`
    : !ehGestor() ? '<span style="color:var(--muted);font-size:12px">Pendente</span>'
      : escolha
        ? `<div style="font-size:12px"><b>${esc(escolha.titulo)}</b><div style="color:var(--muted)">${formatDate(escolha.data)} · ${fmtBRL(escolha.valor)}</div></div>
           <button class="btn-icon" title="Remover escolha" onclick="conciliacaoRemoverEscolha('${m.id}')">${IC_X}</button>`
        : renderCandidatos(m);
  return `<tr class="ciclo-row">
    <td class="ciclo-td" style="white-space:nowrap">${formatDate(m.data)}</td>
    <td class="ciclo-td"><span class="ciclo-desc">${esc(m.descricao || '—')}</span>${m.memo ? `<div style="font-size:11px;color:var(--muted)">${esc(m.memo)}</div>` : ''}</td>
    <td class="ciclo-td" style="text-align:right"><span class="ciclo-preco" style="color:${corValor}">${m.tipo === 'debito' ? '-' : ''}${fmtBRL(Math.abs(m.valor))}</span></td>
    <td class="ciclo-td"><select class="form-control" style="font-size:12.5px;padding:4px 6px" ${ehGestor() ? '' : 'disabled'} onchange="conciliacaoCategoriaChange('${m.id}',this.value)">${optsCategoria(m.categoria_id)}</select></td>
    <td class="ciclo-td">${acaoCel}</td>
  </tr>`;
}

function renderMovimentos() {
  const pendentes = movimentos.filter(mm => !mm.conciliado);
  const conciliados = movimentos.filter(mm => mm.conciliado);
  const nEsc = Object.keys(escolhaPorMov).length;
  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Conciliação Bancária</h2><div class="sub">${movimentos.length} movimentaç${movimentos.length !== 1 ? 'ões' : 'ão'} · ${pendentes.length} pendente${pendentes.length !== 1 ? 's' : ''}</div></div>
      <div class="acts">
        <select class="form-control" style="width:auto" onchange="conciliacaoTrocarConta(this.value)">${optsContas()}</select>
        ${ehGestor() ? `<button class="btn-secondary btn-sm" onclick="conciliacaoNovaConta()">+ Conta</button>
        <button class="btn-primary btn-sm" onclick="document.getElementById('conc-ofx-input').click()">Importar OFX</button>` : ''}
      </div>
    </div>
    ${chipsHtml()}
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Pendentes</span></div><div class="kpi-val" style="color:var(--rose)">${pendentes.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Conciliadas</span></div><div class="kpi-val" style="color:var(--success)">${conciliados.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Total</span></div><div class="kpi-val">${movimentos.length}</div></div>
    </div>
    <input type="file" id="conc-ofx-input" accept=".ofx,application/x-ofx" style="display:none" onchange="conciliacaoImportarOFX(this)">
    ${!movimentos.length
      ? `<div class="empty-state"><div class="empty-icon">${IC_BANK}</div><p>Nenhuma movimentação nesta conta ainda. Importe um extrato OFX para começar.</p></div>`
      : `<div class="pag-wrap"><table class="pag-table"><thead><tr>
          <th class="pag-th">Data</th><th class="pag-th">Descrição</th><th class="pag-th" style="text-align:right">Valor</th>
          <th class="pag-th">Categoria</th><th class="pag-th">Conciliação</th>
        </tr></thead><tbody>${movimentos.map(linhaMovimento).join('')}</tbody></table></div>`}
    ${nEsc ? `<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid var(--border);padding:10px;display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span style="font-size:13px">${nEsc} pronta${nEsc !== 1 ? 's' : ''} para conciliar</span>
      <button class="btn-primary btn-sm" style="width:auto" onclick="conciliacaoConfirmarLote()">Confirmar conciliação</button>
    </div>` : ''}`;
}

async function renderHistorico() {
  if (!historicoCarregado) {
    panel().innerHTML = `<div class="page-head"><div><h2>Conciliação Bancária</h2></div></div>${chipsHtml()}<div class="loading"><div class="spinner">⟳</div></div>`;
    const { data } = await sbQ(sb.from('conciliacoes').select('*').eq('conta_id', contaAtual).order('created_at', { ascending: false }).limit(50));
    historico = data || [];
    historicoCarregado = true;
  }
  panel().innerHTML = `
    <div class="page-head"><div><h2>Conciliação Bancária</h2><div class="sub">Histórico de conciliações</div></div>
      <div class="acts"><select class="form-control" style="width:auto" onchange="conciliacaoTrocarConta(this.value)">${optsContas()}</select></div></div>
    ${chipsHtml()}
    ${!historico.length
      ? `<div class="empty-state"><div class="empty-icon">${IC_BANK}</div><p>Nenhuma conciliação registrada ainda nesta conta.</p></div>`
      : `<div class="pag-wrap"><table class="pag-table"><thead><tr>
          <th class="pag-th">Data</th><th class="pag-th">Período</th><th class="pag-th" style="text-align:right">Movimentações</th><th class="pag-th"></th>
        </tr></thead><tbody>${historico.map(h => `
          <tr class="ciclo-row" style="cursor:pointer" onclick="conciliacaoToggleHistoricoItens('${h.id}')">
            <td class="ciclo-td">${formatDate(h.created_at)}</td>
            <td class="ciclo-td">${h.periodo_ini ? `${formatDate(h.periodo_ini)} – ${formatDate(h.periodo_fim)}` : '—'}</td>
            <td class="ciclo-td" style="text-align:right">${h.total_conciliados ?? h.total_movimentos ?? '—'}</td>
            <td class="ciclo-td" style="text-align:right">${IC_CHEV}</td>
          </tr>
          ${itensAbertos === h.id ? `<tr><td class="ciclo-td" colspan="4" id="conc-hist-itens-${h.id}"><div style="font-size:12px;color:var(--muted)">Carregando itens...</div></td></tr>` : ''}
        `).join('')}</tbody></table></div>`}`;
}

export async function conciliacaoToggleHistoricoItens(id) {
  itensAbertos = (itensAbertos === id) ? null : id;
  await renderHistorico();
  if (itensAbertos !== id) return;
  const { data } = await sbQ(sb.from('conciliacao_itens').select('*').eq('conciliacao_id', id).order('created_at'));
  const cel = document.getElementById(`conc-hist-itens-${id}`);
  if (!cel) return;
  cel.innerHTML = (data && data.length)
    ? data.map(it => `<div style="padding:3px 0">${it.acao === 'conciliar' ? 'Conciliado' : 'Desfeito'} · ${it.ref_tipo === 'receber' ? 'a receber' : 'a pagar'} · ${fmtBRL(it.valor)}</div>`).join('')
    : '<div style="color:var(--muted)">Sem itens.</div>';
}

// ── Conta bancária (cadastro simples) ───────────────────────────────
export function conciliacaoNovaConta() {
  if (!ehGestor()) return;
  document.getElementById('cad-modal-titulo').textContent = 'Nova conta bancária';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="conc-conta-nome" class="form-control" placeholder="Ex.: C6 Bank, Nubank PJ..."></div>
    <div class="form-group"><label class="form-label">Banco</label><input type="text" id="conc-conta-banco" class="form-control"></div>
    <div class="form-group"><label class="form-label">Tipo</label><input type="text" id="conc-conta-tipo" class="form-control" placeholder="corrente, poupança..."></div>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', 'conciliacaoNovaContaSalvar()');
  openModal('modal-cadastro');
}

export async function conciliacaoNovaContaSalvar() {
  const nome = document.getElementById('conc-conta-nome').value.trim();
  if (!nome) { toast('Informe o nome da conta.'); return; }
  const banco = document.getElementById('conc-conta-banco').value.trim() || null;
  const tipo = document.getElementById('conc-conta-tipo').value.trim() || null;
  const { data, error } = await sbQ(sb.from('banco_contas').insert({ nome, banco, tipo }).select('id').single());
  if (await handleSupabaseError(error, 'Erro ao criar conta')) return;
  closeModal('modal-cadastro');
  toast('Conta criada!');
  contaAtual = data.id;
  await loadConciliacao();
}

// ── Categoria do movimento (classificação livre, não altera o título) ──
export async function conciliacaoCategoriaChange(movId, categoriaId) {
  const { error } = await sbQ(sb.from('banco_movimentos').update({ categoria_id: categoriaId || null }).eq('id', movId));
  if (error) { console.error('Categoria do movimento:', error); toast('Erro ao salvar categoria: ' + error.message); return; }
  const m = movimentos.find(x => String(x.id) === String(movId));
  if (m) m.categoria_id = categoriaId || null;
}

// ── Escolha do candidato (sugestão ou busca manual) ─────────────────
export function conciliacaoEscolherCandidato(movId, idx) {
  const c = (candidatosPorMov[movId] || [])[idx];
  if (!c) return;
  escolhaPorMov[movId] = c;
  renderMovimentos();
}

export function conciliacaoRemoverEscolha(movId) {
  delete escolhaPorMov[movId];
  renderMovimentos();
}

export function conciliacaoBuscarManual(movId) {
  buscaManualAberta = (buscaManualAberta === movId) ? null : movId;
  renderMovimentos();
  if (buscaManualAberta) setTimeout(() => document.getElementById(`conc-manual-input-${movId}`)?.focus(), 60);
}

const buscaManualDebounced = debounce((movId) => conciliacaoBuscarManualRun(movId), 250);
export function conciliacaoBuscarManualInput(movId) { buscaManualDebounced(movId); }

async function conciliacaoBuscarManualRun(movId) {
  const m = movimentos.find(x => String(x.id) === String(movId));
  const input = document.getElementById(`conc-manual-input-${movId}`);
  const div = document.getElementById(`conc-manual-results-${movId}`);
  if (!m || !input || !div) return;
  const t = input.value.trim().replace(/"/g, '');
  div.innerHTML = '<div style="font-size:12px;color:var(--muted)">Buscando...</div>';
  let resultados;
  if (m.tipo === 'credito') {
    let q = sb.from('financeiro_lancamentos').select('id,descricao,pessoa_nome,valor,vencimento').eq('tipo', 'receber').eq('pago', false).eq('estornado', false);
    if (t) q = q.or(`descricao.ilike."%${t}%",pessoa_nome.ilike."%${t}%"`);
    const { data } = await sbQ(q.order('vencimento', { ascending: false }).limit(15));
    resultados = (data || []).map(x => ({ tipo: 'receber', id: x.id, titulo: x.pessoa_nome || x.descricao, data: x.vencimento, valor: x.valor }));
  } else {
    let q = sb.from('contas_a_pagar').select('id,descricao,fornecedor_nome,valor,vencimento').eq('status', 'aberto');
    if (t) q = q.or(`descricao.ilike."%${t}%",fornecedor_nome.ilike."%${t}%"`);
    const { data } = await sbQ(q.order('vencimento', { ascending: false }).limit(15));
    resultados = (data || []).map(x => ({ tipo: 'pagar', id: x.id, titulo: x.fornecedor_nome || x.descricao, data: x.vencimento, valor: x.valor }));
  }
  resultadosManuaisPorMov[movId] = resultados;
  if (!resultados.length) { div.innerHTML = '<div style="font-size:12px;color:var(--muted)">Nada encontrado.</div>'; return; }
  div.innerHTML = resultados.map((r, i) => `
    <div class="f3-row" style="cursor:pointer" onclick="conciliacaoEscolherManual('${movId}',${i})">
      <div style="flex:1;min-width:0"><div class="ciclo-desc">${esc(r.titulo)}</div>
      <div class="f3-meta"><span>${formatDate(r.data)}</span><span>${fmtBRL(r.valor)}</span></div></div>
    </div>`).join('');
}

export function conciliacaoEscolherManual(movId, idx) {
  const r = (resultadosManuaisPorMov[movId] || [])[idx];
  if (!r) return;
  escolhaPorMov[movId] = r;
  buscaManualAberta = null;
  renderMovimentos();
}

// ── Confirmar conciliação em lote ───────────────────────────────────
export async function conciliacaoConfirmarLote() {
  if (!ehGestor()) return;
  const entradas = Object.entries(escolhaPorMov);
  if (!entradas.length) { toast('Escolha ao menos uma conciliação.'); return; }
  const n = entradas.length;
  confirmarAcao('Confirmar conciliação', `Conciliar ${n} movimentaç${n !== 1 ? 'ões' : 'ão'}? Os títulos correspondentes serão marcados como pagos/recebidos.`, 'Conciliar', async () => {
    const itens = [];
    const usados = new Set();
    const datas = [];
    for (const [movId, escolha] of entradas) {
      const chave = `${escolha.tipo}:${escolha.id}`;
      if (usados.has(chave)) continue;
      usados.add(chave);
      const m = movimentos.find(x => String(x.id) === String(movId));
      if (!m) continue;
      datas.push(m.data);

      if (escolha.tipo === 'receber') {
        const { error } = await sbQ(sb.from('financeiro_lancamentos').update({ pago: true, data_recebimento: m.data }).eq('id', escolha.id));
        if (error) { console.error('Baixa (receber):', error); toast('Erro ao dar baixa: ' + error.message); continue; }
      } else {
        const { error } = await sbQ(sb.from('contas_a_pagar').update({ status: 'pago', data_pagamento: m.data }).eq('id', escolha.id));
        if (error) { console.error('Baixa (pagar):', error); toast('Erro ao dar baixa: ' + error.message); continue; }
      }
      const { error: eMov } = await sbQ(sb.from('banco_movimentos').update({
        conciliado: true, conciliado_tipo: escolha.tipo, conciliado_ref: escolha.id,
        conciliado_em: new Date().toISOString(), conciliado_por: state.currentUser?.id || null,
      }).eq('id', movId));
      if (eMov) { console.error('Movimento:', eMov); toast('Título baixado, mas erro ao marcar o movimento: ' + eMov.message); continue; }

      itens.push({ movimento_id: movId, ref_tipo: escolha.tipo, ref_id: escolha.id, valor: m.valor, acao: 'conciliar' });
      delete escolhaPorMov[movId];
    }
    if (itens.length) {
      const { data: header, error: eHead } = await sbQ(sb.from('conciliacoes').insert({
        conta_id: contaAtual,
        periodo_ini: datas.length ? datas.reduce((a, b) => (a < b ? a : b)) : null,
        periodo_fim: datas.length ? datas.reduce((a, b) => (a > b ? a : b)) : null,
        total_movimentos: itens.length, total_conciliados: itens.length,
        created_by: state.currentUser?.id || null,
      }).select('id').single());
      if (eHead) console.error('Cabeçalho da conciliação:', eHead);
      else if (header) await sbQ(sb.from('conciliacao_itens').insert(itens.map(it => ({ ...it, conciliacao_id: header.id }))));
    }
    toast(`${itens.length} movimentaç${itens.length !== 1 ? 'ões' : 'ão'} conciliada${itens.length !== 1 ? 's' : ''}.`);
    await carregarMovimentos();
    renderMovimentos();
  });
}

// ── Desconciliar (soft, auditável) ──────────────────────────────────
export function conciliacaoDesconciliarAbrir(movId) {
  if (!ehGestor()) return;
  const m = movimentos.find(x => String(x.id) === String(movId));
  if (!m || !m.conciliado) return;
  document.getElementById('cad-modal-titulo').textContent = 'Desconciliar movimentação';
  document.getElementById('cad-modal-body').innerHTML = `
    <div style="font-size:13.5px;margin-bottom:12px">Desfazer a conciliação de <b style="color:var(--rose)">${fmtBRL(Math.abs(m.valor))}</b> (${esc(m.descricao || '')})?<br>
      <span style="color:var(--muted);font-size:12.5px">O título correspondente volta a ficar em aberto/pendente.</span></div>
    <div class="form-group"><label class="form-label">Motivo (opcional)</label>
      <textarea id="conc-desc-motivo" class="form-control" rows="2" placeholder="Ex.: match errado, valor duplicado..."></textarea></div>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `conciliacaoDesconciliarConfirmar('${movId}')`);
  openModal('modal-cadastro');
}

export async function conciliacaoDesconciliarConfirmar(movId) {
  const m = movimentos.find(x => String(x.id) === String(movId));
  if (!m) return;
  const motivo = document.getElementById('conc-desc-motivo')?.value.trim() || null;

  if (m.conciliado_tipo === 'receber') {
    const { error } = await sbQ(sb.from('financeiro_lancamentos').update({ pago: false, data_recebimento: null }).eq('id', m.conciliado_ref));
    if (await handleSupabaseError(error, 'Erro ao desconciliar')) return;
  } else if (m.conciliado_tipo === 'pagar') {
    const { error } = await sbQ(sb.from('contas_a_pagar').update({ status: 'aberto', data_pagamento: null }).eq('id', m.conciliado_ref));
    if (await handleSupabaseError(error, 'Erro ao desconciliar')) return;
  }
  const { error } = await sbQ(sb.from('banco_movimentos').update({
    conciliado: false, desconciliado_em: new Date().toISOString(),
    desconciliado_por: state.currentUser?.id || null, desconciliacao_motivo: motivo,
  }).eq('id', movId));
  if (await handleSupabaseError(error, 'Erro ao desconciliar')) return;

  closeModal('modal-cadastro');
  toast('Movimentação desconciliada — o título voltou a ficar em aberto.');
  await carregarMovimentos();
  renderMovimentos();
}

// ── Importar extrato OFX (parser vanilla, sem lib) ──────────────────
// OFX é SGML: tags sem fechamento, valor vai até a próxima tag/quebra de
// linha. Charset costuma ser latin-1 (detecta pelo "replacement character").
function pegarTag(bloco, tag) {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? m[1].trim() : '';
}

export async function conciliacaoImportarOFX(input) {
  if (!ehGestor()) return;
  const file = input.files?.[0];
  input.value = ''; // permite reimportar o mesmo arquivo depois
  if (!file) return;
  if (!contaAtual) { toast('Selecione ou crie uma conta primeiro.'); return; }

  const buf = await file.arrayBuffer();
  let texto = new TextDecoder('utf-8').decode(buf);
  if (texto.includes('�')) texto = new TextDecoder('iso-8859-1').decode(buf);

  const blocos = texto.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
  if (!blocos.length) { toast('Nenhuma transação encontrada no arquivo (formato inesperado).'); return; }

  const linhas = blocos.map(bloco => {
    const dtposted = pegarTag(bloco, 'DTPOSTED');
    const data = dtposted && dtposted.length >= 8 ? `${dtposted.slice(0, 4)}-${dtposted.slice(4, 6)}-${dtposted.slice(6, 8)}` : null;
    const valor = parseFloat(pegarTag(bloco, 'TRNAMT').replace(',', '.'));
    const fitid = pegarTag(bloco, 'FITID') || null;
    const nome = pegarTag(bloco, 'NAME') || pegarTag(bloco, 'PAYEE');
    const memo = pegarTag(bloco, 'MEMO');
    return { data, valor, fitid, descricao: nome || memo || 'Movimentação', memo: memo || null };
  }).filter(l => l.data && !isNaN(l.valor));
  if (!linhas.length) { toast('Não consegui ler as transações do arquivo.'); return; }

  // Dedup por FITID (idempotente: reimportar o mesmo extrato não duplica).
  const fitids = linhas.map(l => l.fitid).filter(Boolean);
  let existentes = new Set();
  if (fitids.length) {
    const { data } = await sbQ(sb.from('banco_movimentos').select('fitid').eq('conta_id', contaAtual).in('fitid', fitids));
    existentes = new Set((data || []).map(x => x.fitid));
  }
  const novas = linhas.filter(l => !l.fitid || !existentes.has(l.fitid));
  const duplicadas = linhas.length - novas.length;
  if (!novas.length) { toast(`Nenhuma transação nova (${duplicadas} já importada${duplicadas !== 1 ? 's' : ''}).`); return; }

  const contaNome = bancoContas.find(c => String(c.id) === String(contaAtual))?.nome || null;
  const rows = novas.map(l => ({
    conta_id: contaAtual, conta_label: contaNome, data: l.data, descricao: l.descricao, memo: l.memo,
    valor: l.valor, tipo: l.valor < 0 ? 'debito' : 'credito', fitid: l.fitid, origem: 'ofx',
  }));
  const { error } = await sbQ(sb.from('banco_movimentos').insert(rows));
  if (await handleSupabaseError(error, 'Erro ao importar')) return;
  toast(`${novas.length} movimentaç${novas.length !== 1 ? 'ões' : 'ão'} importada${novas.length !== 1 ? 's' : ''}${duplicadas ? ` (${duplicadas} já existia${duplicadas !== 1 ? 'm' : ''})` : ''}.`);
  await carregarMovimentos();
  renderMovimentos();
}
