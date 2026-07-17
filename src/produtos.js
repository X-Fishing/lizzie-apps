// Cadastro de Produtos (catálogo-mestre próprio). Lista + formulário em
// etapas (numa página rolável) no padrão visual do app. Só gestor/admin grava.
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { esc, toast, sbQ, fetchPaginado, fmtBRL, confirmarAcao, handleSupabaseError,
         maskMoneyBR, parseMoneyBR, moneyToInput } from './utils.js';
import { cadastroCache, carregarCadastrosParaSelect, cadNovo } from './cadastros.js';
import { carregarPrecificacao, calcularPrecificacao } from './precificacao.js';

// ── Importação do Bling (Edge Function bling-produtos) ──
const BLING_PRODUTOS_FN = `${SUPABASE_URL}/functions/v1/bling-produtos`;
const BLING_PRODUTO_FOTO_FN = `${SUPABASE_URL}/functions/v1/bling-produto-foto`;
// headers do proxy Bling (mesmo padrão de bling.js: a função faz a própria auth)
const BLING_FN_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const BLING_HDRS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchBlingProdutos(pagina, filtros = {}) {
  const qs = new URLSearchParams({ pagina });
  for (const [k, v] of Object.entries(filtros)) if (v) qs.set(k, v);
  const r = await fetch(`${BLING_PRODUTOS_FN}?${qs}`, { headers: BLING_HDRS });
  return r.json();
}

// Faixa de SKU escolhida na tela (o Bling v3 ignora o filtro de data, então
// filtramos por SKU no cliente). Campos vazios => sem limite naquele lado.
function impFaixaSku() {
  const de  = document.getElementById('imp-sku-de')?.value.trim();
  const ate = document.getElementById('imp-sku-ate')?.value.trim();
  return { skuDe: de ? parseInt(de, 10) : null, skuAte: ate ? parseInt(ate, 10) : null };
}
function impSoAtivos() { return document.getElementById('imp-ativos')?.checked ?? true; }

