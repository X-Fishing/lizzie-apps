// Tela da CLIENTE FINAL: todas as compras dela + a cartela de fidelidade.
// Rota própria (#/cliente/:id) — é para onde a Fidelidade, o CRUD de Clientes
// e Minhas Clientes levam ao clicar numa cliente.
//
// Diferença crucial para o "Histórico de Vendas" (historico.js): aquela tela
// agrupa por vendas.nome_cliente COMO STRING, então "Ana" e "Ana Paula" viram
// duas pessoas. Aqui a chave é vendas.cliente_id — a mesma que a fidelidade usa.
//
// ESCOPO POR PAPEL: staff vê as compras de TODAS as revendedoras; a revendedora
// vê só as dela. O filtro é feito NA QUERY, não só na RLS, pelo mesmo motivo
// documentado em fidelidade.js:37-44 — "Entrar como Revendedora" troca o papel
// só na memória da sessão, então para a RLS a funcionária continua staff.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, toast, confirmarAcao, handleSupabaseError, fmtBRL, formatDate,
         isoToBR, fmtDiaMes, telFmt, telValido, waMeLink } from './utils.js';
import { ehStaff, ehGestor } from './auth.js';
import { IS_ADMIN } from './menu.js';
import { renderCartelaFidelidade } from './fidelidade.js';
import { abrirEdicaoCliente } from './cliente-form.js';
import { voltarDaCliente } from './nav.js';

const IC_GIFT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>';
const IC_BAG   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
const IC_BACK  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

const panel = () => document.getElementById('panel-cliente-compras');
const telRuim = c => !!c && !telValido(c);

// Estado da tela (uma cliente por vez).
let cli = null;        // linha de `clientes`
let vendas = [];       // vendas DELA no escopo do papel
let itens = {};        // venda_id -> [venda_itens]
let fid = null;        // retorno de fidelidade_status
let ciclo = null;      // retorno de fidelidade_ciclo_cliente (saldo do ciclo atual)
let abertaId = null;   // venda expandida

// Contador de requisição: abrir a cliente A e logo em seguida a B fazia a
// resposta atrasada de A escrever a cartela dela dentro da tela da B (os
// getElementById acham os boxes da tela nova). Toda escrita assíncrona
// confere o token antes de tocar no DOM.
let req = 0;

export async function loadClienteCompras(id) {
  const meu = ++req;
  if (!id) { panel().innerHTML = vazio('Cliente não informada.'); return; }
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  cli = null; vendas = []; itens = {}; fid = null; ciclo = null; abertaId = null;

  // A query de vendas é a fonte de verdade do escopo: se a revendedora não
  // vendeu para esta cliente, ela sai daqui sem nenhuma venda — e o cabeçalho
  // some junto (ver o guard logo abaixo), então nome/telefone não vazam.
  let qv = sb.from('vendas').select('*').eq('cliente_id', id);
  if (!ehStaff()) qv = qv.eq('revendedora_id', state.currentUser.id);

  const [cRes, vRes] = await Promise.all([
    sbQ(sb.from('clientes').select('*').eq('id', id).maybeSingle()),
    sbQ(qv.order('data_venda', { ascending: false })),
  ]);
  if (meu !== req) return;   // outra cliente foi aberta enquanto isto carregava
  // handleSupabaseError trata sessão expirada; se ele não assumir, a tela
  // precisa sair do spinner — senão fica "Carregando..." para sempre.
  const erro = cRes.error || vRes.error;
  if (erro) {
    if (await handleSupabaseError(erro, 'Erro ao carregar a cliente')) return;
    panel().innerHTML = vazio('Não foi possível carregar esta cliente. Tente de novo.');
    return;
  }

  cli = cRes.data || null;
  vendas = vRes.data || [];

  // Sem vínculo = sem tela. Vale para a revendedora que chegou digitando o id
  // na URL: a RLS já devolveria a cliente (0028 dá SELECT a quem vendeu), mas
  // o papel EFETIVO da sessão é quem manda aqui.
  if (!cli || (!ehStaff() && !vendas.length)) {
    panel().innerHTML = vazio('Cliente não encontrada nas suas vendas.');
    return;
  }

  render();
  carregarFidelidade(id, meu);
  if (vendas.length) carregarItens(vendas.map(v => v.id), meu);
}

