// ═══════════════════════════════════════════════════════════════════
// Etiquetas Zebra (ZPL) — geração da linguagem de impressão + integração
// com o Zebra Browser Print (serviço local Windows que enxerga impressoras
// USB e de rede já cadastradas nele — download em zebra.com, Support & Downloads
// → Printer Software → Browser Print).
//
// Por que não window.print(): etiqueta térmica precisa de posicionamento
// exato em milímetros; o jeito confiável é gerar ZPL e mandar direto pra
// impressora, sem passar pela caixa de diálogo de impressão do navegador.
//
// Etiqueta padrão: 30×20mm (calibrado na prática, ver histórico de revisões
// abaixo) — código de barras (Code128) + SKU + preço. Sem nome/banho (não
// cabe). Barcode = codigo_barras do produto, ou o SKU quando não houver (a
// Entrada de Mercadoria em lote nunca grava codigo_barras — todo lote cai
// no fallback do SKU). Suporta rolos com várias etiquetas lado a lado
// (config "Colunas no rolo") — o Browser Print manda ZPL cru, sem passar
// pelo driver do Windows que normalmente cuidaria disso sozinho.
// ═══════════════════════════════════════════════════════════════════
import { esc, fmtBRL, toast, openModal, closeModal } from './utils.js';
import { showPanel } from './nav.js';

const dotsPorMm = dpi => dpi / 25.4;
const mm = (valorMm, dpi) => Math.round(valorMm * dotsPorMm(dpi));

// Constantes de calibração (em dots, computadas pro dpi da vez). PONTO DE
// PARTIDA — 30×20mm é apertado (barra + 2 linhas de texto): quase sempre
// precisa de ajuste fino na etiqueta física, na impressora real. Isso não é
// bug — é calibração de hardware. Histórico das revisões:
// Rev. 3: a largura da BARRA (Code128) não era limitada pela margem — só o
// texto do preço era. SKU real (mais longo que o "TESTE-001" do botão de
// teste) alarga a barra e estoura a direita, MESMO com MARGEM_X maior.
// Módulo mais fino (2→1) reduz a largura da barra pra qualquer SKU — se
// ficar difícil de ler no leitor, volte pra 2 e reduza a fonte do SKU/preço
// em vez disso (dá menos espaço ao código de barras).
// Rev. 4: a foto do teste 2 mostrou muito mais sobra embaixo do preço do
// que 15mm de altura permitiriam (só 0.8mm de folga na rev.3) — forte
// indício de que a etiqueta física real não é 15mm, e sim ~20mm. Desceu
// tudo ~3mm dentro da altura nova.
// Rev. 5: "código de barras muito pequeno" — aumentada a ALTURA da barra
// (não o módulo/largura: mantém a folga lateral da rev.3). Foi longe demais
// (7mm) e cortou o preço embaixo.
// Rev. 6: recuou pra dentro da faixa comprovada segura (a rev.4, terminando
// em 17.2mm, NÃO cortou; a rev.5, em 18.7mm, cortou — a altura real está
// entre essas duas). Barra fica 6mm (ganho parcial sobre o original 5.5mm).
// Aumentar a LARGURA (módulo) não é seguro pro SKU real; avisar quando
// confirmar a largura física real da etiqueta.
function calibracao(dpi) {
  return {
    MARGEM_X: mm(2.5, dpi),      // margem esquerda/direita
    BARRA_Y: mm(4.5, dpi),       // topo da etiqueta
    BARRA_ALTURA: mm(6, dpi),    // altura das barras
    BARRA_MODULO: 1,             // ^BY — largura do módulo (1 = mais fino)
    SKU_Y: mm(11, dpi),          // logo abaixo da barra
    SKU_FONTE: 20,               // altura/largura da fonte (dots)
    PRECO_Y: mm(13.8, dpi),
    PRECO_FONTE: 26,
    // Etiqueta de texto livre (sem barra) — fonte grande, centralizada,
    // quebra em até 3 linhas. Ponto de partida, mesma lógica de calibração.
    TEXTO_Y: mm(6, dpi),
    TEXTO_FONTE: 28,
    TEXTO_LINHAS: 3,
  };
}

