// Lançador de Maleta com bipe — lê código de barras (leitor USB/Bluetooth
// como teclado + câmera via BarcodeDetector), acha o produto no catálogo-mestre
// e monta a maleta (consignados) de uma revendedora. Só gestor/admin.
import { sb } from './supabase.js';
import { esc, toast, sbQ, fmtBRL, handleSupabaseError } from './utils.js';

const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_GEM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>';
const IC_CAM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

let revsAprovadas = [];
let carrinho = [];          // [{produto_id, descricao, referencia, preco_venda, foto_url, qtd}]
let maletasAbertas = [];    // maletas em aberto da revendedora selecionada: [{id,status,numero,created_at}]
let maletaDestino = null;   // destino do envio: { nova:true } ou { id, status, numero }

const STATUS_LABEL = { ativa: 'Ativa', aguardando: 'Aguardando', finalizada: 'Finalizada' };

function panel() { return document.getElementById('panel-lancador'); }

// ── som de bipe (WebAudio, sem arquivo) ──
let _audioCtx = null;
function beep(ok = true) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.type = 'square'; o.frequency.value = ok ? 1100 : 320;
    g.gain.value = 0.06; o.connect(g); g.connect(_audioCtx.destination);
    o.start(); o.stop(_audioCtx.currentTime + (ok ? 0.09 : 0.22));
  } catch { /* sem áudio, segue */ }
}

export async function loadLancador() {
  panel().innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from('profiles').select('id,nome').eq('role', 'revendedora').eq('aprovada', true).order('nome'));
  if (error) { if (await handleSupabaseError(error, 'Erro ao carregar revendedoras')) return; }
  revsAprovadas = data || [];
  carrinho = [];
  maletasAbertas = [];
  maletaDestino = null;
  render();
}

// Ao escolher a revendedora: carrega as maletas em aberto e reseta o destino.
export async function lancadorSelecionarRev(revId) {
  maletaDestino = null;
  maletasAbertas = [];
  if (revId) {
    const { data, error } = await sbQ(sb.from('maletas')
      .select('id,status,numero,created_at')
      .eq('revendedora_id', revId)
      .in('status', ['ativa', 'aguardando'])
      .order('created_at'));
    if (error) { if (await handleSupabaseError(error, 'Erro ao carregar maletas')) return; }
    maletasAbertas = data || [];
    // 1 sozinha em aberto: já assume como destino "continuar" (o usuário ainda pode trocar p/ nova).
    if (maletasAbertas.length === 1) maletaDestino = { ...maletasAbertas[0] };
  }
  render();
}

// Escolha do destino pelos botões da tela.
export function lancadorDestinoNova() { maletaDestino = { nova: true }; render(); }
export function lancadorDestinoExistente(id) {
  const m = maletasAbertas.find(x => String(x.id) === String(id));
  if (m) maletaDestino = { ...m };
  render();
}
export function lancadorTrocarDestino() { maletaDestino = null; render(); }

