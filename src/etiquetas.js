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
import { fmtBRL } from './utils.js';

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
  const MARGEM_X = mm(1.5, dpi);      // margem esquerda
  const BARRA_Y = mm(1, dpi);         // topo da etiqueta
  const BARRA_ALTURA = mm(6, dpi);    // altura das barras
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