// SKU numérico "puro" -> Number; qualquer coisa com letra/vazio -> NaN (fica fora
// da faixa). Evita casar "ABC123" como 123.
function skuNumero(sku) {
  const s = String(sku ?? '').trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

// Resultado da última varredura (a prévia varre; o "Importar" reusa isto sem
// varrer de novo — a varredura completa leva minutos).
let blingScan = null;
let blingCancelar = false;
export function produtoImportBlingParar(btn) {
  blingCancelar = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Parando...'; }
}

// Varre TODAS as páginas do Bling (o lote novo fica nas últimas) e mantém só os
// produtos com SKU dentro de [skuDe, skuAte]. onProgress atualiza a tela; o
// usuário pode cancelar via produtoImportBlingParar().
async function varrerBling(skuDe, skuAte, soAtivos, onProgress) {
  const matched = [];
  let pagina = 1, totalVarridos = 0, foraIntervalo = 0;
  const temFaixa = skuDe != null || skuAte != null;
  blingCancelar = false;
  while (pagina <= 500) {
    if (blingCancelar) break;
    let resp;
    try { resp = await fetchBlingProdutos(pagina, {}); }
    catch (e) { throw new Error('Erro na página ' + pagina + ': ' + (e.message || e)); }
    if (resp?.error) throw new Error('Bling: ' + resp.error);
    const arr = resp?.data || [];
    if (!arr.length) break;
    totalVarridos += arr.length;
    for (const p of arr) {
      if (soAtivos && (p.situacao ?? 'A') !== 'A') { foraIntervalo++; continue; }
      const m = mapProdutoBling(p);
      let dentro;
      if (!temFaixa) dentro = true;
      else {
        const n = skuNumero(m.sku);
        dentro = Number.isFinite(n) && (skuDe == null || n >= skuDe) && (skuAte == null || n <= skuAte);
      }
      if (dentro) matched.push(m); else foraIntervalo++;
    }
    onProgress && onProgress({ pagina, matched: matched.length, totalVarridos });
    if (arr.length < 100) break;   // última página do catálogo
    pagina++;
    await sleep(350);              // respeita ~3 req/s do Bling
  }
  return { matched, totalVarridos, foraIntervalo, parado: blingCancelar };
}

// Mapeia um produto do Bling v3 -> colunas de `produtos` (defensivo: os campos
// variam; se algo nao vier na lista, a previa mostra e a gente ajusta/usa detalhe).
function mapProdutoBling(p) {
  const preco = Number(p.preco ?? p.precos?.preco ?? 0) || 0;
  const foto = p.imagemURL || p.imagem?.link
    || p.midia?.imagens?.externas?.[0]?.link
    || p.midia?.imagens?.internas?.[0]?.link || null;
  const sku = (p.codigo ?? p.sku ?? '').toString().trim();
  const gtin = (p.gtin ?? p.codigoBarras ?? '').toString().trim();
  return {
    nome: (p.nome || p.descricao || '(sem nome)').toString().trim(),
    sku: sku || null,
    codigo_barras: gtin || null,
    preco_venda: preco,
    custo_compra: Number(p.precoCusto ?? p.precos?.precoCusto ?? 0) || 0,
    foto_url: foto,
    formato: 'simples',
  };
}

const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_GEM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>';
const IC_BARCODE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>';
const IC_CAM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
const IC_SHEET = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>';
const IC_DOWN  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';

let produtosCache = [];
let filtroProdutos = '';
let filtroColecao = '';      // id da coleção selecionada no filtro ('' = todas)
let filtroCategoria = '';    // id da categoria ('' = todas)
let filtroFornecedor = '';   // id do fornecedor ('' = todos)
let filtroCaract = '';       // característica: com/sem foto, sem descrição, sem preço... ('' = todas)

// Filtros de "estado" do produto — úteis pra achar o que falta completar
// (ex.: "sem foto" antes de usar o importador de fotos em lote).
const CARACT_FILTROS = {
  com_foto:      { label: 'Com foto',            teste: p => !!p.foto_url },
  sem_foto:      { label: 'Sem foto',            teste: p => !p.foto_url },
  sem_descricao: { label: 'Sem descrição',       teste: p => !(p.descricao_curta || '').trim() },
  sem_custo:     { label: 'Sem preço de custo',  teste: p => !(Number(p.custo_compra) > 0) },
  sem_venda:     { label: 'Sem preço de venda',  teste: p => !(Number(p.preco_venda) > 0) },
  sem_sku:       { label: 'Sem SKU',             teste: p => !(p.sku || '').trim() },
  sem_barras:    { label: 'Sem código de barras', teste: p => !(p.codigo_barras || '').trim() },
  sem_estoque:   { label: 'Sem estoque',         teste: p => !(Number(p.estoque_qtd) > 0) },
};
let paginaAtual = 1;         // paginação client-side da grid
const POR_PAGINA = 50;
let formVariacoes = [];   // variações em edição no formulário (client-side)
let formImagens = [];     // imagens em edição: [{url|null, file|null, preview}] — a 1ª é a principal
const MAX_IMAGENS = 5;
const MAX_IMG_MB = 5;

function panel() { return document.getElementById('panel-produtos'); }

// Miniatura da grade: com foto vira clicável (zoom); sem foto mostra o ícone.
// stopPropagation p/ não disparar o toggle do grupo/edição ao clicar na foto.
function thumbHTML(url) {
  return url
    ? `<span class="ciclo-emoji" style="cursor:zoom-in" onclick="event.stopPropagation();produtoZoomFoto('${esc(url)}')"><img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"></span>`
    : `<span class="ciclo-emoji">${IC_GEM}</span>`;
}

// Zoom da foto: overlay em tela cheia; clique em qualquer lugar fecha.
export function produtoZoomFoto(url) {
  if (!url) return;
  document.getElementById('produto-zoom')?.remove();
  const ov = document.createElement('div');
  ov.id = 'produto-zoom';
  ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(20,8,30,.85);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
  ov.onclick = () => ov.remove();
  ov.innerHTML = `<img src="${esc(url)}" alt="Foto do produto" style="max-width:92vw;max-height:92vh;object-fit:contain;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5)">`;
  document.body.appendChild(ov);
}

// Nome da coleção a partir do id (usa o cache de cadastros).
function nomeColecao(id) {
  const c = (cadastroCache.colecoes || []).find(x => String(x.id) === String(id));
  return c ? c.nome : '';
}

// ════════════════════════════════════════════════════════════════════
// LISTA
// ════════════════════════════════════════════════════════════════════
export async function loadProdutos() {
  panel().innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando produtos...</div>';
  // fetchPaginado: o PostgREST devolve no máx. 1000 linhas por chamada — sem
  // isso, catálogo acima de 1000 produtos aparece truncado na grid.
  const { data, error } = await fetchPaginado(() => sb.from('produtos')
    .select('id,nome,sku,codigo_barras,codigo_fornecedor,preco_venda,custo_compra,estoque_qtd,foto_url,descricao_curta,ativo,categoria_id,colecao_id,fornecedor_id,formato')
    .order('nome', { ascending: true }));
  if (error) { if (await handleSupabaseError(error, 'Erro ao carregar produtos')) return; }
  produtosCache = data || [];
  gruposAbertos.clear();

  // Variações (produtos formato 'variacao') aparecem na grid como sub-linhas
  const { data: vars } = await fetchPaginado(() => sb.from('produto_variacoes')
    .select('id,produto_id,atributo,valor,sku,codigo_barras,preco_venda,estoque_qtd')
    .order('created_at'));
  variacoesPorProduto.clear();
  for (const v of (vars || [])) {
    const k = String(v.produto_id);
    if (!variacoesPorProduto.has(k)) variacoesPorProduto.set(k, []);
    variacoesPorProduto.get(k).push(v);
  }
  if (!cadastroCache.colecoes || !cadastroCache.colecoes.length) {
    await carregarCadastrosParaSelect(); // popula categorias/colecoes/fornecedores p/ nome e filtro
  }
  renderLista();
}

// ── Agrupamento de anéis por modelo ───────────────────────────────────────────
// Cada aro é um produto/SKU próprio (padrão herdado do Bling e das etiquetas);
// o aro vive no nome: "Anel 15 Dois Corações". A grid agrupa por modelo SÓ
// visualmente — sem schema novo, sem produto_variacoes, bipe/maleta intocados.
const gruposAbertos = new Set();
const variacoesPorProduto = new Map();   // produto_id -> [variações] (pra grid)

// "Anel 15 Dois Corações Ródio" -> { base: 'Anel Dois Corações Ródio', tamanho: '15' }
// Nome fora do padrão -> null (produto avulso, sem grupo)
function grupoAnel(nome) {
  const m = /^Anel\s+(\d{1,2})\s+(.+)$/i.exec((nome || '').trim());
  return m ? { base: `Anel ${m[2].trim()}`, tamanho: m[1] } : null;
}

// Linha padrão de produto (sub=true = membro de grupo, com recuo)
function linhaProdutoHTML(p, sub = false) {
  return `
    <tr class="ciclo-row"${sub ? ' style="background:rgba(201,116,138,0.045)"' : ''}>
      <td class="ciclo-td"${sub ? ' style="padding-left:34px"' : ''}>
        <div style="display:flex;align-items:center;gap:10px">
          ${thumbHTML(p.foto_url)}
          <div><div class="ciclo-desc">${esc(p.nome)}${p.colecao_id ? `<span class="ciclo-badge" style="margin-left:6px">${esc(nomeColecao(p.colecao_id))}</span>` : ''}</div>
          ${p.codigo_barras ? `<div style="font-size:11px;color:var(--muted)">${esc(p.codigo_barras)}</div>` : ''}</div>
        </div>
      </td>
      <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">${p.sku ? esc(p.sku) : '—'}</td>
      <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${p.estoque_qtd ?? 0}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${fmtBRL(p.preco_venda)}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="produtoEditar('${p.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="produtoExcluir('${p.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`;
}

// Sub-linha de uma variação (dentro do produto formato 'variacao')
function linhaVariacaoHTML(p, v) {
  return `
    <tr class="ciclo-row" style="background:rgba(201,116,138,0.045)">
      <td class="ciclo-td" style="padding-left:34px">
        <div class="ciclo-desc" style="font-size:13px">${esc(p.nome)} — ${esc(v.atributo)}: <b>${esc(v.valor)}</b></div>
        ${v.codigo_barras ? `<div style="font-size:11px;color:var(--muted)">${esc(v.codigo_barras)}</div>` : ''}
      </td>
      <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">${v.sku ? esc(v.sku) : '—'}</td>
      <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${v.estoque_qtd ?? 0}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${fmtBRL(v.preco_venda ?? p.preco_venda)}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar (abre o produto)" onclick="produtoEditar('${p.id}')" style="color:var(--rose)">${IC_EDIT}</button>
      </td>
    </tr>`;
}

// Linha-cabeçalho de um produto com variações (expande/colapsa igual grupo)
function linhaVarProdHTML(p, vars, aberto) {
  const estoque = vars.reduce((s, v) => s + (v.estoque_qtd ?? 0), 0);
  const precos = vars.map(v => Number(v.preco_venda ?? p.preco_venda) || 0);
  const pMin = Math.min(...precos), pMax = Math.max(...precos);
  const preco = pMin === pMax ? fmtBRL(pMin) : `${fmtBRL(pMin)} – ${fmtBRL(pMax)}`;
  return `
    <tr class="ciclo-row" style="cursor:pointer" onclick="produtoToggleGrupo('${encodeURIComponent('var:' + p.id)}')">
      <td class="ciclo-td">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:14px;color:var(--rose);font-size:12px">${aberto ? '▾' : '▸'}</span>
          ${thumbHTML(p.foto_url)}
          <div><div class="ciclo-desc">${esc(p.nome)}${p.colecao_id ? `<span class="ciclo-badge" style="margin-left:6px">${esc(nomeColecao(p.colecao_id))}</span>` : ''}</div>
          <div style="font-size:11px;color:var(--muted)">${vars.length} variaç${vars.length !== 1 ? 'ões' : 'ão'}: ${vars.map(v => esc(v.valor)).join(' · ')}</div></div>
        </div>
      </td>
      <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">${p.sku ? esc(p.sku) : '—'}</td>
      <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${estoque}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${preco}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">
        <button class="btn-icon" title="Editar" onclick="produtoEditar('${p.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="produtoExcluir('${p.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`;
}

// Linha-cabeçalho de um grupo de anéis (clicável: expande/colapsa)
function linhaGrupoHTML(g, aberto) {
  const tams = g.membros.map(m => m.tamanho).sort((a, b) => Number(a) - Number(b));
  const precos = g.membros.map(m => Number(m.p.preco_venda) || 0);
  const pMin = Math.min(...precos), pMax = Math.max(...precos);
  const preco = pMin === pMax ? fmtBRL(pMin) : `${fmtBRL(pMin)} – ${fmtBRL(pMax)}`;
  const estoque = g.membros.reduce((s, m) => s + (m.p.estoque_qtd ?? 0), 0);
  const foto = g.membros.find(m => m.p.foto_url)?.p.foto_url || null;
  const chave = encodeURIComponent(g.base);
  return `
    <tr class="ciclo-row" style="cursor:pointer" onclick="produtoToggleGrupo('${chave}')">
      <td class="ciclo-td">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:14px;color:var(--rose);font-size:12px">${aberto ? '▾' : '▸'}</span>
          ${thumbHTML(foto)}
          <div><div class="ciclo-desc">${esc(g.base)}</div>
          <div style="font-size:11px;color:var(--muted)">${g.membros.length} tamanhos · aros ${tams.join(' · ')}</div></div>
        </div>
      </td>
      <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">—</td>
      <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${estoque}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${preco}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap;font-size:11px;color:var(--muted)">${aberto ? 'fechar' : 'ver aros'}</td>
    </tr>`;
}

// Monta SÓ a tabela + pager (parte que muda com filtro/página). Manter separado
// da toolbar: re-renderizar o painel inteiro a cada tecla destruía o input de
// busca e derrubava o foco do teclado.
function tabelaHTML() {
  const f = filtroProdutos.trim().toLowerCase();
  let lista = produtosCache;
  if (filtroColecao) lista = lista.filter(p => String(p.colecao_id) === String(filtroColecao));
  if (filtroCategoria) lista = lista.filter(p => String(p.categoria_id) === String(filtroCategoria));
  if (filtroFornecedor) lista = lista.filter(p => String(p.fornecedor_id) === String(filtroFornecedor));
  if (filtroCaract && CARACT_FILTROS[filtroCaract]) lista = lista.filter(CARACT_FILTROS[filtroCaract].teste);
  if (f) lista = lista.filter(p => {
    if ([p.nome, p.sku, p.codigo_barras, p.codigo_fornecedor, nomeColecao(p.colecao_id)]
      .some(v => (v || '').toLowerCase().includes(f))) return true;
    // busca também nos SKUs/códigos/valores das variações do produto
    const vs = variacoesPorProduto.get(String(p.id)) || [];
    return vs.some(v => [v.sku, v.codigo_barras, v.valor].some(x => (x || '').toLowerCase().includes(f)));
  });

  // Unidades de exibição: produto com variações e anéis do mesmo modelo
  // colapsam em linhas expansíveis; resto é avulso
  const porBase = new Map();
  const unidades = [];
  for (const p of lista) {
    const vars = p.formato === 'variacao' ? (variacoesPorProduto.get(String(p.id)) || []) : [];
    if (vars.length) { unidades.push({ tipo: 'varprod', p, vars }); continue; }
    const g = grupoAnel(p.nome);
    if (g) {
      let u = porBase.get(g.base);
      if (!u) { u = { tipo: 'grupo', base: g.base, membros: [] }; porBase.set(g.base, u); unidades.push(u); }
      u.membros.push({ p, tamanho: g.tamanho });
    } else {
      unidades.push({ tipo: 'prod', p });
    }
  }
  // Grupo de 1 membro só não tem cara de grupo — vira linha normal
  const units = unidades.map(u => (u.tipo === 'grupo' && u.membros.length === 1) ? { tipo: 'prod', p: u.membros[0].p } : u);
  units.sort((a, b) => (a.tipo === 'grupo' ? a.base : a.p.nome).localeCompare(b.tipo === 'grupo' ? b.base : b.p.nome));

  // Paginação client-side sobre unidades (grupo conta como 1)
  const totalFiltrado = units.length;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  if (paginaAtual < 1) paginaAtual = 1;
  const pagina = units.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const linhas = pagina.length ? pagina.map(u => {
    if (u.tipo === 'prod') return linhaProdutoHTML(u.p);
    // buscando por texto, grupos/variações abrem sozinhos (senão o SKU procurado fica escondido)
    if (u.tipo === 'varprod') {
      const aberto = gruposAbertos.has('var:' + u.p.id) || !!f;
      let html = linhaVarProdHTML(u.p, u.vars, aberto);
      if (aberto) html += u.vars.map(v => linhaVariacaoHTML(u.p, v)).join('');
      return html;
    }
    const aberto = gruposAbertos.has(u.base) || !!f;
    let html = linhaGrupoHTML(u, aberto);
    if (aberto) html += u.membros
      .sort((a, b) => Number(a.tamanho) - Number(b.tamanho))
      .map(m => linhaProdutoHTML(m.p, true)).join('');
    return html;
  }).join('') :
    `<tr><td colspan="5"><div class="empty-state" style="padding:28px 0"><div class="empty-icon">${IC_GEM}</div><p>${(f || filtroColecao || filtroCategoria || filtroFornecedor || filtroCaract) ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado ainda'}</p></div></td></tr>`;

  const pager = totalFiltrado > POR_PAGINA ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:14px;margin-top:14px">
      <button class="btn-secondary btn-sm" ${paginaAtual <= 1 ? 'disabled style="opacity:.4"' : ''} onclick="produtoPagina(-1)">‹ Anterior</button>
      <span style="font-size:12px;color:var(--muted)">Página <b>${paginaAtual}</b> de <b>${totalPaginas}</b> · ${totalFiltrado} ite${totalFiltrado !== 1 ? 'ns' : 'm'}</span>
      <button class="btn-secondary btn-sm" ${paginaAtual >= totalPaginas ? 'disabled style="opacity:.4"' : ''} onclick="produtoPagina(1)">Próxima ›</button>
    </div>` : '';

  return `
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Produto</th>
      <th class="pag-th">SKU</th>
      <th class="pag-th" style="text-align:center">Estoque</th>
      <th class="pag-th">Preço</th>
      <th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody>${linhas}</tbody></table></div>
    ${pager}`;
}

// Atualiza SÓ a região da tabela (preserva toolbar e o foco do input de busca)
function renderTabela() {
  const alvo = document.getElementById('prod-lista');
  if (alvo) alvo.innerHTML = tabelaHTML();
  else renderLista();
}

function renderLista() {
  // Stats do topo (só render; usa o cache já carregado).
  const totProd = produtosCache.length;
  const totPecas = produtosCache.reduce((s, p) => s + (Number(p.estoque_qtd) || 0), 0);
  const totValor = produtosCache.reduce((s, p) => s + (Number(p.preco_venda) || 0) * (Number(p.estoque_qtd) || 0), 0);
  const semFoto = produtosCache.filter(p => !p.foto_url).length;
  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Produtos</h2><div class="sub">${totProd} produto${totProd !== 1 ? 's' : ''} no catálogo</div></div>
      <div class="acts">
        <button class="btn-secondary btn-sm" onclick="produtoImportarBling()">${IC_BARCODE} Importar do Bling</button>
        <button class="btn-secondary btn-sm" onclick="produtoImportFotos()">${IC_CAM} Importar fotos em lote</button>
        ${ehGestor() ? `<button class="btn-secondary btn-sm" onclick="produtoPlanilha()">${IC_SHEET} Planilha</button>` : ''}
        <button class="btn-primary btn-sm" onclick="produtoNovo()">${IC_PLUS} Novo produto</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Produtos</span><span class="kpi-ic">${IC_GEM}</span></div><div class="kpi-val">${totProd}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Peças em estoque</span><span class="kpi-ic">${IC_BARCODE}</span></div><div class="kpi-val">${totPecas}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Valor em estoque</span><span class="kpi-ic">${IC_SHEET}</span></div><div class="kpi-val">${fmtBRL(totValor)}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Sem foto</span><span class="kpi-ic">${IC_CAM}</span></div><div class="kpi-val"${semFoto ? ' style="color:var(--warning)"' : ''}>${semFoto}</div></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <input type="text" class="form-control" style="flex:1;min-width:200px" placeholder="Buscar por nome, SKU, código, cód. fornecedor ou coleção..."
        value="${esc(filtroProdutos)}" oninput="produtoFiltrar(this.value)">
      <select class="form-control" style="max-width:200px" onchange="produtoFiltrarColecao(this.value)">
        <option value="">Todas as coleções</option>
        ${(cadastroCache.colecoes || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filtroColecao) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>
      <select class="form-control" style="max-width:200px" onchange="produtoFiltrarCategoria(this.value)">
        <option value="">Todas as categorias</option>
        ${(cadastroCache.categorias || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filtroCategoria) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>
      <select class="form-control" style="max-width:200px" onchange="produtoFiltrarFornecedor(this.value)">
        <option value="">Todos os fornecedores</option>
        ${(cadastroCache.fornecedores || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filtroFornecedor) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>
      <select class="form-control" style="max-width:200px" onchange="produtoFiltrarCaracteristica(this.value)">
        <option value="">Todas as características</option>
        ${Object.entries(CARACT_FILTROS).map(([k, v]) => `<option value="${k}" ${k === filtroCaract ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select>
    </div>
    <div id="prod-lista">${tabelaHTML()}</div>`;
}

export function produtoFiltrar(v) { filtroProdutos = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarColecao(v) { filtroColecao = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarCategoria(v) { filtroCategoria = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarFornecedor(v) { filtroFornecedor = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarCaracteristica(v) { filtroCaract = v; paginaAtual = 1; renderTabela(); }

// ── Custo editável inline na grid (só admin) ──
export function produtoPagina(delta) { paginaAtual += delta; renderTabela(); }
export function produtoToggleGrupo(chave) {
  const base = decodeURIComponent(chave);
  if (gruposAbertos.has(base)) gruposAbertos.delete(base);
  else gruposAbertos.add(base);
  renderTabela();
}

// ════════════════════════════════════════════════════════════════════
// IMPORTAR DO BLING
// ════════════════════════════════════════════════════════════════════
export function produtoImportarBling() {
  panel().innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;gap:10px">
      <button class="btn-voltar-ciclo" onclick="produtoVoltarLista()">← Voltar</button>
      <div class="section-title" style="font-size:19px">Importar do Bling</div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <p style="font-size:13px;color:var(--muted);margin:0">Traz os produtos do Bling para o catálogo daqui (nome, código/SKU, código de barras, preço, custo e foto). Não duplica: SKU/código de barras que já existem são ignorados; os existentes têm custo/foto completados se estiverem vazios.</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
        <div class="form-group" style="margin:0"><label class="form-label">SKU de</label>
          <input type="number" id="imp-sku-de" class="form-control" style="max-width:130px" placeholder="21800" inputmode="numeric"></div>
        <div class="form-group" style="margin:0"><label class="form-label">SKU até</label>
          <input type="number" id="imp-sku-ate" class="form-control" style="max-width:130px" placeholder="21933" inputmode="numeric"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--plum);padding-bottom:10px;cursor:pointer">
          <input type="checkbox" id="imp-ativos" checked> Só produtos ativos</label>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 0 0">Deixe em branco para trazer tudo. Os SKUs da Lizzie são sequenciais — use a faixa do lote que você quer importar. A varredura passa por todo o catálogo do Bling (o lote novo costuma estar nas últimas páginas), então pode levar alguns minutos.</p>
      <button class="btn-primary btn-sm" style="margin-top:12px" onclick="produtoImportBlingPreview()">${IC_BARCODE} Buscar produtos da faixa</button>
    </div>
    <div id="import-bling-area"></div>`;
}

function impErro(msg) {
  return `<div class="card" style="border-color:var(--danger)"><div style="color:var(--danger);font-size:13px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${esc(msg)}</div></div>`;
}

export async function produtoImportBlingPreview() {
  const { skuDe, skuAte } = impFaixaSku();
  const semFaixa = skuDe == null && skuAte == null;
  // Guarda: sem faixa varre e traz o catálogo INTEIRO — confirma pra não fazer
  // isso por engano (ex.: DOM antigo após hot-reload leu os campos vazios).
  if (semFaixa) {
    confirmarAcao('Importar catálogo inteiro?',
      'Você não definiu a faixa de SKU (SKU de / SKU até) — a busca vai varrer e trazer TODOS os produtos do Bling. Se era pra importar só um lote, cancele e preencha a faixa.',
      'Trazer tudo', () => rodarVarreduraBling(null, null));
    return;
  }
  rodarVarreduraBling(skuDe, skuAte);
}

async function rodarVarreduraBling(skuDe, skuAte) {
  const area = document.getElementById('import-bling-area');
  const soAtivos = impSoAtivos();
  const faixaLabel = (skuDe != null || skuAte != null) ? `faixa ${skuDe ?? '…'}–${skuAte ?? '…'}` : 'SEM faixa (todos)';
  blingScan = null;
  area.innerHTML = `<div class="card"><div id="imp-prog" style="font-size:13px">Iniciando varredura do Bling (${faixaLabel})...</div>
    <button class="btn-secondary btn-sm" style="margin-top:10px" onclick="produtoImportBlingParar(this)">Parar</button></div>`;
  const prog = () => document.getElementById('imp-prog');

  let res;
  try {
    res = await varrerBling(skuDe, skuAte, soAtivos, ({ pagina, matched, totalVarridos }) => {
      if (prog()) prog().textContent = `Varrendo página ${pagina} · ${faixaLabel} · ${matched} no intervalo · ${totalVarridos} varridos`;
    });
  } catch (e) { area.innerHTML = impErro(e.message || 'Erro na varredura'); return; }

  blingScan = res;
  const { matched, totalVarridos, foraIntervalo, parado } = res;
  const faixaTxt = (skuDe != null || skuAte != null) ? ` entre ${skuDe ?? '…'} e ${skuAte ?? '…'}` : '';

  if (!matched.length) {
    area.innerHTML = impErro(`Nenhum produto${faixaTxt}${parado ? ' (varredura interrompida)' : ''} — confira a faixa. Varridos: ${totalVarridos}.`);
    return;
  }

  const mapped = matched.slice(0, 12);
  const rows = mapped.map(m => `<tr class="ciclo-row">
    <td class="ciclo-td"><div style="display:flex;align-items:center;gap:8px"><span class="ciclo-emoji">${m.foto_url ? `<img src="${esc(m.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">` : IC_GEM}</span><div class="ciclo-desc">${esc(m.nome)}</div></div></td>
    <td class="ciclo-td">${m.sku ? esc(m.sku) : '—'}</td>
    <td class="ciclo-td">${m.codigo_barras ? esc(m.codigo_barras) : '<span style="color:var(--danger)">faltando</span>'}</td>
    <td class="ciclo-td">${fmtBRL(m.preco_venda)}</td></tr>`).join('');

  area.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--plum);font-weight:600;margin-bottom:8px">Prévia — ${matched.length} produto(s)${faixaTxt} (mostrando ${mapped.length})${parado ? ' · varredura interrompida' : ''}</div>
      <div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">Produto</th><th class="pag-th">SKU</th><th class="pag-th">Cód. barras</th><th class="pag-th">Preço</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">Varridos no total: ${totalVarridos} · Fora do intervalo/inativos: ${foraIntervalo}</div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="produtoImportBlingRun()">Importar ${matched.length} produto(s)</button>
        <span style="font-size:12px;color:var(--muted)">Confira o código de barras e a foto acima antes de importar.</span>
      </div>
    </div>`;
}

export async function produtoImportBlingRun() {
  if (!blingScan || !(blingScan.matched || []).length) { toast('Faça a prévia da faixa primeiro'); return; }
  const area = document.getElementById('import-bling-area');
  area.innerHTML = '<div class="card"><div id="imp-prog" style="font-size:13px">Preparando importação...</div></div>';
  const prog = () => document.getElementById('imp-prog');

  // Existentes: usados pra deduplicar (nunca duplica) E pra completar campos
  // vazios (custo zerado / sem foto) com o que veio do Bling — sem sobrescrever nada.
  const { data: existentes } = await fetchPaginado(() => sb.from('produtos').select('id,sku,codigo_barras,custo_compra,foto_url').order('id'));
  const porSku = new Map((existentes || []).filter(p => p.sku).map(p => [p.sku, p]));
  const porBarras = new Map((existentes || []).filter(p => p.codigo_barras).map(p => [p.codigo_barras, p]));

  // Opera sobre a lista JÁ filtrada pela faixa (a varredura aconteceu na prévia).
  const totalBling = blingScan.totalVarridos;
  let pulados = 0;
  const paraInserir = [];
  const paraCompletar = [];   // updates parciais: só campos hoje vazios
  for (const m of blingScan.matched) {
    const ex = (m.sku && porSku.get(m.sku)) || (m.codigo_barras && porBarras.get(m.codigo_barras));
    if (ex) {
      // ex sem id = duplicado DENTRO do próprio Bling nesta varredura (mesmo SKU
      // duas vezes) — só pula; completar vale apenas pra registro já no banco.
      const upd = {};
      if (ex.id && !(Number(ex.custo_compra) > 0) && m.custo_compra > 0) upd.custo_compra = m.custo_compra;
      if (ex.id && !ex.foto_url && m.foto_url) upd.foto_url = m.foto_url;
      if (ex.id && Object.keys(upd).length) paraCompletar.push({ id: ex.id, ...upd });
      else pulados++;
      continue;
    }
    if (m.sku) porSku.set(m.sku, m);
    if (m.codigo_barras) porBarras.set(m.codigo_barras, m);
    paraInserir.push(m);
  }

  // A varredura do Bling demora minutos — re-checa os existentes AGORA, na hora
  // de gravar. Evita duplicate key (23505) quando uma rodada anterior abortada
  // (ou outra aba) já gravou parte dos "novos" desde o início desta rodada.
  const { data: atuais } = await fetchPaginado(() => sb.from('produtos').select('id,sku,codigo_barras').order('id'));
  const skuAgora = new Set((atuais || []).map(p => p.sku).filter(Boolean));
  const barrasAgora = new Set((atuais || []).map(p => p.codigo_barras).filter(Boolean));
  const aInserir = paraInserir.filter(m =>
    !(m.sku && skuAgora.has(m.sku)) && !(m.codigo_barras && barrasAgora.has(m.codigo_barras)));
  pulados += paraInserir.length - aInserir.length;

  let gravados = 0;
  for (let i = 0; i < aInserir.length; i += 200) {
    const lote = aInserir.slice(i, i + 200);
    if (prog()) prog().textContent = `Gravando novos ${gravados}/${aInserir.length}...`;
    const { error } = await sb.from('produtos').insert(lote);
    if (error && error.code === '23505') {
      // corrida com outra aba/rodada: grava o lote linha a linha, pulando repetidos
      let linha = 0;
      for (const row of lote) {
        linha++;
        if (prog() && linha % 10 === 0) prog().textContent = `Gravando novos ${gravados}/${aInserir.length}... (lote com duplicados: ${linha}/${lote.length} linha a linha)`;
        const { error: e1 } = await sb.from('produtos').insert(row);
        if (e1 && e1.code === '23505') { pulados++; continue; }
        if (e1) { if (prog()) prog().innerHTML = impErro('Erro ao gravar: ' + e1.message); return; }
        gravados++;
      }
      continue;
    }
    if (error) { if (prog()) prog().innerHTML = impErro('Erro ao gravar: ' + error.message); return; }
    gravados += lote.length;
  }

  let completados = 0;
  for (const u of paraCompletar) {
    if (prog() && completados % 25 === 0) prog().textContent = `Completando campos vazios ${completados}/${paraCompletar.length}...`;
    const { id, ...campos } = u;
    const { error } = await sb.from('produtos').update(campos).eq('id', id);
    if (error) { if (prog()) prog().innerHTML = impErro('Erro ao completar produto: ' + error.message); return; }
    completados++;
  }

  if (prog()) prog().innerHTML = `
    <div style="color:var(--success);font-weight:600"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Importação concluída</div>
    <div style="font-size:13px;margin-top:6px">Varridos no Bling: ${totalBling} · No intervalo: ${blingScan.matched.length} · Novos: ${gravados} · Completados (custo/foto que faltava): ${completados} · Já completos: ${pulados}</div>
    <button class="btn-primary btn-sm" style="margin-top:10px" onclick="produtoVoltarLista()">Ver produtos</button>`;
}

// ════════════════════════════════════════════════════════════════════
// IMPORTAR FOTOS EM LOTE (casa foto ↔ produto pelo SKU no nome do arquivo)
// ════════════════════════════════════════════════════════════════════
// Nome do arquivo: "{SKU} - {descrição} - R$ {preço}.jpg". Só o SKU (dígitos
// iniciais) é usado; descrição/preço já vieram do Bling. Vários arquivos do
// mesmo SKU viram as imagens do produto (ordem natural; a 1ª = principal).
const IC_UPLOAD = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>';
const IC_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_WARN  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';

const FOTO_TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
let fotosLote = null;   // { receberao:[], jaComFoto:[], naoCasou:[] } — resultado da análise

function produtoTemFoto(p) {
  return !!p.foto_url || (Array.isArray(p.imagens) && p.imagens.length > 0);
}

export function produtoImportFotos() {
  fotosLote = null;
  panel().innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;gap:10px">
      <button class="btn-voltar-ciclo" onclick="produtoVoltarLista()">← Voltar</button>
      <div class="section-title" style="font-size:19px">Importar fotos em lote</div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <p style="font-size:13px;color:var(--muted);margin:0">Selecione várias fotos de uma vez. O sistema casa cada foto com o produto pelo <b>SKU no início do nome do arquivo</b> (ex.: <code>21800 - Brinco ... - R$ 42,00.jpg</code>). Fotos do mesmo SKU viram as imagens desse produto (a primeira, em ordem, é a principal). Nada é enviado antes de você conferir o relatório.</p>
      <input type="file" id="fotos-lote-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none" onchange="produtoFotosSelecionar(this)">
      <button class="btn-primary btn-sm" style="margin-top:12px" onclick="document.getElementById('fotos-lote-input').click()">${IC_UPLOAD} Selecionar fotos</button>
    </div>
    <div id="fotos-lote-area"></div>`;
}

export async function produtoFotosSelecionar(input) {
  const files = [...(input.files || [])];
  input.value = '';   // permite reescolher os mesmos arquivos
  if (!files.length) return;
  const area = document.getElementById('fotos-lote-area');
  area.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Analisando arquivos e casando por SKU...</div>';

  const { data: produtos, error } = await fetchPaginado(() => sb.from('produtos')
    .select('id,nome,sku,codigo_barras,foto_url,imagens').order('id'));
  if (error) { area.innerHTML = impErro('Erro ao carregar produtos: ' + (error.message || '')); return; }

  // Índices de busca: SKU exato, SKU sem zeros à esquerda, e código de barras.
  const porSku = new Map(), porSkuNorm = new Map(), porBarras = new Map();
  for (const p of (produtos || [])) {
    if (p.sku) { const s = String(p.sku).trim(); porSku.set(s, p); porSkuNorm.set(s.replace(/^0+/, ''), p); }
    if (p.codigo_barras) porBarras.set(String(p.codigo_barras).trim(), p);
  }
  const acharProduto = (sku) => porSku.get(sku) || porSkuNorm.get(sku.replace(/^0+/, '')) || porBarras.get(sku) || null;

  const grupos = new Map();      // produto.id -> { produto, sku, files:[] }
  const naoCasou = [];           // { name, motivo }
  for (const file of files) {
    const nome = file.name.trim();
    const m = nome.match(/^(\d+)/);
    if (!m) { naoCasou.push({ name: file.name, motivo: 'sem dígitos no início do nome' }); continue; }
    if (!FOTO_TIPOS.includes(file.type)) { naoCasou.push({ name: file.name, motivo: 'tipo inválido' }); continue; }
    if (file.size > MAX_IMG_MB * 1024 * 1024) { naoCasou.push({ name: file.name, motivo: `maior que ${MAX_IMG_MB}MB` }); continue; }
    const sku = m[1];
    const prod = acharProduto(sku);
    if (!prod) { naoCasou.push({ name: file.name, motivo: 'SKU não encontrado no catálogo' }); continue; }
    const k = String(prod.id);
    if (!grupos.has(k)) grupos.set(k, { produto: prod, sku, files: [] });
    grupos.get(k).files.push(file);
  }

  // Ordena por nome (ordem natural) e aplica o teto de MAX_IMAGENS por produto;
  // o excedente vira "não casou" (ignorado), como pede o relatório.
  for (const g of grupos.values()) {
    g.files.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    if (g.files.length > MAX_IMAGENS) {
      for (const extra of g.files.slice(MAX_IMAGENS)) naoCasou.push({ name: extra.name, motivo: `passou do limite de ${MAX_IMAGENS} imagens` });
      g.files = g.files.slice(0, MAX_IMAGENS);
    }
  }

  const receberao = [], jaComFoto = [];
  for (const g of grupos.values()) (produtoTemFoto(g.produto) ? jaComFoto : receberao).push(g);
  receberao.sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, 'pt-BR'));
  jaComFoto.sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, 'pt-BR'));

  fotosLote = { receberao, jaComFoto, naoCasou };
  renderRelatorioFotos();
}