function render() {
  // preserva a revendedora escolhida entre renders (cada bipe re-renderiza tudo)
  const revSel = document.getElementById('lan-rev')?.value || '';
  const total = carrinho.reduce((s, i) => s + i.qtd, 0);
  const valor = carrinho.reduce((s, i) => s + i.qtd * (i.preco_venda || 0), 0);
  const rows = carrinho.length ? carrinho.map((i, idx) => `
    <tr class="ciclo-row"${idx === carrinho.length - 1 ? ' style="background:rgba(201,116,138,0.06)"' : ''}>
      <td class="ciclo-td"><div style="display:flex;align-items:center;gap:10px">
        <span class="ciclo-emoji">${i.foto_url ? `<img src="${esc(i.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : IC_GEM}</span>
        <div class="ciclo-desc">${esc(i.descricao)}</div>
      </div></td>
      <td class="ciclo-td"><span class="ciclo-ref">${i.referencia ? esc(i.referencia) : '—'}</span></td>
      <td class="ciclo-td" style="text-align:center">
        <input type="number" class="form-control" style="width:64px;text-align:center" value="${i.qtd}" min="1" oninput="lancadorSetQtd(${idx},this.value)"></td>
      <td class="ciclo-td"><span class="ciclo-preco">${fmtBRL(i.preco_venda || 0)}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${fmtBRL(i.qtd * (i.preco_venda || 0))}</span></td>
      <td class="ciclo-td" style="text-align:right"><button class="btn-icon" style="color:var(--danger)" onclick="lancadorRemover(${idx})">${IC_TRASH}</button></td>
    </tr>`).join('') :
    `<tr><td colspan="6"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_GEM}</div><p>Bipe a primeira peça para começar</p></div></td></tr>`;

  const podeEnviar = carrinho.length && maletaDestino;

  panel().innerHTML = `
    <div class="section-header"><div>
      <div class="section-title">Lançar Maleta</div>
      <div class="section-subtitle">Bipe as peças para montar a maleta da revendedora</div>
    </div></div>

    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Revendedora *</label>
        <select id="lan-rev" class="form-control" onchange="lancadorSelecionarRev(this.value)">
          <option value="">Selecione a revendedora...</option>
          ${revsAprovadas.map(r => `<option value="${r.id}" ${String(r.id) === revSel ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}
        </select></div>
    </div>

    ${maletaPanelHtml(revSel)}

    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Descrição</th><th class="pag-th">Código</th>
      <th class="pag-th" style="text-align:center">Quantidade</th>
      <th class="pag-th">Preço un</th><th class="pag-th">Preço total</th><th class="pag-th"></th>
    </tr></thead><tbody>${rows}</tbody></table></div>

    <div style="display:flex;gap:8px;margin:10px 0 18px">
      <input type="text" id="lan-scan" class="form-control" placeholder="Bipe ou digite o código e tecle Enter" autocomplete="off"
        onkeydown="if(event.key==='Enter'){event.preventDefault();lancadorBipar(this.value);this.value='';}">
      <button class="btn-secondary" title="Bipar com a câmera" onclick="lancadorCamera()">${IC_CAM}</button>
    </div>

    <div class="cart-total-row"><span>${total} peça${total !== 1 ? 's' : ''}</span><span>${fmtBRL(valor)}</span></div>

    <button class="btn-primary" style="width:100%;margin-top:12px" ${podeEnviar ? '' : 'disabled'} onclick="lancadorEnviar()">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      Enviar ${total} peça${total !== 1 ? 's' : ''} para a maleta</button>`;

  const scan = document.getElementById('lan-scan');
  if (scan) scan.focus({ preventScroll: true });
}

// Painel de escolha de maleta (aparece após selecionar a revendedora).
function maletaPanelHtml(revSel) {
  if (!revSel) return '';
  const temAtiva = maletasAbertas.some(m => m.status === 'ativa');
  const qtdAberta = maletasAbertas.length;
  const limite = qtdAberta >= 2;

  // Destino já escolhido: mostra resumo + opção de trocar.
  if (maletaDestino) {
    const txt = maletaDestino.nova
      ? `Nova maleta (será criada como <strong>${temAtiva ? 'Aguardando' : 'Ativa'}</strong>)`
      : `Continuar <strong>${STATUS_LABEL[maletaDestino.status] || maletaDestino.status}</strong>${maletaDestino.numero ? ` · maleta #${maletaDestino.numero}` : ''}`;
    return `<div class="card" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--plum)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px"><path d="M20 6 9 17l-5-5"/></svg> Destino: ${txt}</div>
      <button class="btn-secondary btn-sm" onclick="lancadorTrocarDestino()">Trocar</button>
    </div>`;
  }

  const resumo = qtdAberta
    ? `Esta revendedora tem <strong>${qtdAberta}</strong> maleta${qtdAberta > 1 ? 's' : ''} em aberto.`
    : 'Esta revendedora não tem maletas em aberto.';

  const botoesContinuar = maletasAbertas.map(m =>
    `<button class="btn-secondary btn-sm" style="border-color:var(--gold);color:var(--gold)" onclick="lancadorDestinoExistente('${m.id}')">
      Continuar ${STATUS_LABEL[m.status] || m.status}${m.numero ? ` #${m.numero}` : ''}</button>`).join('');

  const btnNova = limite
    ? `<button class="btn-secondary btn-sm" disabled title="Limite de 2 maletas em aberto atingido">Nova maleta (limite atingido)</button>`
    : `<button class="btn-secondary btn-sm" style="border-color:var(--rose);color:var(--rose)" onclick="lancadorDestinoNova()">+ Nova maleta${qtdAberta && !temAtiva ? ' (será Ativa)' : qtdAberta ? ' (será Aguardando)' : ''}</button>`;

  return `<div class="card" style="margin-bottom:14px">
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px">${resumo}${limite ? ' <span style="color:var(--danger)">Limite de 2 atingido — finalize uma para abrir outra.</span>' : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${botoesContinuar}${btnNova}</div>
  </div>`;
}

// ── busca o produto pelo código (produtos: cod. barras ou sku; e variações) ──
async function lookupProduto(code) {
  const c = (code || '').trim();
  if (!c) return null;
  let { data } = await sbQ(sb.from('produtos')
    .select('id,nome,sku,codigo_barras,preco_venda,foto_url')
    .or(`codigo_barras.eq.${c},sku.eq.${c}`).limit(1));
  if (data && data.length) return { ...data[0], referencia: data[0].sku || data[0].codigo_barras };
  // tenta nas variações
  const { data: v } = await sbQ(sb.from('produto_variacoes')
    .select('produto_id,valor,atributo,sku,codigo_barras,preco_venda,produtos(id,nome,sku,foto_url,preco_venda)')
    .eq('codigo_barras', c).limit(1));
  if (v && v.length) {
    const p = v[0].produtos || {};
    return {
      id: p.id, nome: `${p.nome || ''} — ${v[0].atributo}: ${v[0].valor}`,
      preco_venda: v[0].preco_venda ?? p.preco_venda, foto_url: p.foto_url,
      referencia: v[0].sku || v[0].codigo_barras,
    };
  }
  return null;
}

export async function lancadorBipar(code) {
  const c = (code || '').trim();
  if (!c) return;
  const prod = await lookupProduto(c);
  if (!prod) { beep(false); toast('Código não encontrado: ' + c); return; }
  // cada bipe = nova linha, sempre 1 unidade (não soma): cada peça física é 1 do estoque
  carrinho.push({ produto_id: prod.id, descricao: prod.nome, referencia: prod.referencia || null, preco_venda: prod.preco_venda || 0, foto_url: prod.foto_url || null, qtd: 1 });
  beep(true);
  render();
  focarCampoBipe();
}

// Mantém o campo de bipe visível e focado após cada leitura (estilo Bling).
function focarCampoBipe() {
  const scan = document.getElementById('lan-scan');
  if (!scan) return;
  scan.focus({ preventScroll: true });
  scan.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function lancadorSetQtd(idx, val) {
  if (!carrinho[idx]) return;
  carrinho[idx].qtd = Math.max(1, parseInt(val) || 1);
  // atualiza só o total (evita perder foco do input ao re-renderizar tudo)
  const total = carrinho.reduce((s, i) => s + i.qtd, 0);
  const valor = carrinho.reduce((s, i) => s + i.qtd * (i.preco_venda || 0), 0);
  const row = panel().querySelector('.cart-total-row');
  if (row) row.innerHTML = `<span>${total} peça${total !== 1 ? 's' : ''}</span><span>${fmtBRL(valor)}</span>`;
}
export function lancadorRemover(idx) { carrinho.splice(idx, 1); render(); }

export async function lancadorEnviar() {
  const revId = document.getElementById('lan-rev').value;
  if (!revId) { toast('Selecione a revendedora'); return; }
  if (!carrinho.length) { toast('Bipe ao menos uma peça'); return; }
  if (!maletaDestino) { toast('Escolha continuar uma maleta ou criar uma nova'); return; }

  const btn = panel().querySelector('.btn-primary[onclick="lancadorEnviar()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  const reabilita = () => { if (btn) { btn.disabled = false; btn.textContent = 'Enviar para a maleta'; } };

  // 1) Resolve a maleta de destino (cria a nova se for o caso).
  let maletaId = maletaDestino.nova ? null : maletaDestino.id;
  if (maletaDestino.nova) {
    const temAtiva = maletasAbertas.some(m => m.status === 'ativa');
    // número sequencial simples por revendedora
    const { count } = await sb.from('maletas').select('id', { count: 'exact', head: true }).eq('revendedora_id', revId);
    const novaMaleta = { revendedora_id: revId, status: temAtiva ? 'aguardando' : 'ativa', numero: (count || 0) + 1 };
    const { data: mData, error: mErr } = await sb.from('maletas').insert(novaMaleta).select('id').single();
    if (mErr) {
      reabilita();
      if (/limite atingido|2 maletas/i.test(mErr.message || '')) { toast('Limite de 2 maletas em aberto atingido.'); return; }
      if (await handleSupabaseError(mErr, 'Erro ao criar maleta')) return;
      toast('Erro ao criar maleta: ' + (mErr.message || '')); return;
    }
    maletaId = mData.id;
  }

  // 2) Insere as peças vinculadas à maleta.
  const linhas = carrinho.map(i => ({
    revendedora_id: revId,
    maleta_id: maletaId,
    produto_id: i.produto_id,
    descricao: i.descricao,
    referencia: i.referencia,
    quantidade_enviada: i.qtd,
    quantidade_vendida: 0,
    quantidade_devolvida: 0,
    preco_venda: i.preco_venda || null,
    foto_url: i.foto_url,
    status: 'ativo',
  }));
  const { error } = await sb.from('consignados').insert(linhas);
  if (error) {
    reabilita();
    if (await handleSupabaseError(error, 'Erro ao enviar maleta')) return;
    toast('Erro: ' + (error.message || 'tente novamente')); render(); return;
  }
  const totalPecas = carrinho.reduce((s, i) => s + i.qtd, 0);
  toast(`${totalPecas} peça${totalPecas !== 1 ? 's' : ''} enviada${totalPecas !== 1 ? 's' : ''} para a maleta!`);
  carrinho = [];
  // recarrega as maletas em aberto (a nova já entra) e limpa o destino
  await lancadorSelecionarRev(revId);
}

// ════════════════════════════════════════════════════════════════════
// CÂMERA (BarcodeDetector nativo)
// ════════════════════════════════════════════════════════════════════
let _scanStream = null, _scanLoop = null, _scanMode = 'continuo', _scanTargetInput = null;

function suportaCamera() {
  return 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
}

async function abrirCamera(mode, targetInput) {
  if (!suportaCamera()) {
    toast('Câmera de bipe não suportada neste navegador. Use o leitor USB ou digite o código.');
    return;
  }
  _scanMode = mode; _scanTargetInput = targetInput || null;
  document.getElementById('modal-scanner').classList.add('show');
  const video = document.getElementById('scanner-video');
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = _scanStream; await video.play();
  } catch {
    toast('Não foi possível abrir a câmera (permissão negada?)');
    fecharCamera(); return;
  }
  const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'code_39', 'qr_code'] });
  let ultimo = '', ultimoT = 0;
  const tick = async () => {
    if (!_scanStream) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const val = codes[0].rawValue;
        const agora = Date.now();
        if (val && (val !== ultimo || agora - ultimoT > 1500)) {
          ultimo = val; ultimoT = agora;
          beep(true);
          if (_scanMode === 'single') {
            if (_scanTargetInput) { const el = document.getElementById(_scanTargetInput); if (el) el.value = val; }
            fecharCamera(); return;
          } else {
            lancadorBipar(val);
          }
        }
      }
    } catch { /* frame sem leitura */ }
    _scanLoop = requestAnimationFrame(tick);
  };
  _scanLoop = requestAnimationFrame(tick);
}

export function fecharCamera() {
  if (_scanLoop) cancelAnimationFrame(_scanLoop);
  _scanLoop = null;
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  const m = document.getElementById('modal-scanner');
  if (m) m.classList.remove('show');
}

export function lancadorCamera() { abrirCamera('continuo', null); }
// usado pelo formulário de produto (uma leitura preenche o input)
export function scanBarcodeInto(inputId) { abrirCamera('single', inputId); }
