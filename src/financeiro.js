// Financeiro FASE 1 — recebimento das maletas + PIX estático (BR Code EMV).
// Regra de ouro: faturamento = valor_a_receber (líquido após comissão).
// Contas TESTE (ehRevTeste) NUNCA lançam aqui — o QR pode ser exibido para
// teste, mas nada é gravado em financeiro_lancamentos.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, toast, sbQ, fmtBRL, formatDate, openModal, closeModal, parseMoneyBR, moneyToInput, handleSupabaseError, ehRevTeste, confirmarAcao } from './utils.js';
import { IS_ADMIN, PERMISSOES } from './menu.js';

const podeEstornar = () => IS_ADMIN || PERMISSOES.has('acao_estornar_recebimento');

const r2 = n => Math.round(n * 100) / 100;
const hojeISO = () => new Date().toISOString().slice(0, 10);
const idAbrev = id => String(id || '').slice(0, 8);

// Recebimento com MÚLTIPLOS pagamentos (ex.: 2-3 PIX de valores exatos para
// bater na conciliação bancária). Cada linha vira 1 lançamento no financeiro.
const REC_FORMAS = ['PIX', 'Dinheiro', 'Transferência', 'Cartão', 'Outro'];
const IC_TRASH_REC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
function recRowHtml(forma = 'PIX', valor = '', data = '') {
  const d = data || hojeISO();
  return `<div class="rec-pag-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
    <select class="form-control rec-pag-forma" style="flex:1;min-width:110px" onchange="recRecalc()">${REC_FORMAS.map(f => `<option ${f === forma ? 'selected' : ''}>${f}</option>`).join('')}</select>
    <input type="text" class="form-control rec-pag-valor" style="flex:1;min-width:100px" inputmode="numeric" placeholder="0,00" value="${valor}" oninput="maskMoneyBR(this);recRecalc()">
    <input type="date" class="form-control rec-pag-data" style="flex:1;min-width:130px" value="${d}" max="${hojeISO()}" title="Data em que o pagamento caiu">
    <button type="button" class="btn-icon" style="color:var(--danger);flex-shrink:0" onclick="recRemovePagamento(this)" title="Remover pagamento">${IC_TRASH_REC}</button>
  </div>`;
}
function recSoma() {
  return r2([...document.querySelectorAll('#rec-lista .rec-pag-valor')]
    .reduce((s, el) => s + parseMoneyBR(el.value), 0));
}

// ID oficial = nosso número interno; pedido Bling vira referência legada.
function fmtMostruario(obj) {
  if (obj?.numero_interno != null) return 'Mostruário #' + String(obj.numero_interno).padStart(4, '0');
  const ref = obj?.pedido_numero || obj?.maleta_ref;
  return ref ? `ref. Bling ${ref}` : 'Mostruário s/nº';
}

// ═══════════════════════════════════════════════════════════════════
// PIX BR Code (EMV/TLV) — payload "copia e cola" montado client-side.
// ═══════════════════════════════════════════════════════════════════
function tlv(id, val) { return id + String(val.length).padStart(2, '0') + val; }

// CRC16-CCITT (poly 0x1021, init 0xFFFF), HEX maiúsculo com 4 dígitos.
function crc16(str) {
  let crc = 0xFFFF;
  for (const ch of str) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Sem acentos/caracteres especiais e truncado (nome máx 25, cidade máx 15).
function sanitizePix(s, max) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);
}

