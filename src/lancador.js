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
  const { data, error } = await sbQ(sb.from('profiles').select('id,nome').eq('is_revendedora', true).eq('aprovada', true).order('nome'));
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
  const dataTrocaSel = document.getElementById('lan-data-troca')?.value || '';
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
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Data de troca</label>
        <input type="date" id="lan-data-troca" class="form-control" value="${dataTrocaSel}">
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Aparece na tela de Trocas. Pode deixar em branco e definir depois.</div></div>
    </div>

    ${maletaPanelHtml(revSel)}

    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Descrição</th><th class="pag-th">Código</th>
      <th class="pag-th" style="text-align:center">Quantidade</th>
      <th class="pag-th">Preço un</th><th class="pag-th">Preço total</th><th class="pag-th"></th>
    </tr></thead><tbody>${rows}</tbody></table></div>

    <div style="display:flex;gap:8px;margin:10px 0 18px">
      <input type="text" id="lan-scan" class="form-control" placeholder="Bipe ou digite o código e tecle Enter · F3 busca por nome/preço" autocomplete="off"
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

// Caminho ÚNICO de adição ao carrinho (bipe, câmera e busca F3 usam este).
// Cada adição = nova linha, sempre 1 unidade (não soma): cada peça física é 1 do estoque.
function carrinhoAdd(prod) {
  carrinho.push({ produto_id: prod.id, descricao: prod.nome, referencia: prod.referencia || null, preco_venda: prod.preco_venda || 0, foto_url: prod.foto_url || null, qtd: 1 });
  beep(true);
  render();
}