function linhaGrupoFoto(g) {
  return `<tr class="ciclo-row">
    <td class="ciclo-td"><div class="ciclo-desc">${esc(g.produto.nome)}</div></td>
    <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px;color:var(--muted)">${esc(g.produto.sku || g.sku)}</td>
    <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${g.files.length}</span></td></tr>`;
}

function renderRelatorioFotos() {
  const area = document.getElementById('fotos-lote-area');
  const { receberao, jaComFoto, naoCasou } = fotosLote;
  const arqReceber = receberao.reduce((s, g) => s + g.files.length, 0);
  const totalAImportar = receberao.length;   // "já têm foto" só entra se marcar substituir

  const blocoReceber = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--success);margin-bottom:8px;display:flex;align-items:center;gap:6px">${IC_CHECK} Vão receber foto — ${receberao.length} produto${receberao.length !== 1 ? 's' : ''} (${arqReceber} arquivo${arqReceber !== 1 ? 's' : ''})</div>
      ${receberao.length ? `<div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">Produto</th><th class="pag-th">SKU</th><th class="pag-th" style="text-align:center">Fotos</th></tr></thead><tbody>${receberao.map(linhaGrupoFoto).join('')}</tbody></table></div>` : '<p style="font-size:12px;color:var(--muted);margin:0">Nenhum produto novo para receber foto.</p>'}
    </div>`;

  const blocoJaTem = jaComFoto.length ? `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--gold);margin-bottom:8px;display:flex;align-items:center;gap:6px">${IC_WARN} Já têm foto — ${jaComFoto.length} produto${jaComFoto.length !== 1 ? 's' : ''} (pulados por padrão)</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--plum);cursor:pointer;margin-bottom:10px">
        <input type="checkbox" id="fotos-substituir" onchange="produtoFotosToggleSubstituir()"> Substituir fotos existentes desses produtos</label>
      <div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">Produto</th><th class="pag-th">SKU</th><th class="pag-th" style="text-align:center">Fotos</th></tr></thead><tbody>${jaComFoto.map(linhaGrupoFoto).join('')}</tbody></table></div>
    </div>` : '';

  const blocoNaoCasou = naoCasou.length ? `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--danger);margin-bottom:8px;display:flex;align-items:center;gap:6px">${IC_WARN} Não casaram — ${naoCasou.length} arquivo${naoCasou.length !== 1 ? 's' : ''}</div>
      <div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">Arquivo</th><th class="pag-th">Motivo</th></tr></thead><tbody>${naoCasou.map(f => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px">${esc(f.name)}</td><td class="ciclo-td" style="font-size:12px;color:var(--muted)">${esc(f.motivo)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : '';

  area.innerHTML = blocoReceber + blocoJaTem + blocoNaoCasou + `
    <div class="card">
      <button class="btn-primary" id="fotos-btn-importar" ${totalAImportar ? '' : 'disabled style="opacity:.5"'} onclick="produtoFotosImportar()">${IC_UPLOAD} <span id="fotos-btn-label">Importar ${arqReceber} foto${arqReceber !== 1 ? 's' : ''} em ${totalAImportar} produto${totalAImportar !== 1 ? 's' : ''}</span></button>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Enviar pode levar alguns minutos — <b>não feche esta aba</b> durante o envio. Rodar de novo é seguro: produtos que já têm foto são pulados (a menos que você marque substituir).</p>
    </div>`;
}