export function montarPixCopiaECola({ chave, nome, cidade, valor, txid }) {
  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', String(chave).trim());
  const tx = (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';
  let p = tlv('00', '01')
    + tlv('26', mai)
    + tlv('52', '0000')
    + tlv('53', '986')
    + tlv('54', Number(valor).toFixed(2))
    + tlv('58', 'BR')
    + tlv('59', sanitizePix(nome, 25))
    + tlv('60', sanitizePix(cidade, 15))
    + tlv('62', tlv('05', tx))
    + '6304';
  return p + crc16(p);
}

// ═══════════════════════════════════════════════════════════════════
// MODAL DE RECEBIMENTO — abre após finalizar/corrigir a maleta e ao
// reabrir pelo histórico/Financeiro. Suporta recebimentos parciais.
// ═══════════════════════════════════════════════════════════════════
let recCtx = null; // { fech, saldo, jaRecebido, teste, pixCola }

// Chamado ao FECHAR o modal de recebimento pelo X/Esc: avisa se ainda há
// saldo a receber (recebimento obrigatório — não some sem registrar).
export function avisarRecebimentoPendente() {
  if (recCtx && !recCtx.teste && Number(recCtx.saldo) > 0.001) {
    toast('Recebimento pendente — registre pelo Financeiro ou no histórico do ciclo.');
  }
}

export async function abrirRecebimento(fechamentoId) {
  const { data: f, error } = await sbQ(sb.from('fechamentos_mostruario').select('*').eq('id', fechamentoId).single());
  if (error || !f) {
    console.error('Recebimento — fechamento:', error);
    toast('Fechamento não encontrado' + (error ? `: ${error.message}` : ''));
    return;
  }
  if (f.valor_a_receber == null) { toast('Este fechamento não tem comissão/valor a receber definido.'); return; }

  const { data: lans, error: eL } = await sbQ(sb.from('financeiro_lancamentos')
    .select('valor,pago,forma_pagamento,data_recebimento').eq('fechamento_id', fechamentoId));
  if (eL && !/financeiro_lancamentos|relation|schema cache/i.test(eL.message || '')) console.error('Recebimento — lançamentos:', eL);
  if (eL && /financeiro_lancamentos|relation|schema cache/i.test(eL.message || '')) {
    toast('Tabela do financeiro não existe — rode a migração 0009 no Supabase.');
    return;
  }
  const jaRecebido = r2((lans || []).filter(l => l.pago).reduce((s, l) => s + Number(l.valor), 0));
  const saldo = r2(Number(f.valor_a_receber) - jaRecebido);
  const teste = ehRevTeste(f.revendedora_id);
  recCtx = { fech: f, saldo, jaRecebido, teste, pixCola: '' };

  const body = document.getElementById('recebimento-body');
  const quitado = saldo <= 0.001;
  body.innerHTML = `
    ${teste ? '<div class="alert alert-warning" style="margin-bottom:12px;font-size:12.5px"><b>Conta de teste</b> — nada será lançado no financeiro.</div>' : ''}
    <div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--blush);margin-bottom:14px">
      <div style="font-weight:600;color:var(--plum)">${esc(f.revendedora_nome || 'Revendedora')}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${fmtMostruario(f)} · Fechado em ${formatDate(f.created_at)} · <span title="${esc(f.id)}" style="font-family:monospace">id ${idAbrev(f.id)}</span></div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:4px">
        Total vendido: <b>${fmtBRL(f.total_vendido_valor)}</b> ·
        Comissão: <b>${String(Number(f.comissao_percentual || 0)).replace('.', ',')}% · ${fmtBRL(f.comissao_valor)}</b>
        ${jaRecebido ? `<br>Já recebido: <b style="color:var(--success)">${fmtBRL(jaRecebido)}</b>` : ''}
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">${quitado ? 'Situação' : 'Valor a receber'}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:28px;color:${quitado ? 'var(--success)' : 'var(--rose)'}">${quitado ? 'Quitado ✓' : fmtBRL(saldo)}</div>
    </div>
    ${quitado ? '' : `
    <div style="text-align:center;margin-bottom:12px">
      <div id="pix-qr-wrap">
        <canvas id="pix-qr" style="border:1px solid var(--border);border-radius:12px;padding:6px;background:#fff"></canvas>
        <div id="pix-qr-valor" style="font-size:12.5px;color:var(--muted);margin-top:4px"></div>
        <div id="pix-qr-erro" style="display:none;font-size:12px;color:var(--danger)"></div>
        <div><button class="btn btn-outline" style="margin-top:8px" onclick="copiarPixCola()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copiar código PIX</button></div>
      </div>
      <div id="pix-qr-vazio" style="display:none;font-size:12.5px;color:var(--muted);padding:16px 0">Sem valor no PIX — nada a cobrar via QR.</div>
    </div>
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Pagamentos recebidos</div>
    <div id="rec-lista">${recRowHtml('PIX', '')}</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn-secondary btn-sm" onclick="recAddPagamento()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Adicionar pagamento</button>
      <button class="btn-secondary btn-sm" onclick="recAtalho('PIX')">Tudo via PIX</button>
      <button class="btn-secondary btn-sm" onclick="recAtalho('Dinheiro')">Tudo em dinheiro</button>
    </div>
    <div class="form-group">
      <label class="form-label">Vencimento do restante (máx. 15 dias)</label>
      <input type="date" id="rec-venc" class="form-control" value="${hojeISO()}" min="${hojeISO()}"
        max="${new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)}">
      <div style="font-size:11px;color:var(--muted);margin-top:3px">Usado só se sobrar valor a receber.</div>
    </div>
    <div style="display:flex;gap:18px;font-size:13px;margin-bottom:14px">
      <span>Recebido agora: <b id="rec-agora" style="color:var(--success)">${fmtBRL(0)}</b></span>
      <span>Restante: <b id="rec-restante" style="color:var(--rose)">${fmtBRL(saldo)}</b></span>
    </div>
    <button class="btn btn-primary" style="width:100%" ${teste ? 'disabled title="Conta de teste — nada é lançado"' : ''} onclick="registrarRecebimento(this)">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${teste ? 'Conta de teste (não lança)' : 'Registrar recebimento'}</button>`}`;
  openModal('modal-recebimento');
  if (!quitado) {
    // carrega a config uma vez e gera o QR do valor por PIX (default = saldo)
    const { data: cfg, error: eCfg } = await sbQ(sb.from('config_pix').select('*').eq('id', 1).maybeSingle());
    if (eCfg || !cfg) {
      console.error('Config PIX:', eCfg);
      const err = document.getElementById('pix-qr-erro');
      if (err) { err.style.display = 'block'; err.textContent = 'Config PIX não encontrada — rode a migração 0009 e configure em Financeiro.'; }
      const c = document.getElementById('pix-qr'); if (c) c.style.display = 'none';
    } else {
      recCtx.cfg = cfg;
      atualizarQrPix();
    }
  }
}

// O QR reflete SEMPRE o campo "Valor por PIX": dividir o pagamento com
// dinheiro reduz o QR junto; PIX zerado esconde o QR (nada a cobrar).
async function atualizarQrPix() {
  if (!recCtx?.cfg) return;
  const wrap = document.getElementById('pix-qr-wrap');
  const vazio = document.getElementById('pix-qr-vazio');
  if (!wrap || !vazio) return;
  // QR = o que ainda falta receber (saldo − pagamentos já lançados agora).
  const valorPix = r2(Math.max(0, recCtx.saldo - recSoma()));
  if (valorPix <= 0) {
    wrap.style.display = 'none'; vazio.style.display = 'block';
    recCtx.pixCola = '';
    return;
  }
  wrap.style.display = ''; vazio.style.display = 'none';
  try {
    recCtx.pixCola = montarPixCopiaECola({
      chave: recCtx.cfg.chave_pix, nome: recCtx.cfg.nome_recebedor, cidade: recCtx.cfg.cidade,
      valor: valorPix, txid: 'LZ' + String(recCtx.fech.id).replace(/-/g, '').slice(0, 20),
    });
    const QRCode = (await import('qrcode')).default;
    await QRCode.toCanvas(document.getElementById('pix-qr'), recCtx.pixCola, { width: 220, margin: 1 });
    const lbl = document.getElementById('pix-qr-valor');
    if (lbl) lbl.textContent = 'QR do restante: ' + fmtBRL(valorPix);
  } catch (e) {
    console.error('QR PIX:', e);
    const err = document.getElementById('pix-qr-erro');
    if (err) { err.style.display = 'block'; err.textContent = 'Não foi possível gerar o QR: ' + e.message; }
  }
}

export function copiarPixCola() {
  if (!recCtx?.pixCola) { toast('QR ainda não gerado'); return; }
  navigator.clipboard.writeText(recCtx.pixCola)
    .then(() => toast('Código PIX copiado!'))
    .catch(() => toast('Não foi possível copiar — selecione manualmente.'));
}

let qrTimer = null;

export function recRecalc() {
  const agora = recSoma();
  const rest = r2(recCtx.saldo - agora);
  const elA = document.getElementById('rec-agora');
  const elR = document.getElementById('rec-restante');
  if (elA) elA.textContent = fmtBRL(agora);
  if (elR) {
    elR.textContent = fmtBRL(Math.max(0, rest));
    elR.style.color = rest < -0.001 ? 'var(--danger)' : 'var(--rose)';
  }
  if (rest < -0.001) toast('Recebido maior que o valor a receber — confira os valores.');
  // regenera o QR com debounce (não a cada tecla)
  clearTimeout(qrTimer);
  qrTimer = setTimeout(atualizarQrPix, 300);
}

// Adiciona uma linha de pagamento (outra forma/valor exato).
export function recAddPagamento() {
  const lista = document.getElementById('rec-lista');
  if (!lista) return;
  lista.insertAdjacentHTML('beforeend', recRowHtml('PIX', ''));
  recRecalc();
}

// Remove a linha; nunca deixa a lista vazia (mantém 1 linha em branco).
export function recRemovePagamento(btn) {
  const row = btn.closest('.rec-pag-row');
  if (row) row.remove();
  const lista = document.getElementById('rec-lista');
  if (lista && !lista.querySelector('.rec-pag-row')) lista.innerHTML = recRowHtml('PIX', '');
  recRecalc();
}

// Atalho: uma única linha com o saldo inteiro na forma escolhida.
export function recAtalho(forma) {
  const lista = document.getElementById('rec-lista');
  if (!lista) return;
  lista.innerHTML = recRowHtml(forma, moneyToInput(recCtx.saldo));
  recRecalc();
}

export async function registrarRecebimento(btn) {
  if (recCtx.teste) { toast('Conta de teste — nada é lançado no financeiro.'); return; }
  const f = recCtx.fech;
  // Um lançamento por linha de pagamento (valores exatos p/ conciliação).
  const entradas = [...document.querySelectorAll('#rec-lista .rec-pag-row')].map(row => ({
    forma: row.querySelector('.rec-pag-forma').value,
    valor: r2(parseMoneyBR(row.querySelector('.rec-pag-valor').value)),
    data: row.querySelector('.rec-pag-data')?.value || hojeISO(),
  })).filter(e => e.valor > 0);
  const agora = r2(entradas.reduce((s, e) => s + e.valor, 0));
  if (agora <= 0) { toast('Informe ao menos um pagamento com valor.'); return; }
  if (agora > recCtx.saldo + 0.001) { toast('Recebido maior que o restante a receber — confira.'); return; }

  // Vencimento do restante: obrigatório, hoje até hoje+15 dias.
  const restante = r2(recCtx.saldo - agora);
  const venc = document.getElementById('rec-venc')?.value || '';
  if (restante > 0.001) {
    const maxVenc = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    if (!venc) { toast('Informe o vencimento do restante.'); return; }
    if (venc < hojeISO()) { toast('Vencimento não pode ser no passado.'); return; }
    if (venc > maxVenc) { toast('Vencimento máximo é de 15 dias (até ' + formatDate(maxVenc) + ').'); return; }
  }

  btn.disabled = true; btn.textContent = 'Registrando...';
  const reab = () => { btn.disabled = false; btn.innerHTML = 'Registrar recebimento'; };
  const base = {
    tipo: 'receber',
    descricao: `Acerto maleta — ${f.revendedora_nome || 'Revendedora'}`,
    pessoa_id: f.revendedora_id, pessoa_nome: f.revendedora_nome,
    categoria: 'Acerto de Vendas', origem: 'maleta',
    fechamento_id: f.id, maleta_ref: f.pedido_numero || null,
    numero_interno: f.numero_interno ?? null,
    fechamento_data: (f.created_at || '').slice(0, 10) || null,
  };
  const pagos = entradas.map(e => ({ ...base, forma_pagamento: e.forma, valor: e.valor, pago: true, data_recebimento: e.data }));

  // 1) grava os recebidos
  const e1 = await insLanc(pagos);
  if (e1) { console.error('Recebimento:', e1); toast(`Erro ao registrar: ${e1.message}`); reab(); return; }
  // 2) substitui a pendência pelo novo restante (recebimentos parciais)
  const { error: e2 } = await sbQ(sb.from('financeiro_lancamentos')
    .delete().eq('fechamento_id', f.id).eq('pago', false).eq('estornado', false));
  if (e2) { console.error('Recebimento (pendência):', e2); toast(`Recebido gravado, mas erro ao atualizar a pendência: ${e2.message}`); reab(); return; }
  if (restante > 0.001) {
    const e3 = await insLanc([{ ...base, valor: restante, pago: false, vencimento: venc, forma_pagamento: null }]);
    if (e3) { console.error('Recebimento (restante):', e3); toast(`Recebido gravado, mas erro ao criar a conta a receber: ${e3.message}`); reab(); return; }
  }

  toast(restante > 0.001
    ? `Recebimento registrado! Restam ${fmtBRL(restante)} a receber.`
    : 'Recebimento registrado — maleta quitada!');
  if (restante > 0.001) abrirRecebimento(f.id); // reabre atualizado p/ conferência
  else closeModal('modal-recebimento');
}

// Insert com fallback: colunas da 0010 ausentes → grava sem a referência.
async function insLanc(rows) {
  if (!rows.length) return null;
  let { error } = await sbQ(sb.from('financeiro_lancamentos').insert(rows));
  if (error && /numero_interno|fechamento_data/i.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
    console.warn('Colunas de referência ausentes (rode a migração 0010):', error.message);
    const limpos = rows.map(r => { const c = { ...r }; delete c.numero_interno; delete c.fechamento_data; return c; });
    ({ error } = await sbQ(sb.from('financeiro_lancamentos').insert(limpos)));
  }
  return error;
}

// ═══════════════════════════════════════════════════════════════════
// TELA FINANCEIRO (fase 1: A receber com vencimento/WhatsApp + recebidos)
// ═══════════════════════════════════════════════════════════════════
let finLancamentos = [];
let finTelefones = {};   // pessoa_id -> telefone (para o WhatsApp de cobrança)
let finChavePix = '';

export async function loadFinanceiro() {
  const panel = document.getElementById('panel-financeiro');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from('financeiro_lancamentos')
    .select('*').order('created_at', { ascending: false }).limit(300));
  if (error) {
    const dica = /relation|schema cache/i.test(error.message || '') ? ' Rode a migração 0009 no Supabase.' : '';
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></div><p>Erro ao carregar o financeiro.${dica}</p></div>`;
    return;
  }
  finLancamentos = data || [];
  const receb = finLancamentos.filter(l => l.tipo === 'receber');
  // Estornados não são pendência nem contam em Recebido — ficam no
  // histórico dos recebidos, riscados, para auditoria.
  const pendentes = receb.filter(l => !l.pago && !l.estornado);
  const recebidos = finLancamentos.filter(l => l.pago || l.estornado || l.tipo !== 'receber');
  const totalRecebido = receb.filter(l => l.pago && !l.estornado).reduce((s, l) => s + Number(l.valor), 0);
  const totalAReceber = pendentes.reduce((s, l) => s + Number(l.valor), 0);

  // Telefones das revendedoras pendentes (WhatsApp) + chave PIX p/ mensagem.
  finTelefones = {}; finChavePix = '';
  const ids = [...new Set(pendentes.map(l => l.pessoa_id).filter(Boolean))];
  if (ids.length) {
    const [tRes, cRes] = await Promise.all([
      sbQ(sb.from('profiles').select('id,telefone').in('id', ids)),
      sbQ(sb.from('config_pix').select('chave_pix').eq('id', 1).maybeSingle()),
    ]);
    (tRes.data || []).forEach(p => { finTelefones[p.id] = p.telefone || ''; });
    finChavePix = cRes.data?.chave_pix || '';
  }

  const hoje = hojeISO();
  const refLinha = l => `${fmtMostruario(l)}${l.fechamento_data ? ' · Fechado em ' + formatDate(l.fechamento_data) : ''}${l.fechamento_id ? ` · <span title="${esc(l.fechamento_id)}" style="font-family:monospace">id ${idAbrev(l.fechamento_id)}</span>` : ''}`;

  const rowsPend = pendentes.length ? pendentes.map(l => {
    const vencido = l.vencimento && l.vencimento < hoje;
    return `<tr class="ciclo-row">
      <td class="ciclo-td"><span class="ciclo-desc">${esc(l.pessoa_nome || l.descricao)}</span>
        <div style="font-size:11px;color:var(--muted)">${esc(l.categoria || '')} · ${refLinha(l)}</div></td>
      <td class="ciclo-td" style="text-align:right"><span class="ciclo-preco">${fmtBRL(l.valor)}</span></td>
      <td class="ciclo-td" style="white-space:nowrap;${vencido ? 'color:var(--danger);font-weight:600' : ''}">
        ${l.vencimento ? formatDate(l.vencimento) : '—'}${vencido ? ' ⚠ vencido' : ''}</td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        ${ehGestor() && l.fechamento_id ? `<button class="btn-secondary btn-sm" onclick="abrirRecebimento('${l.fechamento_id}')">Registrar pagamento</button>` : ''}
        ${finTelefones[l.pessoa_id] ? `<button class="btn-secondary btn-sm" style="border-color:#25D366;color:#128C7E" onclick="zapCobranca('${l.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg> WhatsApp</button>` : ''}
        ${IS_ADMIN ? `<button class="btn-icon" title="Excluir lançamento" style="color:var(--danger)" onclick="excluirLancamento('${l.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>` : ''}
      </td>
    </tr>`;
  }).join('') :
    '<tr><td colspan="4"><div class="empty-state" style="padding:18px 0"><p style="font-size:13px">Nenhuma conta a receber pendente 🎉</p></div></td></tr>';

  const rowsRec = recebidos.length ? recebidos.map(l => `
    <tr class="ciclo-row"${l.estornado ? ' style="opacity:.6"' : ''}>
      <td class="ciclo-td" style="white-space:nowrap">${formatDate(l.data_recebimento || l.vencimento || l.created_at)}</td>
      <td class="ciclo-td"><span class="ciclo-desc" ${l.estornado ? 'style="text-decoration:line-through"' : ''}>${esc(l.descricao)}</span>
        ${l.estornado ? `<span class="badge badge-aberta" style="font-size:10px;margin-left:6px" title="Estornado em ${formatDate(l.estornado_em)}${l.estorno_motivo ? ' — ' + esc(l.estorno_motivo) : ''}">Estornado</span>` : ''}
        <div style="font-size:11px;color:var(--muted)">${esc(l.categoria || '')}${l.forma_pagamento ? ' · ' + esc(l.forma_pagamento) : ''} · ${refLinha(l)}</div></td>
      <td class="ciclo-td">${esc(l.pessoa_nome || '—')}</td>
      <td class="ciclo-td" style="text-align:right"><span class="ciclo-preco" ${l.estornado ? 'style="text-decoration:line-through"' : ''}>${fmtBRL(l.valor)}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        ${l.pago && !l.estornado && l.tipo === 'receber' && podeEstornar()
          ? `<button class="btn-icon" title="Estornar recebimento" style="color:var(--danger)" onclick="estornarRecebimento('${l.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>` : ''}
        ${IS_ADMIN ? `<button class="btn-icon" title="Excluir lançamento" style="color:var(--danger)" onclick="excluirLancamento('${l.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>` : ''}
      </td>
    </tr>`).join('') :
    '<tr><td colspan="5"><div class="empty-state" style="padding:18px 0"><p style="font-size:13px">Nenhum recebimento ainda — feche uma maleta para começar.</p></div></td></tr>';

  panel.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Lançamentos</h2>
        <div class="sub">Recebimentos das maletas (fase 1) · contas de teste não entram</div>
      </div>
      <div class="acts">${ehGestor() ? `<button class="btn btn-outline" onclick="pixConfigAbrir()"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg> Config PIX</button>` : ''}</div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Recebido</span><span class="kpi-ic"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span></div><div class="kpi-val" style="color:var(--success)">${fmtBRL(totalRecebido)}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">A receber</span><span class="kpi-ic"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span></div><div class="kpi-val" style="color:var(--rose)">${fmtBRL(totalAReceber)}</div></div>
    </div>
    <div style="font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:8px 0">A receber (pendente)</div>
    <div class="pag-wrap" style="margin-bottom:18px"><table class="pag-table"><thead><tr>
      <th class="pag-th">Revendedora / referência</th><th class="pag-th" style="text-align:right">Valor</th>
      <th class="pag-th">Vencimento</th><th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody>${rowsPend}</tbody></table></div>
    <div style="font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:8px 0">Recebidos</div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Data</th><th class="pag-th">Descrição</th><th class="pag-th">Pessoa</th>
      <th class="pag-th" style="text-align:right">Valor</th><th class="pag-th"></th>
    </tr></thead><tbody>${rowsRec}</tbody></table></div>`;
}

// ── Estorno de recebimento (ação especial: admin ou permissão) ──────
// Não deleta (auditoria): marca estornado e devolve o valor à pendência
// do fechamento, preservando pagos + pendente = valor_a_receber.
export function estornarRecebimento(lancId) {
  if (!podeEstornar()) { toast('Sem permissão para estornar.'); return; }
  const l = finLancamentos.find(x => String(x.id) === String(lancId));
  if (!l || !l.pago || l.estornado) return;
  document.getElementById('cad-modal-titulo').textContent = 'Estornar recebimento';
  document.getElementById('cad-modal-body').innerHTML = `
    <div style="font-size:13.5px;margin-bottom:12px">Estornar este recebimento de <b style="color:var(--rose)">${fmtBRL(l.valor)}</b>
      (${esc(l.pessoa_nome || l.descricao)} · ${fmtMostruario(l)})?<br>
      <span style="color:var(--muted);font-size:12.5px">O valor voltará para "A receber". O lançamento fica no histórico marcado como estornado.</span></div>
    <div class="form-group"><label class="form-label">Motivo (opcional)</label>
      <textarea id="est-motivo" class="form-control" rows="2" placeholder="Ex.: PIX devolvido, valor lançado errado..."></textarea></div>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', `estornarConfirmar('${l.id}')`);
  openModal('modal-cadastro');
}

export async function estornarConfirmar(lancId) {
  const l = finLancamentos.find(x => String(x.id) === String(lancId));
  if (!l) return;
  const motivo = document.getElementById('est-motivo')?.value.trim() || null;

  // 1) marca o estorno (não deleta — auditoria)
  const { error: e1 } = await sbQ(sb.from('financeiro_lancamentos').update({
    estornado: true, pago: false,
    estornado_em: new Date().toISOString(),
    estornado_por: state.currentUser.id,
    estorno_motivo: motivo,
  }).eq('id', lancId));
  if (e1) {
    console.error('Estorno:', e1);
    const dica = /estornado|column|schema cache/i.test(e1.message || '') ? ' Rode a migração 0011.' : '';
    toast(`Erro ao estornar: ${e1.message}.${dica}`);
    return;
  }

  // 2) devolve o valor à pendência do fechamento (soma na aberta ou cria nova)
  if (l.fechamento_id) {
    const { data: pend, error: eP } = await sbQ(sb.from('financeiro_lancamentos')
      .select('id,valor').eq('fechamento_id', l.fechamento_id).eq('pago', false).eq('estornado', false).limit(1));
    if (eP) { console.error('Estorno (pendência):', eP); toast(`Estornado, mas erro ao localizar a pendência: ${eP.message}`); loadFinanceiro(); return; }
    if (pend?.length) {
      const { error: eU } = await sbQ(sb.from('financeiro_lancamentos')
        .update({ valor: r2(Number(pend[0].valor) + Number(l.valor)) }).eq('id', pend[0].id));
      if (eU) { console.error('Estorno (somar pendência):', eU); toast(`Estornado, mas erro ao atualizar a pendência: ${eU.message}`); loadFinanceiro(); return; }
    } else {
      const nova = { ...l };
      ['id', 'created_at', 'data_recebimento', 'estornado', 'estornado_em', 'estornado_por', 'estorno_motivo'].forEach(k => delete nova[k]);
      const eI = await insLanc([{ ...nova, pago: false, forma_pagamento: null,
        vencimento: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10) }]);
      if (eI) { console.error('Estorno (nova pendência):', eI); toast(`Estornado, mas erro ao recriar a conta a receber: ${eI.message}`); loadFinanceiro(); return; }
    }
  }

  closeModal('modal-cadastro');
  toast(`Recebimento de ${fmtBRL(l.valor)} estornado — valor voltou para "A receber".`);
  loadFinanceiro();
}

// WhatsApp de cobrança — mensagem cordial, dinâmica pelo vencimento.
export function zapCobranca(lancId) {
  const l = finLancamentos.find(x => String(x.id) === String(lancId));
  if (!l) return;
  let tel = String(finTelefones[l.pessoa_id] || '').replace(/\D/g, '');
  if (!tel) { toast('Revendedora sem telefone cadastrado.'); return; }
  if (!tel.startsWith('55') || tel.length <= 11) tel = '55' + tel;
  const primeiro = (l.pessoa_nome || '').trim().split(' ')[0] || 'tudo bem';
  const hoje = hojeISO();
  const vencFmt = l.vencimento ? formatDate(l.vencimento) : '';
  const frase = !l.vencimento ? 'está em aberto'
    : l.vencimento < hoje ? `venceu em ${vencFmt}`
    : l.vencimento === hoje ? `vence hoje (${vencFmt})`
    : `tem vencimento em ${vencFmt}`;
  const msg = `Oi ${primeiro}, tudo bem? 💗 Passando só para lembrar com carinho do acerto do seu mostruário (${fmtMostruario(l).replace('Mostruário ', 'Mostruário ')}) no valor de ${fmtBRL(l.valor)}, que ${frase}. ${finChavePix ? `Se preferir, a chave PIX é ${finChavePix}. ` : ''}Qualquer dúvida estou à disposição! Obrigada 🌸 — Lizzie Semijoias`;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Excluir lançamento — só admin (gate na UI + policy RESTRICTIVE 0022).
// Diferente do estorno: apaga de vez, sem devolver nada para "A receber".
export function excluirLancamento(id) {
  if (!IS_ADMIN) { toast('Só o administrador pode excluir lançamentos.'); return; }
  const l = finLancamentos.find(x => String(x.id) === String(id));
  if (!l) return;
  confirmarAcao('Excluir lançamento',
    `Excluir "${l.pessoa_nome || l.descricao || 'lançamento'}" de ${fmtBRL(l.valor)}? `
    + 'Diferente do estorno, nada volta para "A receber". Isso não pode ser desfeito.',
    'Excluir', async () => {
      const { error } = await sbQ(sb.from('financeiro_lancamentos').delete().eq('id', id));
      if (error) { console.error('Excluir lançamento:', error); toast(`Erro ao excluir: ${error.message}`); return; }
      toast('Lançamento excluído.');
      loadFinanceiro();
    });
}

// ── Config PIX (chave, nome máx 25, cidade máx 15) ──────────────────
export async function pixConfigAbrir() {
  const { data: cfg, error } = await sbQ(sb.from('config_pix').select('*').eq('id', 1).maybeSingle());
  if (error) { console.error('Config PIX:', error); toast(`Erro ao carregar: ${error.message}`); return; }
  const r = cfg || {};
  document.getElementById('cad-modal-titulo').textContent = 'Configuração do PIX';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Chave PIX (CNPJ/e-mail/telefone/aleatória) *</label>
      <input type="text" id="pix-f-chave" class="form-control" value="${esc(r.chave_pix || '')}"></div>
    <div class="form-group"><label class="form-label">Nome do recebedor (máx 25) *</label>
      <input type="text" id="pix-f-nome" class="form-control" maxlength="25" value="${esc(r.nome_recebedor || '')}"></div>
    <div class="form-group"><label class="form-label">Cidade (máx 15) *</label>
      <input type="text" id="pix-f-cidade" class="form-control" maxlength="15" value="${esc(r.cidade || '')}"></div>
    <div style="font-size:11px;color:var(--muted)">Como sai no comprovante do pagador. Sem acentos no QR (convertido automaticamente).</div>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', 'pixConfigSalvar()');
  openModal('modal-cadastro');
}

export async function pixConfigSalvar() {
  const chave = document.getElementById('pix-f-chave').value.trim();
  const nome = document.getElementById('pix-f-nome').value.trim();
  const cidade = document.getElementById('pix-f-cidade').value.trim();
  if (!chave || !nome || !cidade) { toast('Preencha chave, nome e cidade.'); return; }
  const { error } = await sbQ(sb.from('config_pix')
    .upsert({ id: 1, chave_pix: chave, nome_recebedor: nome, cidade, updated_at: new Date().toISOString() }));
  if (error) {
    console.error('Config PIX:', error);
    if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) return;
  }
  toast('Configuração do PIX salva!');
  closeModal('modal-cadastro');
}
