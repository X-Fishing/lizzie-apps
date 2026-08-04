// ═══════════════════════════════════════════════════════════════════
// Etiquetas Zebra (ZPL) — geração da linguagem de impressão + integração
// com o Zebra Browser Print (serviço local Windows que enxerga impressoras
// USB e de rede já cadastradas nele — zebra.com/browserprint).
//
// Por que não window.print(): etiqueta térmica precisa de posicionamento
// exato em milímetros; o jeito confiável é gerar ZPL e mandar direto pra
// impressora, sem passar pela caixa de diálogo de impressão do navegador.
//
// Etiqueta padrão: 30×15mm — código de barras (Code128) + SKU + preço.
// Sem nome/banho (não cabe). Barcode = codigo_barras do produto, ou o SKU
// quando não houver (a Entrada de Mercadoria em lote nunca grava
// codigo_barras — todo lote cai no fallback do SKU).
// ═══════════════════════════════════════════════════════════════════
import { esc, fmtBRL, toast, openModal, closeModal } from './utils.js';

const dotsPorMm = dpi => dpi / 25.4;
const mm = (valorMm, dpi) => Math.round(valorMm * dotsPorMm(dpi));

// Gera o ZPL de UMA etiqueta (produto + quantas cópias, via ^PQ). As
// constantes de layout ficam aqui — são um PONTO DE PARTIDA. 30×15mm é
// apertado (barra + 2 linhas de texto): módulo/altura da barra e a posição
// X/Y do texto quase sempre precisam de ajuste fino na etiqueta física, na
// impressora real. Isso não é bug — é calibração de hardware.
export function gerarZPL(produto, opts = {}) {
  const { dpi = 203, larguraMm = 30, alturaMm = 15, qtd = 1 } = opts;
  const w = mm(larguraMm, dpi);
  const h = mm(alturaMm, dpi);

  // ── Calibração (ajustar aqui na etiqueta real) ──
  // Rev. 2 (teste físico 1): barra estava muito colada no topo e nas
  // margens — desceu a barra (mantendo o mesmo fim em Y, pra não bater no
  // SKU) e abriu a margem lateral de 1.5mm pra 2.5mm.
  const MARGEM_X = mm(2.5, dpi);      // margem esquerda/direita
  const BARRA_Y = mm(1.5, dpi);       // topo da etiqueta
  const BARRA_ALTURA = mm(5.5, dpi);  // altura das barras
  const BARRA_MODULO = 2;             // ^BY — largura do módulo (2 = fino)
  const SKU_Y = mm(8, dpi);           // logo abaixo da barra
  const SKU_FONTE = 20;               // altura/largura da fonte (dots)
  const PRECO_Y = mm(11, dpi);
  const PRECO_FONTE = 26;

  const barcode = String(produto.codigo_barras || produto.sku || '').trim();
  const sku = String(produto.sku || '').trim();
  const preco = fmtBRL(produto.preco_venda);
  const larguraUtil = w - 2 * MARGEM_X;

  return [
    '^XA',
    `^PW${w}`,
    `^LL${h}`,
    '^CI28',
    `^FO${MARGEM_X},${BARRA_Y}^BY${BARRA_MODULO}`,
    `^BCN,${BARRA_ALTURA},N,N,N`,
    `^FD${barcode}^FS`,
    `^FO${MARGEM_X},${SKU_Y}^A0N,${SKU_FONTE},${SKU_FONTE}^FD${sku}^FS`,
    `^FO${MARGEM_X},${PRECO_Y}^A0N,${PRECO_FONTE},${PRECO_FONTE}^FB${larguraUtil},1,0,R^FD${preco}^FS`,
    `^PQ${qtd}`,
    '^XZ',
  ].join('\n');
}