// ZPL usa ^ e ~ como caracteres de controle — tira do conteúdo antes de
// jogar num campo ^FD, senão um texto digitado com um desses quebra o
// comando (mais relevante na etiqueta de texto livre, digitada à mão).
const zplSafe = s => String(s || '').replace(/[\^~]/g, '');

// Campos ZPL de UMA etiqueta (sem ^XA/^PW/^LL/^XZ) — usado sozinho
// (gerarZPL) e lado a lado em uma linha com várias colunas (gerarZPLLinha).
// offsetXdots desloca tudo pra direita (coluna 2, 3...). Se `produto.texto`
// existir, é etiqueta de TEXTO LIVRE (sem barra/SKU/preço) — ex.: "Pedra
// Ametista", nome de revendedora.
function camposEtiqueta(produto, offsetXdots, larguraColDots, dpi) {
  const c = calibracao(dpi);
  const x = offsetXdots + c.MARGEM_X;
  const larguraUtil = larguraColDots - 2 * c.MARGEM_X;

  if (produto.texto != null) {
    const texto = zplSafe(produto.texto).trim() || ' ';
    return `^FO${x},${c.TEXTO_Y}^A0N,${c.TEXTO_FONTE},${c.TEXTO_FONTE}^FB${larguraUtil},${c.TEXTO_LINHAS},2,C^FD${texto}^FS`;
  }

  const barcode = zplSafe(produto.codigo_barras || produto.sku || '').trim();
  const sku = zplSafe(produto.sku || '').trim();
  const preco = fmtBRL(produto.preco_venda);
  return [
    `^FO${x},${c.BARRA_Y}^BY${c.BARRA_MODULO}`,
    `^BCN,${c.BARRA_ALTURA},N,N,N`,
    `^FD${barcode}^FS`,
    `^FO${x},${c.SKU_Y}^A0N,${c.SKU_FONTE},${c.SKU_FONTE}^FD${sku}^FS`,
    `^FO${x},${c.PRECO_Y}^A0N,${c.PRECO_FONTE},${c.PRECO_FONTE}^FB${larguraUtil},1,0,R^FD${preco}^FS`,
  ].join('\n');
}

// Gera o ZPL de UMA etiqueta sozinha (produto + quantas cópias, via ^PQ).
export function gerarZPL(produto, opts = {}) {
  const { dpi = 203, larguraMm = 30, alturaMm = 20, qtd = 1 } = opts;
  const w = mm(larguraMm, dpi);
  const h = mm(alturaMm, dpi);
  return ['^XA', `^PW${w}`, `^LL${h}`, '^CI28', camposEtiqueta(produto, 0, w, dpi), `^PQ${qtd}`, '^XZ'].join('\n');
}

// Uma LINHA física com até `colunas` etiquetas lado a lado — rolo com N
// colunas. O Browser Print manda ZPL cru direto pra impressora, sem passar
// pelo driver do Windows (que normalmente cuidaria do multi-coluna), então
// o layout tem que ser desenhado aqui, à mão. `itens` com menos de
// `colunas` posições deixa o resto da linha em branco.
function gerarZPLLinha(itens, opts) {
  const { dpi = 203, larguraMm = 30, alturaMm = 20, colunas = 1, gapMm = 2 } = opts;
  const larguraColDots = mm(larguraMm, dpi);
  const gapDots = mm(gapMm, dpi);
  const w = larguraColDots * colunas + gapDots * (colunas - 1);
  const h = mm(alturaMm, dpi);
  const campos = itens
    .map((p, i) => p ? camposEtiqueta(p, i * (larguraColDots + gapDots), larguraColDots, dpi) : '')
    .filter(Boolean)
    .join('\n');
  return ['^XA', `^PW${w}`, `^LL${h}`, '^CI28', campos, '^PQ1', '^XZ'].join('\n');
}

