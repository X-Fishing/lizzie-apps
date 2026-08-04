// ═══════════════════════════════════════════════════════════════════
// Helpers de grid: ordenação por clique no cabeçalho + paginação com
// salto direto pra uma página.
//
// Por que módulo separado: cada tela monta a tabela do seu jeito (produtos
// tem linhas agrupadas, contas a pagar tem sub-linhas...), então não dá pra
// ter UM componente de tabela. O que dá pra compartilhar é a parte chata e
// repetida: o estado do "ordenar por qual coluna e em que sentido", o
// comparador que lida com número/texto/data/nulo, e o rodapé de páginas.
// ═══════════════════════════════════════════════════════════════════
import { esc } from './utils.js';

const IC_ASC  = '<svg class="ico" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-1px"><path d="m18 15-6-6-6 6"/></svg>';
const IC_DESC = '<svg class="ico" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-1px"><path d="m6 9 6 6 6-6"/></svg>';

// Estado de ordenação de uma grid. `padrao` é a coluna inicial.
export function criarOrdenacao(padrao, dir = 'asc') {
  return { col: padrao, dir };
}

// Clique no cabeçalho: mesma coluna inverte o sentido; coluna nova começa
// ascendente (é o que se espera ao trocar de critério).
export function alternarOrdenacao(ord, col) {
  if (ord.col === col) ord.dir = ord.dir === 'asc' ? 'desc' : 'asc';
  else { ord.col = col; ord.dir = 'asc'; }
  return ord;
}

// <th> clicável com a setinha do sentido atual. `handler` é o nome da função
// global (window) que a tela expõe pra reordenar — ex.: 'produtoOrdenar'.
export function thOrd(ord, col, label, handler, extraStyle = '') {
  const ativo = ord.col === col;
  const seta = ativo ? (ord.dir === 'asc' ? IC_ASC : IC_DESC) : '';
  return `<th class="pag-th" style="cursor:pointer;user-select:none${extraStyle ? ';' + extraStyle : ''}"
    title="Ordenar por ${esc(label)}" onclick="${handler}('${col}')">${esc(label)}${ativo ? ' ' + seta : ''}</th>`;
}

// Comparador genérico. Números comparam como número; o resto como texto com
// localeCompare (acento/maiúscula do jeito certo em pt-BR). Vazio/nulo vai
// sempre pro fim, nos dois sentidos — item sem preço no topo do "maior preço"
// seria só ruído.
export function compararValores(a, b, dir) {
  const vazioA = a === null || a === undefined || a === '';
  const vazioB = b === null || b === undefined || b === '';
  if (vazioA && vazioB) return 0;
  if (vazioA) return 1;
  if (vazioB) return -1;
  let r;
  if (typeof a === 'number' && typeof b === 'number') r = a - b;
  else r = String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  return dir === 'desc' ? -r : r;
}

// Ordena a lista in-place por uma função que extrai o valor da coluna.
// `chaves` = { coluna: item => valor }.
export function ordenarPor(lista, ord, chaves) {
  const extrair = chaves[ord.col];
  if (!extrair) return lista;
  return lista.sort((x, y) => compararValores(extrair(x), extrair(y), ord.dir));
}

// ── Rodapé de paginação, com salto direto ───────────────────────────
// `handler` recebe o NÚMERO da página (1-based), não um delta — salto e
// anterior/próxima usam o mesmo caminho.
export function pagerHTML(paginaAtual, totalPaginas, totalItens, handler) {
  if (totalPaginas <= 1) return '';
  const btn = (pag, txt, ativo = true) =>
    `<button class="btn-secondary btn-sm" ${ativo ? '' : 'disabled style="opacity:.4"'} onclick="${handler}(${pag})">${txt}</button>`;
  return `
    <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap">
      ${btn(1, '«', paginaAtual > 1)}
      ${btn(paginaAtual - 1, '‹ Anterior', paginaAtual > 1)}
      <span style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">
        Página
        <input type="number" min="1" max="${totalPaginas}" value="${paginaAtual}" class="form-control"
          style="width:64px;padding:4px 6px;text-align:center;font-size:12px"
          title="Digite a página e tecle Enter"
          onkeydown="if(event.key==='Enter'){event.preventDefault();${handler}(this.value)}"
          onchange="${handler}(this.value)">
        de <b>${totalPaginas}</b> · ${totalItens} ite${totalItens !== 1 ? 'ns' : 'm'}
      </span>
      ${btn(paginaAtual + 1, 'Próxima ›', paginaAtual < totalPaginas)}
      ${btn(totalPaginas, '»', paginaAtual < totalPaginas)}
    </div>`;
}

// Limita a página ao intervalo válido (aceita string vinda do input).
export function paginaValida(valor, totalPaginas) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, n), Math.max(1, totalPaginas));
}