// Concatena o ZPL de vários produtos numa única transmissão (cada um com
// sua própria ^PQ — a impressora imprime tudo em sequência).
export function gerarZPLLote(produtos, opts = {}) {
  return produtos.map(p => gerarZPL(p, { ...opts, qtd: p.qtd || 1 })).join('\n');
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

// ═══════════════════════════════════════════════════════════════════
// MODAL DE IMPRESSÃO (#modal-etiquetas, index.html) — chamado tanto da
// Entrada de Mercadoria (lote inteiro) quanto de Produtos (peça avulsa).
// ═══════════════════════════════════════════════════════════════════
let etqProdutos = [];
let etqView = 'lista'; // 'lista' | 'config'
let etqImpressoras = [];

// produtos: [{ sku, nome, preco_venda, codigo_barras, qtd }]
export function abrirImpressaoEtiquetas(produtos) {
  if (!produtos || !produtos.length) { toast('Nada para imprimir.'); return; }
  etqProdutos = produtos.map(p => ({
    sku: p.sku || '',
    nome: p.nome || '',
    preco_venda: Number(p.preco_venda) || 0,
    codigo_barras: p.codigo_barras || null,
    qtd: Math.max(1, parseInt(p.qtd, 10) || 1),
  }));
  etqView = 'lista';
  renderEtiquetas();
  openModal('modal-etiquetas');
}

function renderEtiquetas() {
  const body = document.getElementById('etiquetas-body');
  if (!body) return;
  body.innerHTML = etqView === 'config' ? renderEtiquetasConfig() : renderEtiquetasLista();
}

function renderEtiquetasLista() {
  const cfg = carregarCfgImpressora();
  const totalEtiquetas = etqProdutos.reduce((s, p) => s + p.qtd, 0);
  const linhas = etqProdutos.map((p, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--plum);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.sku || '(sem SKU)')}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(p.nome)} · R$ ${p.preco_venda.toFixed(2)}</div>
        ${!p.codigo_barras ? '<div style="font-size:11px;color:var(--warning)">⚠ sem código de barras próprio — usando o SKU</div>' : ''}
      </div>
      <input type="number" min="1" value="${p.qtd}" style="width:64px" class="form-control"
        onchange="etiquetasQtdChange(${i}, this.value)">
    </div>`).join('');

  const statusImpressora = !temBrowserPrint()
    ? '<div style="font-size:12.5px;color:var(--warning);margin-bottom:10px">Zebra Browser Print não detectado neste computador. Use "Baixar .zpl" e envie manualmente, ou instale o Browser Print.</div>'
    : cfg?.deviceName
      ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Impressora: <b>${esc(cfg.deviceName)}</b> (${cfg.dpi} dpi)</div>`
      : '<div style="font-size:12.5px;color:var(--warning);margin-bottom:10px">Nenhuma impressora configurada.</div>';

  return `
    <div style="max-height:44vh;overflow-y:auto;margin-bottom:10px">${linhas}</div>
    ${statusImpressora}
    <button class="btn-secondary" style="width:100%;margin-bottom:10px" onclick="etiquetasConfigAbrir()">Configurar impressora</button>
    <div style="display:flex;gap:10px">
      <button class="btn-secondary" style="flex:1" onclick="etiquetasBaixarZpl()">Baixar .zpl</button>
      <button class="btn-primary" style="flex:1" onclick="etiquetasImprimir()">Imprimir ${totalEtiquetas} etiqueta${totalEtiquetas === 1 ? '' : 's'}</button>
    </div>`;
}