// Recalcula o rótulo/estado do botão quando marca/desmarca "substituir".
export function produtoFotosToggleSubstituir() {
  if (!fotosLote) return;
  const substituir = document.getElementById('fotos-substituir')?.checked;
  const alvos = substituir ? [...fotosLote.receberao, ...fotosLote.jaComFoto] : fotosLote.receberao;
  const arquivos = alvos.reduce((s, g) => s + g.files.length, 0);
  const btn = document.getElementById('fotos-btn-importar');
  const label = document.getElementById('fotos-btn-label');
  if (label) label.textContent = `Importar ${arquivos} foto${arquivos !== 1 ? 's' : ''} em ${alvos.length} produto${alvos.length !== 1 ? 's' : ''}`;
  if (btn) { btn.disabled = !alvos.length; btn.style.opacity = alvos.length ? '' : '.5'; }
}

// Envia os arquivos de um produto e grava as URLs numa única atualização.
async function subirGrupoFotos(g) {
  const urls = [];
  const falhas = [];
  for (let i = 0; i < g.files.length; i++) {
    const file = g.files[i];
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fname = `produtos/${g.sku}_${Date.now()}_${i}.${ext}`;
    const { error: upErr } = await sb.storage.from('lizzie-fotos').upload(fname, file, { upsert: true });
    if (upErr) { falhas.push({ name: file.name, motivo: upErr.message || 'erro no upload' }); continue; }
    urls.push(sb.storage.from('lizzie-fotos').getPublicUrl(fname).data.publicUrl);
  }
  if (!urls.length) return { enviadas: 0, atualizado: false, falhas };
  const imagens = urls.slice(0, MAX_IMAGENS);
  let { error } = await sb.from('produtos').update({ imagens, foto_url: imagens[0] }).eq('id', g.produto.id);
  // Migração 0004 (coluna imagens) não rodada: grava só a foto principal.
  if (error && /imagens/i.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
    ({ error } = await sb.from('produtos').update({ foto_url: imagens[0] }).eq('id', g.produto.id));
  }
  if (error) return { enviadas: urls.length, atualizado: false, falhas: [...falhas, { name: g.produto.nome, motivo: error.message || 'erro ao salvar' }] };
  return { enviadas: urls.length, atualizado: true, falhas };
}