export async function lancadorBipar(code) {
  const c = (code || '').trim();
  if (!c) return;
  const prod = await lookupProduto(c);
  if (!prod) { beep(false); toast('Código não encontrado: ' + c); return; }
  carrinhoAdd(prod);
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

  // Data de troca (opcional): grava na maleta. Best-effort — nao quebra o envio
  // se a coluna data_troca ainda nao existir no banco.
  const dataTroca = document.getElementById('lan-data-troca')?.value || null;
  if (dataTroca) {
    try { await sb.from('maletas').update({ data_troca: dataTroca }).eq('id', maletaId); } catch (e) { /* coluna ausente: ignora */ }
  }

  // 2) Insere as peças vinculadas à maleta.
  // ESTOQUE: hoje o envio NÃO baixa produtos.estoque_qtd. Quando a baixa
  // central existir, checar utils.ehRevTeste(revId) e PULAR contas de teste.
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

// ════════════════════════════════════════════════════════════════════
// BUSCA DE PRODUTOS (F3) — pesquisa multi-critério e adiciona à maleta
// pelo MESMO caminho do bipe (carrinhoAdd). Só ativa na tela do lançador.
// ════════════════════════════════════════════════════════════════════
let f3Resultados = [];
let f3Sel = 0;
let f3Timer = null;

function f3ModalAberto() {
  return document.getElementById('modal-busca-produto')?.classList.contains('show');
}

function lancadorVisivel() {
  const p = panel();
  return p && p.style.display !== 'none' && document.getElementById('app')?.style.display !== 'none';
}

// Atalho global: F3 abre/foca a busca APENAS com o lançador visível
// (fora dele, o F3 nativo do navegador continua funcionando).
document.addEventListener('keydown', (e) => {
  if (e.key === 'F3' && lancadorVisivel()) {
    e.preventDefault();
    lancadorAbrirBusca();
  } else if (e.key === 'Escape' && f3ModalAberto()) {
    lancadorFecharBusca();
  }
});

export function lancadorAbrirBusca() {
  const input = document.getElementById('f3-search');
  input.value = '';
  f3Resultados = []; f3Sel = 0;
  document.getElementById('f3-results').innerHTML =
    '<div class="loading" style="padding:20px 0"><div class="spinner">⟳</div></div>';
  document.getElementById('modal-busca-produto').classList.add('show');
  setTimeout(() => input.focus(), 60);
  f3Buscar(); // já abre listando os primeiros produtos (sem precisar digitar)
}

export function lancadorFecharBusca() {
  document.getElementById('modal-busca-produto').classList.remove('show');
  focarCampoBipe(); // devolve o foco ao input de bipe
}

export function lancadorBuscaInput() {
  clearTimeout(f3Timer);
  f3Timer = setTimeout(f3Buscar, 250); // debounce
}

async function f3Buscar() {
  const termo = (document.getElementById('f3-search').value || '').trim();

  let q = sb.from('produtos')
    .select('id,nome,sku,codigo_barras,codigo_fornecedor,preco_venda,foto_url')
    .eq('ativo', true);
  if (termo) {
    // OR multi-critério. Aspas no padrão protegem vírgulas/caracteres do or().
    const t = termo.replace(/"/g, '');
    const ors = [`nome.ilike."%${t}%"`, `sku.ilike."%${t}%"`, `codigo_fornecedor.ilike."%${t}%"`, `codigo_barras.ilike."%${t}%"`];
    const num = parseFloat(termo.replace(',', '.'));
    if (!isNaN(num) && /^[\d.,]+$/.test(termo)) ors.push(`preco_venda.eq.${num}`);
    q = q.or(ors.join(','));
  }
  // Sem termo: lista inicial (primeiros 50 por nome).
  const { data, error } = await sbQ(q.order('nome').limit(50));
  if (error) {
    console.error('Busca de produtos (F3):', error);
    toast(`Erro na busca: ${error.message || 'tente novamente'}`);
    return;
  }
  f3Resultados = data || [];
  f3Sel = 0;
  f3Render(termo);
}

// Destaca o termo casado (em texto já escapado, com termo escapado).
function f3Marca(valor, termo) {
  const s = esc(valor || '');
  const t = esc(termo);
  if (!t) return s;
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return s.replace(re, m => `<b style="color:var(--rose)">${m}</b>`);
}

function f3Render(termo) {
  const div = document.getElementById('f3-results');
  if (!f3Resultados.length) {
    div.innerHTML = `<div class="empty-state" style="padding:20px 0"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div><p>${termo ? `Nenhum produto encontrado para "${esc(termo)}"` : 'Nenhum produto ativo cadastrado'}</p></div>`;
    return;
  }
  const nota = f3Resultados.length >= 50
    ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px 0">Mostrando os primeiros 50 — refine a busca para encontrar mais.</div>'
    : '';
  div.innerHTML = nota + f3Resultados.map((p, i) => `
    <div class="f3-row${i === f3Sel ? ' sel' : ''}" onclick="lancadorBuscaAdicionar(${i})">
      <div style="flex:1;min-width:0">
        <div class="ciclo-desc">${f3Marca(p.nome, termo)}</div>
        <div class="f3-meta">
          <span>SKU ${f3Marca(p.sku || '—', termo)}</span>
          <span>FORN ${f3Marca(p.codigo_fornecedor || '—', termo)}</span>
        </div>
      </div>
      <span class="ciclo-preco" style="white-space:nowrap">${fmtBRL(p.preco_venda || 0)}</span>
    </div>`).join('');
  div.querySelector('.f3-row.sel')?.scrollIntoView({ block: 'nearest' });
}

export function lancadorBuscaTeclas(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (f3Resultados.length) { f3Sel = Math.min(f3Sel + 1, f3Resultados.length - 1); f3Render(e.target.value.trim()); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (f3Resultados.length) { f3Sel = Math.max(f3Sel - 1, 0); f3Render(e.target.value.trim()); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (f3Resultados.length) lancadorBuscaAdicionar(f3Sel);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    lancadorFecharBusca();
  }
}

export function lancadorBuscaAdicionar(idx) {
  const p = f3Resultados[idx];
  if (!p) return;
  // Mesmo caminho do bipe (quantidade, preço e total seguem a regra atual).
  carrinhoAdd({ id: p.id, nome: p.nome, preco_venda: p.preco_venda, foto_url: p.foto_url, referencia: p.sku || p.codigo_barras });
  toast(`Adicionado: ${p.nome}`);
  // Modal fica aberto p/ adicionar várias em sequência; limpa a busca, volta
  // à lista inicial e refoca (o render() do carrinho foca o bipe — retoma aqui).
  const input = document.getElementById('f3-search');
  input.value = '';
  f3Sel = 0;
  f3Buscar();
  setTimeout(() => input.focus(), 0);
}