function vazio(msg) {
  return `<button class="btn-secondary btn-sm" style="width:auto;margin-bottom:14px" onclick="clienteComprasVoltar()">${IC_BACK} Voltar</button>
    <div class="empty-state"><div class="empty-icon">${IC_BAG}</div><p>${esc(msg)}</p></div>`;
}

function render() {
  const total = vendas.reduce((s, v) => s + Number(v.valor_total || 0), 0);
  const pago = vendas.reduce((s, v) => s + Number(v.valor_pago || 0), 0);
  const pendente = total - pago;
  const wa = waMeLink(cli.celular, '');   // null se o número não for válido

  panel().innerHTML = `
    <button class="btn-secondary btn-sm" style="width:auto;margin-bottom:14px" onclick="clienteComprasVoltar()">${IC_BACK} Voltar</button>
    <div class="page-head">
      <div>
        <h2>${esc(cli.nome)}</h2>
        <div class="sub">${esc(telFmt(cli.celular))}${telRuim(cli.celular) ? ' · <span style="color:var(--danger)">telefone fora do padrão</span>' : ''}${
          fmtDiaMes(cli.aniversario_dia, cli.aniversario_mes) ? ' · aniversário ' + esc(fmtDiaMes(cli.aniversario_dia, cli.aniversario_mes)) : ''}${
          cli.cidade ? ' · ' + esc(cli.cidade) : ''}</div>
      </div>
      <div class="acts">
        ${wa ? `<a class="btn-secondary btn-sm" style="width:auto;text-decoration:none;border-color:#25d366;color:#1a7a44" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn-secondary btn-sm" style="width:auto" onclick="clienteComprasEditar()">${IC_EDIT} Editar cliente</button>
      </div>
    </div>
    ${telRuim(cli.celular) ? `<div style="font-size:12.5px;color:var(--danger);background:rgba(224,85,85,.10);border:1px solid var(--danger);border-radius:10px;padding:8px 12px;margin-bottom:12px">⚠ O telefone é a chave do cadastro. Fora do padrão, este registro pode ter juntado mais de uma pessoa — confira as compras antes de liberar prêmio de fidelidade.</div>` : ''}
    ${dadosCadastroHtml()}
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Compras</span><span class="kpi-ic">${IC_BAG}</span></div><div class="kpi-val">${vendas.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Total gasto</span><span class="kpi-ic">${IC_BAG}</span></div><div class="kpi-val">${fmtBRL(total)}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Em aberto</span><span class="kpi-ic">${IC_BAG}</span></div><div class="kpi-val"${pendente > 0 ? ' style="color:var(--danger)"' : ''}>${fmtBRL(pendente)}</div></div>
    </div>
    <div id="cc-fidelidade"><div class="loading" style="padding:14px"><div class="spinner">⟳</div></div></div>
    <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:13px;color:var(--plum);margin:18px 0 8px">
      Compras${!ehStaff() ? ' com você' : ''}
    </div>
    <div id="cc-compras">${listaCompras()}</div>`;
}

// E-mail, observação e "cliente desde" só existiam no modal de detalhe que a
// tela Clientes tinha antes. Sem eles aqui, o dado ficaria visível só dentro
// do formulário de edição — que nem toda pessoa tem permissão de abrir.
function dadosCadastroHtml() {
  const linhas = [
    cli.email ? ['E-mail', cli.email] : null,
    cli.observacao ? ['Observação', cli.observacao] : null,
    cli.created_at ? ['Cliente desde', isoToBR(String(cli.created_at).slice(0, 10))] : null,
  ].filter(Boolean);
  if (!linhas.length) return '';
  return `<div style="border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-bottom:12px">
    ${linhas.map(([k, v]) => `<div style="display:flex;gap:8px;padding:4px 0;font-size:13px">
      <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;min-width:110px">${k}</div>
      <div style="flex:1">${esc(v)}</div></div>`).join('')}
  </div>`;
}

// ── Compras ────────────────────────────────────────────────────────
function listaCompras() {
  if (!vendas.length) {
    return `<div class="empty-state" style="padding:32px 0"><div class="empty-icon">${IC_BAG}</div><p>Nenhuma compra registrada.</p></div>`;
  }
  return vendas.map(v => {
    const pend = Number(v.valor_total || 0) - Number(v.valor_pago || 0);
    const aberta = String(abertaId) === String(v.id);
    const lin = itens[v.id];
    const itensHtml = lin
      ? (lin.length
          ? lin.map(it => `<div class="hist-item-row"><span>${esc(it.quantidade)}× ${esc(it.descricao)}</span><span>${fmtBRL(it.quantidade * Number(it.preco_unit))}</span></div>`).join('')
          : '<div class="hist-item-row" style="color:var(--muted);font-style:italic">Sem itens registrados.</div>')
      : '<div class="hist-item-row" style="color:var(--muted);font-style:italic">Carregando itens…</div>';
    return `<div class="hist-card${aberta ? ' open' : ''}" onclick="clienteCompraToggle('${esc(v.id)}')">
      <div class="hist-nome">${esc(formatDate(v.data_venda))} · ${fmtBRL(v.valor_total)}</div>
      <div class="hist-stats">
        ${esc(v.forma_pagamento || '—')}
        ${pend > 0
          ? ` · Pendente <b style="color:var(--danger)">${fmtBRL(pend)}</b>`
          : ' · <b style="color:var(--success)">quitado</b>'}
      </div>
      ${aberta ? `<div class="hist-detalhe" onclick="event.stopPropagation()">${itensHtml}</div>` : ''}
    </div>`;
  }).join('');
}

export function clienteCompraToggle(id) {
  abertaId = String(abertaId) === String(id) ? null : id;
  const el = document.getElementById('cc-compras');
  if (el) el.innerHTML = listaCompras();
}

async function carregarItens(ids, meu = req) {
  const { data, error } = await sbQ(sb.from('venda_itens').select('*').in('venda_id', ids).order('created_at'));
  if (error || meu !== req) return;
  ids.forEach(id => { itens[id] = []; });
  (data || []).forEach(it => { (itens[it.venda_id] ||= []).push(it); });
  const el = document.getElementById('cc-compras');
  if (el) el.innerHTML = listaCompras();
}

// ── Fidelidade (o que antes era o modal da tela Fidelidade) ────────
async function carregarFidelidade(id, meu = req) {
  // O 'ciclo' é o saldo acumulado na maleta ATIVA de quem está olhando (0057).
  // Falha nele não pode derrubar a cartela: vai como consulta separada e o
  // erro só some com a linha.
  const [{ data, error }, cicloRes] = await Promise.all([
    sbQ(sb.rpc('fidelidade_status', { p_cliente_id: id })),
    sbQ(sb.rpc('fidelidade_ciclo_cliente', { p_cliente_id: id })),
  ]);
  const box = document.getElementById('cc-fidelidade');
  if (!box || meu !== req) return;
  if (error) {
    console.warn('fidelidade_status:', error.message);
    box.innerHTML = '';   // fidelidade quebrada não pode esconder as compras
    return;
  }
  fid = data;
  ciclo = cicloRes.error ? null : cicloRes.data;
  box.innerHTML = fidelidadeHtml(id);
}

// A partir de 0057 as compras SOMAM dentro do ciclo da maleta: uma venda de
// R$ 75 gera 0 selos e o valor fica guardado até fechar R$ 150. Sem mostrar
// esse saldo, a revendedora acha que a compra não contou.
function cicloHtml() {
  if (!ciclo?.tem_ciclo) return '';
  const falta = Number(ciclo.falta_para_selo);
  if (!Number.isFinite(falta) || falta <= 0) return '';
  return `<div style="font-size:12.5px;color:var(--plum);text-align:center;background:var(--blush);border-radius:12px;padding:10px 12px;margin-top:12px">
    Nesta maleta ela já somou <b>${fmtBRL(ciclo.acumulado)}</b> — faltam <b>${fmtBRL(falta)}</b> para o próximo selo.
  </div>`;
}

function fidelidadeHtml(id) {
  const selos = fid?.cartela?.selos || 0;
  const premios = fid?.premios_pendentes || [];
  const extrato = fid?.extrato || [];
  const completas = fid?.cartelas_completas || 0;

  const premiosHtml = premios.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(212,168,75,.10);border:1px solid var(--gold);border-radius:12px;padding:10px 14px;margin-bottom:8px">
      <div style="font-size:13px;color:var(--plum)"><span style="color:var(--gold);vertical-align:-3px">${IC_GIFT}</span> Prêmio de ${fmtBRL(p.valor)} disponível</div>
      ${ehGestor() ? `<button class="btn-primary btn-sm" style="width:auto" onclick="clienteResgatarPremio('${esc(p.id)}')">Registrar resgate</button>` : ''}
    </div>`).join('');

  // Ajuste manual entra com sinal (o "+" fixo renderizava "+-1") e ganha
  // badge para não se confundir com selo vindo de venda.
  const extratoHtml = extrato.length ? extrato.map(e => `
    <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <span style="color:var(--muted)">${esc(isoToBR((e.em || '').slice(0, 10)))}${e.valor_venda ? ' · ' + fmtBRL(e.valor_venda) : ''}
          ${e.ajuste_manual ? '<span class="badge badge-pendente" style="margin-left:6px">ajuste manual</span>' : ''}
          ${e.premio_cancelado ? '<span class="badge badge-pendente" style="margin-left:4px">prêmio cancelado</span>' : ''}</span>
        <span style="color:${e.quantidade < 0 ? 'var(--danger)' : 'var(--plum)'};font-weight:600;white-space:nowrap">${e.quantidade > 0 ? '+' : ''}${esc(e.quantidade)} selo${Math.abs(e.quantidade) !== 1 ? 's' : ''}</span>
      </div>
      ${e.ajuste_manual ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px;font-style:italic">${e.motivo ? '“' + esc(e.motivo) + '”' : 'sem motivo informado'}${e.autor ? ' — ' + esc(e.autor) : ''}</div>` : ''}
    </div>`).join('') : '<div style="font-size:12px;color:var(--muted)">Sem selos ainda.</div>';

  return `
    <div style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-top:4px">
      <div style="text-align:center;margin-bottom:6px">
        <div class="fid-progresso" style="font-size:22px">${selos}/10 selos</div>
        <div style="font-size:12px;color:var(--muted)">${selos >= 10 ? 'Cartela completa!' : `Faltam ${10 - selos} para R$ 300 em peças`}</div>
      </div>
      ${renderCartelaFidelidade(selos)}
      ${cicloHtml()}
      ${IS_ADMIN ? `<div id="cc-ajuste-box" style="display:flex;gap:8px;justify-content:center;margin-top:12px">
        <button class="btn-secondary btn-sm" style="width:auto" onclick="clienteAjustarSelo('${esc(id)}',-1)">− 1 selo</button>
        <button class="btn-secondary btn-sm" style="width:auto" onclick="clienteAjustarSelo('${esc(id)}',1)">+ 1 selo</button>
      </div>` : ''}
      ${premiosHtml ? `<div style="margin:16px 0 6px">${premiosHtml}</div>` : ''}
      ${completas ? `<div style="font-size:12px;color:var(--muted);margin-top:10px">${completas} cartela${completas !== 1 ? 's' : ''} já completada${completas !== 1 ? 's' : ''}.</div>` : ''}
      <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:13px;color:var(--plum);margin:18px 0 4px">Histórico de selos</div>
      ${extratoHtml}
    </div>`;
}

// ── Ajuste manual de selos (SÓ admin — sem chave de permissão) ─────
// Formulário INLINE, dentro do próprio box: a tela não é modal, mas manter o
// fluxo no lugar evita a pessoa perder de vista de qual cliente se trata.
export function clienteAjustarSelo(id, delta) {
  if (!IS_ADMIN) { toast('Apenas o administrador ajusta selos.'); return; }
  const box = document.getElementById('cc-ajuste-box');
  if (!box) return;
  box.innerHTML = `
    <div style="flex:1">
      <div class="form-group" style="margin:0">
        <label class="form-label">Motivo (opcional)</label>
        <textarea id="cc-ajuste-motivo" class="form-control" rows="2" placeholder="Ex.: selo lançado por engano, cortesia da Lizzie..."></textarea>
      </div>
      <div style="font-size:12px;color:var(--muted);margin:6px 0 10px">${delta > 0
        ? 'Vai somar 1 selo na cartela em andamento.'
        : 'Vai tirar 1 selo. Se a cartela estiver completa, ela é reaberta e o prêmio pendente é cancelado.'}</div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary btn-sm" style="flex:1" onclick="clienteAjusteCancelar('${esc(id)}')">Cancelar</button>
        <button class="btn-primary btn-sm" style="flex:1" onclick="clienteAjustarSeloConfirmar('${esc(id)}',${delta})">Confirmar ${delta > 0 ? '+1' : '−1'}</button>
      </div>
    </div>`;
}

export function clienteAjusteCancelar(id) {
  const box = document.getElementById('cc-fidelidade');
  if (box) box.innerHTML = fidelidadeHtml(id);
}

export async function clienteAjustarSeloConfirmar(id, delta) {
  if (!IS_ADMIN) { toast('Apenas o administrador ajusta selos.'); return; }
  const motivo = (document.getElementById('cc-ajuste-motivo')?.value || '').trim() || null;
  const { data, error } = await sbQ(sb.rpc('fidelidade_ajustar_selo', {
    p_cliente_id: id, p_delta: delta, p_motivo: motivo,
  }));
  if (error) {
    console.error('fidelidade_ajustar_selo:', error);
    // 'erro' é obrigatório: mensagens com "resgatado" seriam silenciadas.
    toast(/does not exist|schema cache/i.test(error.message || '')
      ? 'Rode a migração 0040 no Supabase para ativar o ajuste de selos.'
      : (error.message || 'Não foi possível ajustar'), 'erro');
    return;
  }
  if (data?.premio_cancelado) toast('Prêmio pendente cancelado junto com o selo.', 'erro');
  await carregarFidelidade(id);   // relê o RPC: cartela, prêmios e extrato
}

export async function clienteResgatarPremio(premioId) {
  if (!ehGestor()) { toast('Apenas gestores registram o resgate.'); return; }
  confirmarAcao('Registrar resgate', 'Confirmar a entrega das R$ 300 em peças para esta cliente? A cartela já foi zerada quando o prêmio foi gerado.', 'Registrar resgate', async () => {
    const { error } = await sbQ(sb.from('fidelidade_premios')
      .update({ status: 'resgatado', resgatado_em: new Date().toISOString(), resgatado_por: state.currentUser.id })
      .eq('id', premioId).eq('status', 'pendente'));
    if (await handleSupabaseError(error, 'Erro ao registrar resgate')) return;
    toast('Resgate registrado!');
    if (cli) await carregarFidelidade(cli.id);
  });
}

// Editar o cadastro pelo formulário compartilhado (src/cliente-form.js). A
// permissão é do servidor (cliente_editar): a revendedora só edita cliente
// para quem já vendeu — e se ela chegou nesta tela, vendeu.
export function clienteComprasEditar() {
  if (!cli) return;
  abrirEdicaoCliente(cli, () => loadClienteCompras(cli.id));
}

// Voltar para a lista de onde a pessoa veio (Fidelidade, Clientes ou Minhas
// Clientes). A origem é guardada por abrirCliente(); quando não há origem
// (link direto, F5) cai na tela do papel. NÃO usa history.back(): a tela pode
// ter sido a primeira da aba, e voltar sairia do app.
export function clienteComprasVoltar() { voltarDaCliente(); }