export async function produtoFotosImportar() {
  if (!fotosLote) return;
  const substituir = document.getElementById('fotos-substituir')?.checked;
  const alvos = substituir ? [...fotosLote.receberao, ...fotosLote.jaComFoto] : fotosLote.receberao;
  if (!alvos.length) { toast('Nada para importar'); return; }

  const area = document.getElementById('fotos-lote-area');
  area.innerHTML = `<div class="card"><div id="fotos-prog" style="font-size:13px">Iniciando envio...</div>
    <p style="font-size:11.5px;color:var(--danger);margin:8px 0 0">Não feche esta aba até terminar.</p></div>`;
  const prog = () => document.getElementById('fotos-prog');

  let prodOk = 0, fotosEnviadas = 0, done = 0;
  const falhas = [];

  // Concorrência baixa (máx. 3 produtos simultâneos): são ~120 produtos, não
  // dispara centenas de uploads de uma vez. Um erro num arquivo/produto NÃO
  // aborta o lote — registra e segue.
  const LIMITE = 3;
  let idx = 0;
  async function worker() {
    while (idx < alvos.length) {
      const g = alvos[idx++];
      let r;
      try { r = await subirGrupoFotos(g); }
      catch (e) { r = { enviadas: 0, atualizado: false, falhas: [{ name: g.produto.nome, motivo: e.message || 'erro inesperado' }] }; }
      if (r.atualizado) prodOk++;
      fotosEnviadas += r.enviadas;
      if (r.falhas.length) falhas.push(...r.falhas);
      done++;
      if (prog()) prog().textContent = `Enviando ${done} de ${alvos.length} produtos... (${fotosEnviadas} foto${fotosEnviadas !== 1 ? 's' : ''} enviada${fotosEnviadas !== 1 ? 's' : ''})`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMITE, alvos.length) }, worker));

  const listaFalhas = falhas.length ? `
    <div style="margin-top:10px"><div style="font-size:12.5px;font-weight:600;color:var(--danger)">Falhas (${falhas.length}):</div>
    <div class="pag-wrap" style="margin-top:6px"><table class="pag-table"><thead><tr><th class="pag-th">Arquivo/Produto</th><th class="pag-th">Motivo</th></tr></thead><tbody>${falhas.map(f => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px">${esc(f.name)}</td><td class="ciclo-td" style="font-size:12px;color:var(--muted)">${esc(f.motivo)}</td></tr>`).join('')}</tbody></table></div></div>` : '';

  if (prog()) prog().parentElement.innerHTML = `
    <div style="color:var(--success);font-weight:600;display:flex;align-items:center;gap:6px">${IC_CHECK} Importação concluída</div>
    <div style="font-size:13px;margin-top:6px">${prodOk} produto${prodOk !== 1 ? 's' : ''} atualizado${prodOk !== 1 ? 's' : ''} · ${fotosEnviadas} foto${fotosEnviadas !== 1 ? 's' : ''} enviada${fotosEnviadas !== 1 ? 's' : ''} · ${falhas.length} falha${falhas.length !== 1 ? 's' : ''}</div>
    ${listaFalhas}
    <button class="btn-primary btn-sm" style="margin-top:12px" onclick="produtoVoltarLista()">Ver produtos</button>`;
}

// ════════════════════════════════════════════════════════════════════
// PLANILHA (CSV): exportar / modelo / importar. Chave = SKU. Célula em
// branco NÃO altera nada. Categoria/Coleção/Fornecedor casam pelo NOME.
// ════════════════════════════════════════════════════════════════════
const PLANILHA_COLS = ['sku', 'nome', 'codigo_barras', 'preco_venda', 'custo_compra', 'estoque_qtd', 'descricao_curta', 'categoria', 'colecao', 'fornecedor', 'codigo_fornecedor', 'peso_liquido', 'peso_bruto', 'largura', 'altura', 'profundidade', 'ativo'];
let planilhaAnalise = null;

// nome do cadastro a partir do id (categorias/colecoes/fornecedores)
function nomeCadastro(tabela, id) {
  const c = (cadastroCache[tabela] || []).find(x => String(x.id) === String(id));
  return c ? c.nome : '';
}
// mapa nome(minúsculo) -> id, para casar cadastro pela planilha
function mapaCadastroPorNome(tabela) {
  const m = new Map();
  for (const x of (cadastroCache[tabela] || [])) m.set(String(x.nome).trim().toLowerCase(), x.id);
  return m;
}
const ptNum = v => (v == null || v === '') ? '' : String(v).replace('.', ',');
const moneyOut = v => Number(v) > 0 ? moneyToInput(v) : '';

// ── Download CSV (separador ; + BOM p/ Excel abrir com acento certo) ──
function csvCelula(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function baixarCSV(nomeArquivo, matriz) {
  const conteudo = '﻿' + matriz.map(l => l.map(csvCelula).join(';')).join('\r\n');
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ── Parser CSV (aspas, separador auto ; ou , pela 1ª linha) ──
function parseCSV(texto) {
  const primeira = (texto.split(/\r?\n/)[0] || '');
  const sep = primeira.split(';').length >= primeira.split(',').length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}
// Excel pt-BR às vezes salva ANSI (windows-1252): se UTF-8 quebrar, redecodifica.
async function lerTextoCSV(file) {
  const buf = await file.arrayBuffer();
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  return txt;
}

export function produtoPlanilha() {
  planilhaAnalise = null;
  panel().innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;gap:10px">
      <button class="btn-voltar-ciclo" onclick="produtoVoltarLista()">← Voltar</button>
      <div class="section-title" style="font-size:19px">Planilha de produtos</div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:13px;color:var(--text);line-height:1.7">
        <b>Como funciona:</b>
        <ul style="margin:8px 0 0;padding-left:18px;color:var(--muted)">
          <li>A chave é o <b>SKU</b> — é por ele que cada linha encontra o produto.</li>
          <li><b>Célula em branco não altera nada</b> — só os campos preenchidos são gravados.</li>
          <li>Categoria, Coleção e Fornecedor casam <b>pelo nome</b> (têm que existir em Cadastros; nome que não existe é ignorado com aviso).</li>
          <li>Fotos não entram por aqui — use <b>Importar fotos em lote</b>.</li>
          <li>SKU que não existe no catálogo só é criado se você marcar a opção no relatório (precisa de nome).</li>
        </ul>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn-secondary btn-sm" onclick="produtoPlanilhaModelo()">${IC_DOWN} Baixar planilha modelo</button>
        <button class="btn-secondary btn-sm" onclick="produtoPlanilhaExportar(this)">${IC_DOWN} Exportar produtos atuais</button>
        <button class="btn-primary btn-sm" onclick="document.getElementById('planilha-input').click()">${IC_SHEET} Importar planilha</button>
        <input type="file" id="planilha-input" accept=".csv,text/csv" style="display:none" onchange="produtoPlanilhaArquivo(this)">
      </div>
    </div>
    <div id="planilha-area"></div>`;
}

export function produtoPlanilhaModelo() {
  const exemplo = ['21800', 'Brinco Exemplo Ouro 18k', '7891234567890', '42,00', '18,50', '10', 'Brinco leve para o dia a dia', 'Brinco', 'Verão', 'Fornecedor X', 'FORN-123', '', '', '', '', '', 'sim'];
  baixarCSV('modelo-produtos-lizzie.csv', [PLANILHA_COLS, exemplo]);
  toast('Modelo baixado');
}

export async function produtoPlanilhaExportar(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Exportando...'; }
  await carregarCadastrosParaSelect();
  const { data, error } = await fetchPaginado(() => sb.from('produtos').select('*').order('nome'));
  if (btn) { btn.disabled = false; btn.innerHTML = `${IC_DOWN} Exportar produtos atuais`; }
  if (error) { toast('Erro ao exportar'); return; }
  const linhas = [PLANILHA_COLS];
  for (const p of (data || [])) {
    linhas.push([
      p.sku || '', p.nome || '', p.codigo_barras || '',
      moneyOut(p.preco_venda), moneyOut(p.custo_compra),
      p.estoque_qtd ?? '', p.descricao_curta || '',
      nomeCadastro('categorias', p.categoria_id), nomeCadastro('colecoes', p.colecao_id), nomeCadastro('fornecedores', p.fornecedor_id),
      p.codigo_fornecedor || '',
      ptNum(p.peso_liquido), ptNum(p.peso_bruto), ptNum(p.largura), ptNum(p.altura), ptNum(p.profundidade),
      p.ativo === false ? 'não' : 'sim',
    ]);
  }
  baixarCSV('produtos-lizzie.csv', linhas);
  toast(`${(data || []).length} produtos exportados`);
}

export async function produtoPlanilhaArquivo(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const area = document.getElementById('planilha-area');
  area.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Lendo a planilha e comparando com o catálogo...</div>';

  await carregarCadastrosParaSelect();
  const { data: produtos, error } = await fetchPaginado(() => sb.from('produtos').select('*').order('id'));
  if (error) { area.innerHTML = impErro('Erro ao carregar produtos: ' + (error.message || '')); return; }

  const porSku = new Map(), porSkuNorm = new Map();
  for (const p of (produtos || [])) {
    if (p.sku) { const s = String(p.sku).trim(); porSku.set(s, p); porSkuNorm.set(s.replace(/^0+/, ''), p); }
  }
  const acharProduto = sku => porSku.get(sku) || porSkuNorm.get(sku.replace(/^0+/, '')) || null;
  const catMap = mapaCadastroPorNome('categorias'), colMap = mapaCadastroPorNome('colecoes'), fornMap = mapaCadastroPorNome('fornecedores');

  let linhas;
  try { linhas = parseCSV(await lerTextoCSV(file)).filter(l => l.some(c => (c || '').trim() !== '')); }
  catch (e) { area.innerHTML = impErro('Não consegui ler o arquivo: ' + (e.message || e)); return; }
  if (linhas.length < 2) { area.innerHTML = impErro('Planilha vazia ou só com o cabeçalho.'); return; }

  const header = linhas[0].map(h => (h || '').trim().toLowerCase());
  const idx = {};
  PLANILHA_COLS.forEach(c => { const i = header.indexOf(c); if (i >= 0) idx[c] = i; });
  if (idx.sku == null) { area.innerHTML = impErro('Falta a coluna "sku" no cabeçalho. Baixe a planilha modelo e use o mesmo cabeçalho.'); return; }

  const atualizar = [], criar = [], avisos = [];
  let semMudanca = 0;
  for (let r = 1; r < linhas.length; r++) {
    const row = linhas[r];
    const get = c => idx[c] != null ? String(row[idx[c]] ?? '').trim() : '';
    const sku = get('sku');
    if (!sku) { avisos.push({ linha: r + 1, msg: 'sem SKU — linha ignorada' }); continue; }

    const campos = {}, avisosLinha = [];
    for (const c of ['nome', 'codigo_barras', 'descricao_curta', 'codigo_fornecedor']) { const v = get(c); if (v !== '') campos[c] = v; }
    for (const c of ['preco_venda', 'custo_compra']) {
      const v = get(c); if (v === '') continue;
      const n = parseMoneyBR(v);
      if (n != null && !isNaN(n)) campos[c] = n; else avisosLinha.push(`${c} inválido ("${v}")`);
    }
    { const v = get('estoque_qtd'); if (v !== '') { const n = parseInt(v.replace(/[^\d-]/g, ''), 10); if (!isNaN(n)) campos.estoque_qtd = n; else avisosLinha.push('estoque inválido'); } }
    for (const c of ['peso_liquido', 'peso_bruto', 'largura', 'altura', 'profundidade']) {
      const v = get(c); if (v === '') continue;
      const n = parseFloat(v.replace(',', '.'));
      if (!isNaN(n)) campos[c] = n; else avisosLinha.push(`${c} inválido`);
    }
    const nomeCampo = { categoria: ['categoria_id', catMap], colecao: ['colecao_id', colMap], fornecedor: ['fornecedor_id', fornMap] };
    for (const [col, [campo, mapa]] of Object.entries(nomeCampo)) {
      const v = get(col); if (v === '') continue;
      const id = mapa.get(v.toLowerCase());
      if (id) campos[campo] = id; else avisosLinha.push(`${col} "${v}" não existe em Cadastros — ignorado`);
    }
    { const v = get('ativo').toLowerCase(); if (v !== '') {
      if (['sim', 's', '1', 'true', 'ativo'].includes(v)) campos.ativo = true;
      else if (['não', 'nao', 'n', '0', 'false', 'inativo'].includes(v)) campos.ativo = false;
      else avisosLinha.push(`ativo "${v}" inválido`);
    } }
    avisosLinha.forEach(m => avisos.push({ linha: r + 1, msg: `SKU ${sku}: ${m}` }));

    const prod = acharProduto(sku);
    if (!prod) { criar.push({ sku, campos, nome: campos.nome || '', faltaNome: !campos.nome }); continue; }
    const diff = {}, resumo = [];
    for (const [k, v] of Object.entries(campos)) {
      const atual = prod[k];
      const igual = (typeof v === 'number') ? Number(atual || 0) === v : String(atual ?? '') === String(v);
      if (!igual) { diff[k] = v; resumo.push(k); }
    }
    if (Object.keys(diff).length) atualizar.push({ produto: prod, campos: diff, resumo });
    else semMudanca++;
  }

  planilhaAnalise = { atualizar, criar, avisos, semMudanca, total: linhas.length - 1 };
  renderPlanilhaRelatorio();
}