function renderEtiquetasConfig() {
  const cfg = carregarCfgImpressora();
  const opcoes = etqImpressoras.length
    ? etqImpressoras.map(d => `<option value="${esc(d.name)}" ${cfg?.deviceName === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')
    : '<option value="">Nenhuma encontrada — clique em Atualizar</option>';
  return `
    <div class="form-group"><label class="form-label">Impressora</label>
      <select id="etq-cfg-dev" class="form-control">${opcoes}</select></div>
    <div class="form-group"><label class="form-label">Resolução (DPI)</label>
      <select id="etq-cfg-dpi" class="form-control">
        <option value="203" ${!cfg || cfg.dpi === 203 ? 'selected' : ''}>203 dpi</option>
        <option value="300" ${cfg?.dpi === 300 ? 'selected' : ''}>300 dpi</option>
      </select></div>
    <button class="btn-secondary" style="width:100%;margin-bottom:10px" onclick="etiquetasListarImpressoras()">Atualizar lista</button>
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <button class="btn-secondary" style="flex:1" onclick="etiquetasConfigVoltar()">Voltar</button>
      <button class="btn-primary" style="flex:1" onclick="etiquetasConfigSalvar()">Salvar</button>
    </div>
    <button class="btn-secondary" style="width:100%" onclick="etiquetasTeste()">Imprimir etiqueta de teste</button>`;
}

export function etiquetasQtdChange(i, valor) {
  const n = Math.max(1, parseInt(valor, 10) || 1);
  if (etqProdutos[i]) etqProdutos[i].qtd = n;
  renderEtiquetas(); // atualiza o total no botão de imprimir
}

export async function etiquetasListarImpressoras() {
  try { etqImpressoras = await listarImpressoras(); }
  catch (e) { etqImpressoras = []; toast(e.message, 'erro'); }
  renderEtiquetas();
}

export async function etiquetasConfigAbrir() {
  etqView = 'config';
  renderEtiquetas();
  await etiquetasListarImpressoras();
}

export function etiquetasConfigVoltar() {
  etqView = 'lista';
  renderEtiquetas();
}

export function etiquetasConfigSalvar() {
  const deviceName = document.getElementById('etq-cfg-dev')?.value || '';
  const dpi = Number(document.getElementById('etq-cfg-dpi')?.value) || 203;
  if (!deviceName) { toast('Selecione uma impressora.', 'erro'); return; }
  salvarCfgImpressora({ deviceName, dpi });
  toast('Impressora configurada.', 'erro');
  etqView = 'lista';
  renderEtiquetas();
}

async function dispositivoConfigurado() {
  const cfg = carregarCfgImpressora();
  if (!cfg?.deviceName) throw new Error('Configure a impressora primeiro.');
  const lista = etqImpressoras.length ? etqImpressoras : await listarImpressoras();
  const device = lista.find(d => d.name === cfg.deviceName);
  if (!device) throw new Error('Impressora configurada não foi encontrada — reconfigure.');
  return { device, dpi: cfg.dpi };
}

export async function etiquetasTeste() {
  try {
    const deviceName = document.getElementById('etq-cfg-dev')?.value;
    const dpi = Number(document.getElementById('etq-cfg-dpi')?.value) || 203;
    if (!deviceName) { toast('Selecione uma impressora.', 'erro'); return; }
    const lista = etqImpressoras.length ? etqImpressoras : await listarImpressoras();
    const device = lista.find(d => d.name === deviceName);
    if (!device) { toast('Impressora não encontrada.', 'erro'); return; }
    const zpl = gerarZPL({ sku: 'TESTE-001', nome: 'Etiqueta de teste', preco_venda: 9.9, codigo_barras: null }, { dpi, qtd: 1 });
    await enviarParaImpressora(device, zpl);
    toast('Etiqueta de teste enviada!', 'erro');
  } catch (e) {
    console.error('Etiqueta de teste:', e);
    toast('Erro: ' + e.message, 'erro');
  }
}

export async function etiquetasImprimir() {
  if (!temBrowserPrint()) {
    toast('Browser Print não detectado — use "Baixar .zpl".', 'erro');
    return;
  }
  try {
    const { device, dpi } = await dispositivoConfigurado();
    const zpl = gerarZPLLote(etqProdutos, { dpi });
    await enviarParaImpressora(device, zpl);
    toast('Etiquetas enviadas para a impressora!', 'erro');
    closeModal('modal-etiquetas');
  } catch (e) {
    console.error('Impressão de etiquetas:', e);
    toast('Erro ao imprimir: ' + e.message, 'erro');
  }
}

export function etiquetasBaixarZpl() {
  const cfg = carregarCfgImpressora();
  const zpl = gerarZPLLote(etqProdutos, { dpi: cfg?.dpi || 203 });
  baixarZPL(`etiquetas-${Date.now()}`, zpl);
  toast('Arquivo .zpl baixado.', 'erro');
}