// Concatena o ZPL de vários produtos numa única transmissão. Com 1 coluna
// (padrão) mantém o formato de sempre — 1 ^XA por SKU distinto, com ^PQ pra
// repetir. Com 2+ colunas, "estoura" as quantidades em etiquetas
// individuais e desenha linha por linha, `colunas` por vez.
export function gerarZPLLote(produtos, opts = {}) {
  const colunas = opts.colunas || 1;
  if (colunas <= 1) {
    return produtos.map(p => gerarZPL(p, { ...opts, qtd: p.qtd || 1 })).join('\n');
  }
  const flat = [];
  produtos.forEach(p => { for (let k = 0; k < (p.qtd || 1); k++) flat.push(p); });
  const linhas = [];
  for (let i = 0; i < flat.length; i += colunas) linhas.push(flat.slice(i, i + colunas));
  return linhas.map(row => gerarZPLLinha(row, opts)).join('\n');
}

// ── Zebra Browser Print (SDK vendorizado — ver index.html + public/vendor) ──
export function temBrowserPrint() {
  return typeof window !== 'undefined' && !!window.BrowserPrint;
}

export function listarImpressoras() {
  return new Promise((resolve, reject) => {
    if (!temBrowserPrint()) { reject(new Error('Zebra Browser Print não detectado neste computador.')); return; }
    window.BrowserPrint.getLocalDevices(
      devices => resolve(devices || []),
      error => reject(new Error(error || 'Erro ao listar impressoras.')),
      'printer'
    );
  });
}

export function enviarParaImpressora(device, zpl) {
  return new Promise((resolve, reject) => {
    if (!device) { reject(new Error('Nenhuma impressora selecionada.')); return; }
    device.send(zpl,
      () => resolve(true),
      error => reject(new Error(error || 'Erro ao enviar para a impressora.')));
  });
}

// ── Fallback: baixa o .zpl para envio manual (Browser Print ausente) ──
export function baixarZPL(nomeArquivo, zpl) {
  const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo.endsWith('.zpl') ? nomeArquivo : `${nomeArquivo}.zpl`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ── Config da impressora — preferência de MÁQUINA, não de negócio (fica
// só no localStorage do computador, sem tabela nova no Supabase) ──
const CFG_KEY = 'lizzie_etiqueta_config';

export function carregarCfgImpressora() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }
  catch { return null; }
}