function renderPlanilhaRelatorio() {
  const area = document.getElementById('planilha-area');
  const { atualizar, criar, avisos, semMudanca, total } = planilhaAnalise;
  const podeCriar = criar.filter(c => !c.faltaNome).length;
  const semNome = criar.length - podeCriar;

  const blocoAtualizar = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--success);margin-bottom:8px">Vão ser atualizados — ${atualizar.length} produto${atualizar.length !== 1 ? 's' : ''}</div>
      ${atualizar.length ? `<div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">SKU</th><th class="pag-th">Produto</th><th class="pag-th">Campos que mudam</th></tr></thead><tbody>${atualizar.slice(0, 200).map(a => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px">${esc(a.produto.sku || '')}</td><td class="ciclo-td"><div class="ciclo-desc">${esc(a.produto.nome)}</div></td><td class="ciclo-td" style="font-size:12px;color:var(--muted)">${esc(a.resumo.join(', '))}</td></tr>`).join('')}</tbody></table></div>${atualizar.length > 200 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">Mostrando 200 de ${atualizar.length}.</div>` : ''}` : '<p style="font-size:12px;color:var(--muted);margin:0">Nenhuma alteração encontrada.</p>'}
    </div>`;

  const blocoCriar = criar.length ? `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--plum);margin-bottom:8px">SKUs não encontrados — ${criar.length}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--plum);cursor:pointer;margin-bottom:10px">
        <input type="checkbox" id="planilha-criar" onchange="produtoPlanilhaToggleCriar()"> Criar produtos para esses SKUs${podeCriar !== criar.length ? ` (${podeCriar} com nome; ${semNome} sem nome serão ignorados)` : ''}</label>
      <div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">SKU</th><th class="pag-th">Nome (obrigatório p/ criar)</th></tr></thead><tbody>${criar.slice(0, 200).map(c => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px">${esc(c.sku)}</td><td class="ciclo-td" style="font-size:12px${c.faltaNome ? ';color:var(--danger)' : ''}">${c.faltaNome ? 'faltando nome' : esc(c.nome)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : '';

  const blocoAvisos = avisos.length ? `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:600;color:var(--gold);margin-bottom:8px">Avisos — ${avisos.length} (campo pulado, resto da linha vale)</div>
      <div class="pag-wrap" style="max-height:220px;overflow:auto"><table class="pag-table"><tbody>${avisos.slice(0, 300).map(a => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px;color:var(--muted)">Linha ${a.linha}: ${esc(a.msg)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : '';

  const nada = !atualizar.length && !podeCriar;
  area.innerHTML = blocoAtualizar + blocoCriar + blocoAvisos + `
    <div class="card">
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Linhas na planilha: ${total} · Atualizar: ${atualizar.length} · Sem mudança: ${semMudanca} · Novos: ${criar.length}</div>
      <button class="btn-primary" id="planilha-btn-aplicar" ${nada ? 'disabled style="opacity:.5"' : ''} onclick="produtoPlanilhaAplicar()">Aplicar ${atualizar.length} alteraç${atualizar.length !== 1 ? 'ões' : 'ão'}</button>
    </div>`;
}

export function produtoPlanilhaToggleCriar() {
  if (!planilhaAnalise) return;
  const criar = document.getElementById('planilha-criar')?.checked;
  const novos = criar ? planilhaAnalise.criar.filter(c => !c.faltaNome).length : 0;
  const btn = document.getElementById('planilha-btn-aplicar');
  const totalAcoes = planilhaAnalise.atualizar.length + novos;
  if (btn) {
    btn.textContent = `Aplicar ${planilhaAnalise.atualizar.length} alteraç${planilhaAnalise.atualizar.length !== 1 ? 'ões' : 'ão'}${novos ? ` + criar ${novos}` : ''}`;
    btn.disabled = !totalAcoes; btn.style.opacity = totalAcoes ? '' : '.5';
  }
}

export async function produtoPlanilhaAplicar() {
  if (!planilhaAnalise) return;
  const criarNovos = document.getElementById('planilha-criar')?.checked;
  const alvos = planilhaAnalise.atualizar;
  const novos = criarNovos ? planilhaAnalise.criar.filter(c => !c.faltaNome) : [];
  const total = alvos.length + novos.length;
  if (!total) { toast('Nada para aplicar'); return; }

  const area = document.getElementById('planilha-area');
  area.innerHTML = `<div class="card"><div id="planilha-prog" style="font-size:13px">Aplicando alterações...</div>
    <p style="font-size:11.5px;color:var(--danger);margin:8px 0 0">Não feche esta aba até terminar.</p></div>`;
  const prog = () => document.getElementById('planilha-prog');

  let atualizados = 0, criados = 0, done = 0;
  const falhas = [];
  for (const a of alvos) {
    const { error } = await sbQ(sb.from('produtos').update(a.campos).eq('id', a.produto.id));
    if (error) falhas.push({ item: a.produto.sku || a.produto.nome, msg: error.message || 'erro' }); else atualizados++;
    done++;
    if (prog()) prog().textContent = `Aplicando ${done} de ${total}...`;
  }
  for (const c of novos) {
    const { error } = await sbQ(sb.from('produtos').insert({ ...c.campos, sku: c.sku }));
    if (error) falhas.push({ item: c.sku, msg: error.message || 'erro' }); else criados++;
    done++;
    if (prog()) prog().textContent = `Aplicando ${done} de ${total}...`;
  }

  const listaFalhas = falhas.length ? `<div style="margin-top:10px"><div style="font-size:12.5px;font-weight:600;color:var(--danger)">Falhas (${falhas.length}):</div><div class="pag-wrap" style="margin-top:6px"><table class="pag-table"><tbody>${falhas.map(f => `<tr class="ciclo-row"><td class="ciclo-td" style="font-size:12px">${esc(f.item)}</td><td class="ciclo-td" style="font-size:12px;color:var(--muted)">${esc(f.msg)}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  if (prog()) prog().parentElement.innerHTML = `
    <div style="color:var(--success);font-weight:600;display:flex;align-items:center;gap:6px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Planilha aplicada</div>
    <div style="font-size:13px;margin-top:6px">${atualizados} atualizado${atualizados !== 1 ? 's' : ''} · ${criados} criado${criados !== 1 ? 's' : ''} · ${planilhaAnalise.semMudanca} sem mudança · ${falhas.length} falha${falhas.length !== 1 ? 's' : ''}</div>
    ${listaFalhas}
    <button class="btn-primary btn-sm" style="margin-top:12px" onclick="produtoVoltarLista()">Ver produtos</button>`;
}

// ════════════════════════════════════════════════════════════════════
// FORMULÁRIO (etapas numa página rolável)
// ════════════════════════════════════════════════════════════════════
function optsSelect(tabela, selId) {
  const itens = (cadastroCache[tabela] || []).filter(x => x.ativo !== false);
  return '<option value="">—</option>' + itens.map(x =>
    `<option value="${x.id}" ${String(x.id) === String(selId) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
}

function secHeader(txt, badge) {
  return `<div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:14px;color:var(--plum);margin:22px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border)">${txt}${badge ? ` <span class="badge-soon">${badge}</span>` : ''}</div>`;
}

let precifCfg = null; // parâmetros/cotações p/ o preview do formulário

async function abrirForm(p) {
  await carregarCadastrosParaSelect();
  precifCfg = await carregarPrecificacao(); // null = migração 0013 ausente
  const editando = !!p;
  p = p || {};
  formVariacoes = []; // carregadas depois se editando
  // imagens: array novo (imagens[1] = principal) com fallback pro foto_url legado
  const urlsIniciais = (p.imagens && p.imagens.length) ? p.imagens : (p.foto_url ? [p.foto_url] : []);
  formImagens = urlsIniciais.slice(0, MAX_IMAGENS).map(u => ({ url: u, file: null, preview: u }));

  panel().innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;gap:10px">
      <button class="btn-voltar-ciclo" onclick="produtoVoltarLista()">← Voltar</button>
      <div class="section-title" style="font-size:19px">${editando ? 'Editar produto' : 'Cadastrar novo produto'}</div>
    </div>

    ${secHeader('Dados básicos')}
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Nome *</label>
        <input type="text" id="p-nome" class="form-control" value="${esc(p.nome || '')}"></div>
      <div class="form-group"><label class="form-label">Código (SKU)</label>
        <input type="text" id="p-sku" class="form-control" value="${esc(p.sku || '')}"></div>
      <div class="form-group"><label class="form-label">Preço de venda</label>
        <input type="text" id="p-venda" class="form-control" inputmode="numeric" placeholder="0,00"
          value="${p.preco_venda ? moneyToInput(p.preco_venda) : ''}" oninput="maskMoneyProduto(this)"></div>
      <div class="form-group"><label class="form-label">Categoria</label>
        <select id="p-categoria" class="form-control" onchange="produtoCategoriaBanho()">${optsSelect('categorias', p.categoria_id)}</select></div>
      <div class="form-group"><label class="form-label">Formato</label>
        <select id="p-formato" class="form-control" onchange="produtoToggleVariacao()">
          <option value="simples" ${p.formato !== 'variacao' ? 'selected' : ''}>Simples</option>
          <option value="variacao" ${p.formato === 'variacao' ? 'selected' : ''}>Com variação</option>
        </select></div>
    </div>

    ${secHeader('Características')}
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Código de barras (GTIN/EAN)</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="p-codbarras" class="form-control" value="${esc(p.codigo_barras || '')}" placeholder="Bipe ou digite">
          <button type="button" class="btn-secondary btn-sm" title="Bipar com a câmera" onclick="scanBarcodeInto('p-codbarras')">${IC_CAM}</button>
        </div></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Descrição curta</label>
        <textarea id="p-descricao" class="form-control" rows="2">${esc(p.descricao_curta || '')}</textarea></div>
      <div class="form-group"><label class="form-label">Peso líquido (g)</label>
        <input type="number" id="p-peso-liq" class="form-control" value="${p.peso_liquido ?? ''}"></div>
      <div class="form-group"><label class="form-label">Peso bruto (g)</label>
        <input type="number" id="p-peso-bruto" class="form-control" value="${p.peso_bruto ?? ''}"></div>
      <div class="form-group"><label class="form-label">Largura (cm)</label>
        <input type="number" id="p-largura" class="form-control" value="${p.largura ?? ''}"></div>
      <div class="form-group"><label class="form-label">Altura (cm)</label>
        <input type="number" id="p-altura" class="form-control" value="${p.altura ?? ''}"></div>
      <div class="form-group"><label class="form-label">Profundidade (cm)</label>
        <input type="number" id="p-profundidade" class="form-control" value="${p.profundidade ?? ''}"></div>
    </div>

    ${secHeader('Imagens', 'até 5 · a 1ª é a principal')}
    <div id="p-imagens-grid"></div>
    <input type="file" id="p-imagens-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none" onchange="produtoImgAdd(this)">
    <button type="button" id="p-btn-foto-bling" class="btn-secondary btn-sm" style="margin-top:10px" onclick="produtoImportarFotoBling()">${IC_CAM} Importar foto do Bling (pelo SKU)</button>
    <div style="font-size:11px;color:var(--muted);margin-top:4px">Usa o Código (SKU) para achar a peça no Bling e traz a imagem principal (entra como a 1ª).</div>

    ${secHeader('Coleção e estoque')}
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Coleção</label>
        <select id="p-colecao" class="form-control">${optsSelect('colecoes', p.colecao_id)}</select></div>
      <div class="form-group"><label class="form-label">Depósito</label>
        <input type="text" id="p-deposito" class="form-control" value="${esc(p.deposito || 'Geral')}"></div>
      <div class="form-group"><label class="form-label">Quantidade em estoque</label>
        <input type="number" id="p-estoque" class="form-control" value="${p.estoque_qtd ?? 0}"></div>
      <div class="form-group"><label class="form-label">Custo de compra (R$)</label>
        <input type="text" id="p-custo" class="form-control" inputmode="numeric" placeholder="0,00"
          value="${p.custo_compra ? moneyToInput(p.custo_compra) : ''}" oninput="maskMoneyProduto(this)"></div>
    </div>

    ${secHeader('Fornecedor')}
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Fornecedor</label>
        <div style="display:flex;gap:8px">
          <select id="p-fornecedor" class="form-control" onchange="produtoPrecifPreview()">${optsSelect('fornecedores', p.fornecedor_id)}</select>
          <button type="button" class="btn-secondary btn-sm" title="Cadastrar fornecedor" onclick="produtoNovoFornecedor()">${IC_PLUS}</button>
        </div></div>
      <div class="form-group"><label class="form-label">Código no fornecedor</label>
        <input type="text" id="p-cod-fornecedor" class="form-control" placeholder="código da peça no fornecedor" value="${esc(p.codigo_fornecedor || '')}"></div>
    </div>

    ${secHeader('Precificação', precifCfg ? '' : 'rode a migração 0013')}
    ${precifCfg ? `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Modelo</label>
        <input type="text" id="p-modelo" class="form-control" value="${esc(p.modelo || '')}"></div>
      <div class="form-group"><label class="form-label">Tipo de banho</label>
        <select id="p-tipo-banho" class="form-control" onchange="produtoPrecifPreview()">
          <option value="">— sem precificação —</option>
          ${precifCfg.banhos.filter(b => b.ativo).map(b =>
            `<option value="${esc(b.codigo)}" data-cotacao="${b.cotacao}" ${p.tipo_banho === b.codigo ? 'selected' : ''}>${esc(b.nome)}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Banho (milésimos — só ouro)</label>
        <input type="number" step="0.01" id="p-banho" class="form-control" value="${p.banho ?? 0}" oninput="produtoPrecifPreview()"></div>
      <div class="form-group"><label class="form-label">Peso p/ cálculo (g)</label>
        <input type="number" step="0.01" id="p-peso" class="form-control" value="${p.peso ?? ''}" oninput="produtoPrecifPreview()"></div>
      <div class="form-group"><label class="form-label">Peça bruta (R$)</label>
        <input type="text" id="p-preco-bruto" class="form-control" inputmode="numeric" placeholder="0,00"
          value="${p.preco_bruto ? moneyToInput(p.preco_bruto) : ''}" oninput="maskMoneyBR(this);produtoPrecifPreview()"></div>
      <div class="form-group"><label class="form-label">Verniz</label>
        <input type="number" step="0.01" id="p-verniz" class="form-control" value="${p.verniz ?? 0}" oninput="produtoPrecifPreview()"></div>
    </div>
    <div id="p-precif-preview" style="margin-top:4px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--blush);display:none;gap:22px;flex-wrap:wrap;align-items:flex-end">
      <span style="font-size:12px;color:var(--muted)">Custo<br><b id="p-prev-custo" style="font-size:16px;color:var(--plum)">—</b></span>
      <span style="font-size:12px;color:var(--muted)">Custo c/ verniz<br><b id="p-prev-verniz" style="font-size:16px;color:var(--plum)">—</b></span>
      <span style="font-size:12px;color:var(--muted)">Preço sugerido<br><b id="p-prev-sugerido" style="font-size:16px;color:var(--rose)">—</b></span>
      <button type="button" class="btn-secondary btn-sm" onclick="produtoUsarSugerido()">Usar sugerido no preço de venda</button>
      ${p.precificado_em ? `<span style="font-size:11px;color:var(--muted)">Snapshot atual: cotação ${p.cotacao_usada ?? '—'} · desconto ${p.desconto_usado ?? 0}%</span>` : ''}
    </div>` : `<div style="font-size:12.5px;color:var(--muted);padding:6px 0 2px">Cálculo de custo/preço indisponível — rode a migração <b>0013_precificacao.sql</b> no Supabase.</div>`}

    ${secHeader('Tributação', 'Em breve')}
    <div class="empty-state" style="padding:14px 0"><p style="font-size:12px;color:var(--muted)">Dados fiscais (NCM, CEST, ICMS) chegam em breve.</p></div>

    ${secHeader('Variações')}
    <div id="p-variacoes-wrap"></div>

    <button class="btn-primary" style="width:100%;margin-top:22px" onclick="produtoSalvar(${editando ? `'${p.id}'` : 'null'})">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${editando ? 'Salvar alterações' : 'Salvar produto'}</button>`;

  produtoToggleVariacao();
  renderImagens();
  produtoPrecifPreview();
  if (editando) carregarVariacoes(p.id);
}

// ── Preview de precificação no formulário (motor em precificacao.js) ──
let formPrecif = null; // último cálculo — vira snapshot ao salvar

export function produtoPrecifPreview() {
  const box = document.getElementById('p-precif-preview');
  if (!box || !precifCfg) return;
  const sel = document.getElementById('p-tipo-banho');
  const tipo = sel?.value || '';
  if (!tipo) { box.style.display = 'none'; formPrecif = null; return; }
  const cotacao = parseFloat(sel.selectedOptions[0]?.dataset.cotacao) || 0;
  const forn = (cadastroCache.fornecedores || []).find(f => String(f.id) === String(document.getElementById('p-fornecedor').value));
  const descontoPct = Number(forn?.desconto) || 0;
  const r = calcularPrecificacao({
    tipoBanho: tipo, cotacao,
    banho: parseFloat(document.getElementById('p-banho').value) || 0,
    peso: parseFloat(document.getElementById('p-peso').value) || 0,
    precoBruto: parseMoneyBR(document.getElementById('p-preco-bruto').value),
    verniz: parseFloat(document.getElementById('p-verniz').value) || 0,
    descontoPct, params: precifCfg.params,
  });
  formPrecif = { ...r, cotacao, descontoPct };
  box.style.display = 'flex';
  document.getElementById('p-prev-custo').textContent = fmtBRL(r.custo);
  document.getElementById('p-prev-verniz').textContent = fmtBRL(r.custoVerniz);
  document.getElementById('p-prev-sugerido').textContent = fmtBRL(r.precoSugerido);
}

// Categoria escolhida → preenche o Banho com a milesimagem padrão dela.
export function produtoCategoriaBanho() {
  const cat = (cadastroCache.categorias || []).find(c => String(c.id) === String(document.getElementById('p-categoria').value));
  const el = document.getElementById('p-banho');
  if (el && cat && Number(cat.banho_padrao)) el.value = Number(cat.banho_padrao);
  produtoPrecifPreview();
}

export function produtoUsarSugerido() {
  if (!formPrecif) { toast('Preencha os campos de precificação primeiro.'); return; }
  document.getElementById('p-venda').value = moneyToInput(formPrecif.precoSugerido);
  toast('Preço de venda preenchido com o sugerido — ajuste o arredondamento se quiser.');
}

// ── Imagens do produto (até 5; a 1ª é a principal e vira o foto_url) ──
function renderImagens() {
  const grid = document.getElementById('p-imagens-grid');
  if (!grid) return;
  const thumbs = formImagens.map((img, i) => `
    <div style="position:relative;width:110px">
      <img src="${esc(img.preview)}" style="width:110px;height:110px;object-fit:cover;border-radius:10px;border:2px solid ${i === 0 ? 'var(--rose)' : 'var(--border)'}">
      ${i === 0
        ? '<span style="position:absolute;left:6px;bottom:6px;background:var(--rose);color:#fff;font-size:10px;font-weight:600;padding:2px 7px;border-radius:8px">★ principal</span>'
        : `<button type="button" title="Definir como principal" onclick="produtoImgPrincipal(${i})" style="position:absolute;left:6px;bottom:6px;background:#fff;border:1px solid var(--border);color:var(--muted);font-size:10px;padding:2px 7px;border-radius:8px;cursor:pointer">★ principal</button>`}
      <button type="button" title="Remover" onclick="produtoImgRemover(${i})" style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;border:1px solid var(--border);background:#fff;color:var(--danger);cursor:pointer;font-size:12px;line-height:1">✕</button>
    </div>`).join('');
  const btnAdd = formImagens.length < MAX_IMAGENS
    ? `<div class="foto-upload" style="width:110px;height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0" onclick="document.getElementById('p-imagens-input').click()">
        <span style="color:var(--muted);font-size:11px;text-align:center">${IC_CAM}<br>Adicionar<br>(${formImagens.length}/${MAX_IMAGENS})</span></div>`
    : '';
  grid.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">${thumbs}${btnAdd}</div>`;
}

export function produtoImgAdd(input) {
  const tipos = ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of [...(input.files || [])]) {
    if (formImagens.length >= MAX_IMAGENS) { toast(`Máximo de ${MAX_IMAGENS} imagens por produto.`); break; }
    if (!tipos.includes(file.type)) { toast(`"${file.name}" não é JPG/PNG/WebP — ignorada.`); continue; }
    if (file.size > MAX_IMG_MB * 1024 * 1024) { toast(`"${file.name}" passa de ${MAX_IMG_MB}MB — ignorada.`); continue; }
    const item = { url: null, file, preview: '' };
    formImagens.push(item);
    const reader = new FileReader();
    reader.onload = e => { item.preview = e.target.result; renderImagens(); };
    reader.readAsDataURL(file);
  }
  input.value = ''; // permite escolher o mesmo arquivo de novo
  renderImagens();
}

export function produtoImgRemover(i) {
  formImagens.splice(i, 1); // se era a principal, a próxima assume (índice 0)
  renderImagens();
}

// Importa a imagem principal do produto no Bling casando pelo SKU. A foto entra
// como principal (1ª) na galeria; o Salvar grava a URL normalmente (item já tem url).
export async function produtoImportarFotoBling() {
  const sku = document.getElementById('p-sku').value.trim();
  if (!sku) { toast('Preencha o Código (SKU) primeiro'); return; }
  if (formImagens.length >= MAX_IMAGENS) { toast(`Máximo de ${MAX_IMAGENS} imagens — remova uma antes.`); return; }
  const btn = document.getElementById('p-btn-foto-bling');
  if (btn) { btn.disabled = true; }
  toast('Buscando foto no Bling...');
  try {
    const resp = await fetch(`${BLING_PRODUTO_FOTO_FN}?sku=${encodeURIComponent(sku)}`, { headers: BLING_FN_HEADERS });
    const j = await resp.json();
    if (!resp.ok || !j.publicUrl) { toast(j.error || 'Não foi possível importar a foto'); return; }
    if (formImagens.some(im => im.url === j.publicUrl)) { toast('Essa foto já está no produto.'); return; }
    formImagens.unshift({ url: j.publicUrl, file: null, preview: j.publicUrl }); // vira a principal
    renderImagens();
    toast('Foto importada! Clique em Salvar para confirmar.');
  } catch (e) { console.error(e); toast('Erro ao importar foto'); }
  finally { if (btn) btn.disabled = false; }
}

export function produtoImgPrincipal(i) {
  const [img] = formImagens.splice(i, 1);
  formImagens.unshift(img);
  renderImagens();
}

export async function produtoNovo() { abrirForm(null); }
export async function produtoEditar(id) {
  const { data, error } = await sbQ(sb.from('produtos').select('*').eq('id', id).single());
  if (error || !data) { toast('Erro ao abrir produto'); return; }
  abrirForm(data);
}
export function produtoVoltarLista() { loadProdutos(); }

// ── Variações (client-side até salvar) ──
async function carregarVariacoes(produtoId) {
  const { data } = await sbQ(sb.from('produto_variacoes').select('*').eq('produto_id', produtoId).order('created_at'));
  formVariacoes = (data || []).map(v => ({ atributo: v.atributo, valor: v.valor, sku: v.sku || '', codigo_barras: v.codigo_barras || '', preco_venda: v.preco_venda, estoque_qtd: v.estoque_qtd || 0 }));
  renderVariacoes();
}

export function produtoToggleVariacao() {
  const wrap = document.getElementById('p-variacoes-wrap');
  if (!wrap) return;
  const ativo = document.getElementById('p-formato').value === 'variacao';
  wrap.parentElement && wrap.previousElementSibling; // noop guard
  if (!ativo) {
    wrap.innerHTML = `<p style="font-size:12px;color:var(--muted)">Selecione o formato "Com variação" para adicionar cores, tamanhos, etc.</p>`;
    return;
  }
  renderVariacoes();
}

function renderVariacoes() {
  const wrap = document.getElementById('p-variacoes-wrap');
  if (!wrap || document.getElementById('p-formato').value !== 'variacao') return;
  const rows = formVariacoes.map((v, i) => `
    <tr class="ciclo-row">
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.atributo)}" oninput="produtoVarSet(${i},'atributo',this.value)" placeholder="Tamanho"></td>
      <td class="ciclo-td"><input class="form-control" style="min-width:80px" value="${esc(v.valor)}" oninput="produtoVarSet(${i},'valor',this.value)" placeholder="15"></td>
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.sku || '')}" oninput="produtoVarSet(${i},'sku',this.value)" placeholder="SKU"></td>
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.codigo_barras)}" oninput="produtoVarSet(${i},'codigo_barras',this.value)" placeholder="Cód. barras"></td>
      <td class="ciclo-td" style="text-align:center"><input type="number" class="form-control" style="width:70px" value="${v.estoque_qtd ?? 0}" oninput="produtoVarSet(${i},'estoque_qtd',this.value)"></td>
      <td class="ciclo-td" style="text-align:right"><button class="btn-icon" style="color:var(--danger)" onclick="produtoVarRemover(${i})">${IC_TRASH}</button></td>
    </tr>`).join('');
  wrap.innerHTML = `
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Atributo</th><th class="pag-th">Valor</th><th class="pag-th">SKU</th><th class="pag-th">Cód. barras</th>
      <th class="pag-th" style="text-align:center">Estoque</th><th class="pag-th"></th>
    </tr></thead><tbody>${rows || `<tr><td colspan="6" style="padding:14px;color:var(--muted);font-size:12px">Nenhuma variação. Adicione abaixo.</td></tr>`}</tbody></table></div>
    <button class="btn-secondary btn-sm" style="margin-top:10px" onclick="produtoVarAdicionar()">${IC_PLUS} Adicionar variação</button>`;
}

export function produtoVarAdicionar() {
  // Atributo já vem preenchido (herda o da linha anterior; padrão "Tamanho") —
  // placeholder cinza parecia preenchido e a linha era descartada no salvar.
  const anterior = formVariacoes[formVariacoes.length - 1];
  formVariacoes.push({ atributo: (anterior?.atributo || '').trim() || 'Tamanho', valor: '', sku: '', codigo_barras: '', preco_venda: null, estoque_qtd: 0 });
  renderVariacoes();
}
export function produtoVarRemover(i) { formVariacoes.splice(i, 1); renderVariacoes(); }
export function produtoVarSet(i, campo, val) {
  if (!formVariacoes[i]) return;
  formVariacoes[i][campo] = campo === 'estoque_qtd' ? (parseInt(val) || 0) : val;
}

// Atalho: cadastrar fornecedor sem sair do formulário de produto.
export function produtoNovoFornecedor() { cadNovo('fornecedores'); }

// Quando um cadastro base é salvo (ex.: fornecedor pelo atalho), atualiza o select.
window.addEventListener('cadastro-salvo', (e) => {
  const t = e.detail?.tabela;
  const sel = { fornecedores: 'p-fornecedor', categorias: 'p-categoria', colecoes: 'p-colecao' }[t];
  if (!sel) return;
  const el = document.getElementById(sel);
  if (!el) return;
  const atual = el.value;
  el.innerHTML = optsSelect(t, atual);
  // Seleciona o recém-criado (último por nome não garante; deixa no atual).
});

export function maskMoneyProduto(input) { maskMoneyBR(input); }

// ── Salvar ──
export async function produtoSalvar(id) {
  const nome = document.getElementById('p-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório'); return; }

  const btn = panel().querySelector('.btn-primary[onclick^="produtoSalvar"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  // Upload das imagens novas (as já salvas mantêm a URL). Erro aborta o
  // salvar — nada de produto sem as fotos que o usuário escolheu.
  const imagens = [];
  for (let i = 0; i < formImagens.length; i++) {
    const img = formImagens[i];
    if (img.url) { imagens.push(img.url); continue; }
    const fname = `produtos/${Date.now()}_${i}.${img.file.name.split('.').pop()}`;
    const { error: upErr } = await sb.storage.from('lizzie-fotos').upload(fname, img.file, { upsert: true });
    if (upErr) {
      console.error('Upload de imagem:', upErr);
      if (btn) { btn.disabled = false; btn.textContent = id ? 'Salvar alterações' : 'Salvar produto'; }
      toast(`Erro ao enviar a imagem ${i + 1}: ${upErr.message || 'tente de novo'}`);
      return;
    }
    const url = sb.storage.from('lizzie-fotos').getPublicUrl(fname).data.publicUrl;
    img.url = url; // não re-envia se salvar de novo
    imagens.push(url);
  }
  const foto_url = imagens[0] || null; // principal sincronizada (compat com o resto do app)

  const num = elId => { const v = document.getElementById(elId).value; return v.trim() === '' ? null : Number(v); };
  const formato = document.getElementById('p-formato').value;
  const payload = {
    nome,
    sku: document.getElementById('p-sku').value.trim() || null,
    codigo_barras: document.getElementById('p-codbarras').value.trim() || null,
    preco_venda: parseMoneyBR(document.getElementById('p-venda').value) || 0,
    custo_compra: parseMoneyBR(document.getElementById('p-custo').value) || 0,
    categoria_id: document.getElementById('p-categoria').value || null,
    colecao_id: document.getElementById('p-colecao').value || null,
    fornecedor_id: document.getElementById('p-fornecedor').value || null,
    codigo_fornecedor: document.getElementById('p-cod-fornecedor').value.trim() || null,
    formato,
    peso_liquido: num('p-peso-liq'),
    peso_bruto: num('p-peso-bruto'),
    largura: num('p-largura'),
    altura: num('p-altura'),
    profundidade: num('p-profundidade'),
    descricao_curta: document.getElementById('p-descricao').value.trim() || null,
    foto_url,
    imagens,
    estoque_qtd: parseInt(document.getElementById('p-estoque').value) || 0,
    deposito: document.getElementById('p-deposito').value.trim() || 'Geral',
  };

  // Precificação: entradas + SNAPSHOT do cálculo (cotação do ouro muda;
  // o histórico do produto guarda o valor usado no momento do cadastro).
  if (precifCfg) {
    produtoPrecifPreview(); // garante cálculo atualizado com os campos atuais
    payload.modelo = document.getElementById('p-modelo').value.trim() || null;
    payload.tipo_banho = document.getElementById('p-tipo-banho').value || null;
    payload.banho = parseFloat(document.getElementById('p-banho').value) || 0;
    payload.verniz = parseFloat(document.getElementById('p-verniz').value) || 0;
    payload.peso = num('p-peso');
    payload.preco_bruto = parseMoneyBR(document.getElementById('p-preco-bruto').value) || null;
    if (payload.tipo_banho && formPrecif) {
      payload.custo = formPrecif.custo;
      payload.custo_verniz = formPrecif.custoVerniz;
      payload.preco_sugerido = formPrecif.precoSugerido;
      payload.cotacao_usada = formPrecif.cotacao;
      payload.desconto_usado = formPrecif.descontoPct;
      payload.precificado_em = new Date().toISOString();
    }
  }

  let produtoId = id;
  let error;
  const gravar = async () => {
    if (id) {
      ({ error } = await sb.from('produtos').update(payload).eq('id', id));
    } else {
      const r = await sb.from('produtos').insert(payload).select('id').single();
      error = r.error; produtoId = r.data?.id;
    }
  };
  await gravar();
  // Migração 0004 ainda não rodada: salva sem o array (foto_url principal fica).
  if (error && /imagens/i.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
    console.warn('Coluna imagens ausente (rode a migração 0004):', error.message);
    delete payload.imagens;
    await gravar();
    if (!error) toast('Salvo só com a foto principal — rode a migração 0004 para múltiplas imagens.');
  }
  // Migração 0013 ausente: salva sem os campos de precificação.
  if (error && /tipo_banho|preco_bruto|precificado|cotacao_usada|desconto_usado|custo_verniz|preco_sugerido|modelo|verniz|banho|peso/i.test(error.message || '') && /column|schema cache/i.test(error.message || '')) {
    console.warn('Colunas de precificação ausentes (rode a migração 0013):', error.message);
    ['modelo', 'tipo_banho', 'banho', 'verniz', 'peso', 'preco_bruto', 'custo', 'custo_verniz',
      'preco_sugerido', 'cotacao_usada', 'desconto_usado', 'precificado_em'].forEach(k => delete payload[k]);
    await gravar();
    if (!error) toast('Salvo sem a precificação — rode a migração 0013 no Supabase.');
  }
  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar produto'; }
    if (/duplicate key|unique/i.test(error.message || '')) { toast('SKU ou código de barras já existe.'); return; }
    if (await handleSupabaseError(error, 'Erro ao salvar produto')) return;
    toast('Erro: ' + (error.message || 'tente novamente')); return;
  }

  // variações: substitui (apaga as antigas e regrava) só se formato = variacao
  if (produtoId) {
    if (formato === 'variacao') {
      const vlist = formVariacoes.filter(v => (v.atributo || '').trim() && (v.valor || '').trim())
        .map(v => ({ produto_id: produtoId, atributo: v.atributo.trim(), valor: v.valor.trim(),
          sku: (v.sku || '').trim() || null, codigo_barras: (v.codigo_barras || '').trim() || null,
          preco_venda: v.preco_venda ?? null, estoque_qtd: v.estoque_qtd || 0 }));
      const incompletas = formVariacoes.length - vlist.length;
      // Trava anti-perda: linha digitada mas incompleta NÃO é descartada em silêncio
      if (incompletas > 0) {
        if (btn) { btn.disabled = false; btn.textContent = id ? 'Salvar alterações' : 'Salvar produto'; }
        toast(`${incompletas} variação(ões) sem Atributo ou Valor — preencha (ou remova a linha) antes de salvar`);
        return;
      }
      await sb.from('produto_variacoes').delete().eq('produto_id', produtoId);
      if (vlist.length) {
        const { error: vErr } = await sb.from('produto_variacoes').insert(vlist);
        if (vErr) {
          toast('Produto salvo, mas ERRO ao gravar variações: ' + (vErr.message || 'tente de novo'));
          loadProdutos();
          return;
        }
      }
    } else {
      // virou "simples": limpa variações antigas
      await sb.from('produto_variacoes').delete().eq('produto_id', produtoId);
    }
  }

  toast('Produto salvo!');
  loadProdutos();
}

export function produtoExcluir(id) {
  const p = produtosCache.find(x => String(x.id) === String(id));
  confirmarAcao('Excluir produto', `Excluir "${p?.nome || ''}"? Isso não pode ser desfeito.`, 'Excluir', async () => {
    const { error } = await sb.from('produtos').delete().eq('id', id);
    if (error) {
      if (/foreign key|violates/i.test(error.message || '')) { toast('Não dá para excluir: produto vinculado a maletas.'); return; }
      if (await handleSupabaseError(error, 'Erro ao excluir')) return;
      toast('Erro ao excluir'); return;
    }
    toast('Produto excluído.');
    loadProdutos();
  });
}