export function salvarCfgImpressora(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

const IC_X = '<svg class="ico" viewBox="0 0 24 24" width="16" height="16"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// ═══════════════════════════════════════════════════════════════════
// MODAL DE IMPRESSÃO (#modal-etiquetas, index.html) — chamado da Entrada
// de Mercadoria (lote inteiro), de Produtos (peça avulsa) e da tela de
// Configurações (etiqueta personalizada, ver mais abaixo). A configuração
// de impressora NÃO mora mais aqui — fica em Configurações → Impressora de
// Etiquetas, configurada uma vez e valendo pra tudo até ser mudada lá.
// ═══════════════════════════════════════════════════════════════════
let etqProdutos = [];
let etqImpressoras = [];

function normalizarItem(p) {
  if (p.texto != null) {
    return { texto: String(p.texto || ''), qtd: Math.max(1, parseInt(p.qtd, 10) || 1) };
  }
  return {
    sku: p.sku || '',
    nome: p.nome || '',
    preco_venda: Number(p.preco_venda) || 0,
    codigo_barras: p.codigo_barras || null,
    qtd: Math.max(1, parseInt(p.qtd, 10) || 1),
  };
}

// produtos: [{ sku, nome, preco_venda, codigo_barras, qtd }] — itens de
// texto livre (etiqueta personalizada) usam { texto, qtd } em vez disso.
export function abrirImpressaoEtiquetas(produtos) {
  if (!produtos || !produtos.length) { toast('Nada para imprimir.'); return; }
  etqProdutos = produtos.map(normalizarItem);
  renderEtiquetas();
  openModal('modal-etiquetas');
}

// Abre o modal já com uma etiqueta de texto livre em branco — atalho pra
// imprimir algo avulso ("Pedra Ametista", nome de revendedora) sem
// depender de nenhum produto do catálogo.
export function abrirEtiquetaPersonalizada() {
  abrirImpressaoEtiquetas([{ texto: '', qtd: 1 }]);
}

function renderEtiquetas() {
  const body = document.getElementById('etiquetas-body');
  if (!body) return;
  body.innerHTML = renderEtiquetasLista();
}

function itemLinhaHtml(p, i) {
  const campo = p.texto != null
    ? `<input type="text" id="etq-item-${i}" class="form-control" style="flex:1" placeholder="Texto da etiqueta (ex.: Pedra Ametista)"
        value="${esc(p.texto)}" oninput="etiquetasTextoChange(${i}, this.value)">`
    : `<div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--plum);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.sku || '(sem SKU)')}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(p.nome)} · R$ ${p.preco_venda.toFixed(2)}</div>
        ${!p.codigo_barras ? '<div style="font-size:11px;color:var(--warning)">⚠ sem código de barras próprio — usando o SKU</div>' : ''}
      </div>`;
  return `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      ${campo}
      <input type="number" min="1" value="${p.qtd}" style="width:56px;flex-shrink:0" class="form-control"
        onchange="etiquetasQtdChange(${i}, this.value)">
      <button type="button" class="btn-icon" title="Remover" onclick="etiquetasRemoverItem(${i})">${IC_X}</button>
    </div>`;
}

function renderEtiquetasLista() {
  const cfg = carregarCfgImpressora();
  const totalEtiquetas = etqProdutos.reduce((s, p) => s + p.qtd, 0);
  const linhas = etqProdutos.map(itemLinhaHtml).join('');
  const temConfig = !!cfg?.deviceName;

  const statusImpressora = !temBrowserPrint()
    ? '<div style="font-size:12.5px;color:var(--warning);margin-bottom:10px">Zebra Browser Print não detectado neste computador. Use "Baixar .zpl" e envie manualmente, ou instale o Browser Print.</div>'
    : temConfig
      ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Impressora: <b>${esc(cfg.deviceName)}</b> (${cfg.dpi} dpi · ${cfg.colunas || 1} coluna${(cfg.colunas || 1) === 1 ? '' : 's'})</div>`
      : `<div style="font-size:12.5px;color:var(--warning);margin-bottom:10px">Nenhuma impressora configurada. <a href="#" onclick="event.preventDefault();closeModal('modal-etiquetas');showPanel('etiquetas-config')">Configurar agora</a>, ou use "Baixar .zpl".</div>`;

  return `
    <div style="max-height:40vh;overflow-y:auto;margin-bottom:10px">${linhas || '<div style="padding:8px 0;color:var(--muted);font-size:13px">Nenhuma etiqueta na lista.</div>'}</div>
    <button class="btn-secondary" style="width:100%;margin-bottom:10px" onclick="etiquetasAdicionarPersonalizada()">+ Adicionar etiqueta personalizada</button>
    ${statusImpressora}
    <div style="display:flex;gap:10px">
      <button class="btn-secondary" style="flex:1" onclick="etiquetasBaixarZpl()">Baixar .zpl</button>
      <button class="btn-primary" style="flex:1" ${temConfig ? '' : 'disabled'} onclick="etiquetasImprimir()">Imprimir ${totalEtiquetas} etiqueta${totalEtiquetas === 1 ? '' : 's'}</button>
    </div>`;
}

export function etiquetasQtdChange(i, valor) {
  const n = Math.max(1, parseInt(valor, 10) || 1);
  if (etqProdutos[i]) etqProdutos[i].qtd = n;
  renderEtiquetas(); // atualiza o total no botão de imprimir
}

export function etiquetasTextoChange(i, valor) {
  if (etqProdutos[i]) etqProdutos[i].texto = valor; // sem re-render: não perde o foco do campo
}

export function etiquetasRemoverItem(i) {
  etqProdutos.splice(i, 1);
  renderEtiquetas();
}

export function etiquetasAdicionarPersonalizada() {
  etqProdutos.push({ texto: '', qtd: 1 });
  renderEtiquetas();
  document.getElementById(`etq-item-${etqProdutos.length - 1}`)?.focus();
}

export async function etiquetasListarImpressoras() {
  try { etqImpressoras = await listarImpressoras(); }
  catch (e) { etqImpressoras = []; toast(e.message, 'erro'); }
  renderConfigPanel();
}

// ═══════════════════════════════════════════════════════════════════
// TELA DE CONFIGURAÇÕES (#panel-etiquetas-config, index.html) — impressora,
// DPI e colunas do rolo, salvos no localStorage deste computador (ver
// carregarCfgImpressora/salvarCfgImpressora acima). Configura uma vez aqui,
// vale pra toda impressão até mudar de novo.
// ═══════════════════════════════════════════════════════════════════
export async function loadEtiquetasConfig() {
  renderConfigPanel();
  await etiquetasListarImpressoras();
}

function renderConfigPanel() {
  const panel = document.getElementById('panel-etiquetas-config');
  if (!panel) return;
  const cfg = carregarCfgImpressora();
  const opcoes = etqImpressoras.length
    ? etqImpressoras.map(d => `<option value="${esc(d.name)}" ${cfg?.deviceName === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')
    : '<option value="">Nenhuma encontrada — clique em Atualizar</option>';
  panel.innerHTML = `
    <div class="page-head"><div>
      <h2>Impressora de Etiquetas</h2>
      <div class="sub">Configuração deste computador — vale pra toda impressão de etiqueta até você mudar aqui.</div>
    </div></div>
    <div class="card" style="max-width:420px">
      ${!temBrowserPrint() ? `<div style="font-size:12.5px;color:var(--warning);margin-bottom:12px">Zebra Browser Print não detectado neste computador. <a href="https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html" target="_blank" rel="noopener">Instale o serviço</a> pra imprimir direto — enquanto isso dá pra usar "Baixar .zpl" na tela de impressão.</div>` : ''}
      <div class="form-group"><label class="form-label">Impressora</label>
        <select id="etq-cfg-dev" class="form-control">${opcoes}</select></div>
      <div class="form-group"><label class="form-label">Resolução (DPI)</label>
        <select id="etq-cfg-dpi" class="form-control">
          <option value="203" ${!cfg || cfg.dpi === 203 ? 'selected' : ''}>203 dpi</option>
          <option value="300" ${cfg?.dpi === 300 ? 'selected' : ''}>300 dpi</option>
        </select></div>
      <div class="form-group"><label class="form-label">Colunas no rolo</label>
        <select id="etq-cfg-colunas" class="form-control">
          ${[1, 2, 3, 4].map(n => `<option value="${n}" ${(cfg?.colunas || 1) === n ? 'selected' : ''}>${n}${n === 1 ? ' (rolo comum, 1 etiqueta por vez)' : ` (rolo com ${n} etiquetas lado a lado)`}</option>`).join('')}
        </select></div>
      <button class="btn-secondary" style="width:100%;margin-bottom:10px" onclick="etiquetasListarImpressoras()">Atualizar lista</button>
      <button class="btn-primary" style="width:100%;margin-bottom:10px" onclick="etiquetasConfigSalvar()">Salvar</button>
      <div style="display:flex;gap:10px">
        <button class="btn-secondary" style="flex:1" onclick="etiquetasTeste()">Imprimir etiqueta de teste</button>
        <button class="btn-secondary" style="flex:1" onclick="abrirEtiquetaPersonalizada()">Etiqueta personalizada</button>
      </div>
    </div>`;
}

export function etiquetasConfigSalvar() {
  const deviceName = document.getElementById('etq-cfg-dev')?.value || '';
  const dpi = Number(document.getElementById('etq-cfg-dpi')?.value) || 203;
  const colunas = Number(document.getElementById('etq-cfg-colunas')?.value) || 1;
  if (!deviceName) { toast('Selecione uma impressora.', 'erro'); return; }
  salvarCfgImpressora({ deviceName, dpi, colunas });
  toast('Impressora configurada.', 'erro');
}

async function dispositivoConfigurado() {
  const cfg = carregarCfgImpressora();
  if (!cfg?.deviceName) throw new Error('Configure a impressora primeiro.');
  const lista = etqImpressoras.length ? etqImpressoras : await listarImpressoras();
  const device = lista.find(d => d.name === cfg.deviceName);
  if (!device) throw new Error('Impressora configurada não foi encontrada — reconfigure.');
  return { device, dpi: cfg.dpi, colunas: cfg.colunas || 1 };
}

export async function etiquetasTeste() {
  try {
    const deviceName = document.getElementById('etq-cfg-dev')?.value;
    const dpi = Number(document.getElementById('etq-cfg-dpi')?.value) || 203;
    const colunas = Number(document.getElementById('etq-cfg-colunas')?.value) || 1;
    if (!deviceName) { toast('Selecione uma impressora.', 'erro'); return; }
    const lista = etqImpressoras.length ? etqImpressoras : await listarImpressoras();
    const device = lista.find(d => d.name === deviceName);
    if (!device) { toast('Impressora não encontrada.', 'erro'); return; }
    // Testa com `colunas` cópias — valida o layout lado a lado de uma vez.
    const testes = Array.from({ length: colunas }, () => ({ sku: 'TESTE-001', nome: 'Etiqueta de teste', preco_venda: 9.9, codigo_barras: null }));
    const zpl = gerarZPLLote(testes, { dpi, colunas });
    await enviarParaImpressora(device, zpl);
    toast('Etiqueta de teste enviada!', 'erro');
  } catch (e) {
    console.error('Etiqueta de teste:', e);
    toast('Erro: ' + e.message, 'erro');
  }
}

function temTextoVazio() {
  return etqProdutos.some(p => p.texto != null && !p.texto.trim());
}

export async function etiquetasImprimir() {
  if (!temBrowserPrint()) {
    toast('Browser Print não detectado — use "Baixar .zpl".', 'erro');
    return;
  }
  if (temTextoVazio()) { toast('Preencha o texto da etiqueta personalizada (ou remova a linha).', 'erro'); return; }
  try {
    const { device, dpi, colunas } = await dispositivoConfigurado();
    const zpl = gerarZPLLote(etqProdutos, { dpi, colunas });
    await enviarParaImpressora(device, zpl);
    toast('Etiquetas enviadas para a impressora!', 'erro');
    closeModal('modal-etiquetas');
  } catch (e) {
    console.error('Impressão de etiquetas:', e);
    toast('Erro ao imprimir: ' + e.message, 'erro');
  }
}

export function etiquetasBaixarZpl() {
  if (temTextoVazio()) { toast('Preencha o texto da etiqueta personalizada (ou remova a linha).', 'erro'); return; }
  const cfg = carregarCfgImpressora();
  const zpl = gerarZPLLote(etqProdutos, { dpi: cfg?.dpi || 203, colunas: cfg?.colunas || 1 });
  baixarZPL(`etiquetas-${Date.now()}`, zpl);
  toast('Arquivo .zpl baixado.', 'erro');
}
