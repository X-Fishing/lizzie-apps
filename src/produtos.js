// Cadastro de Produtos (catálogo-mestre próprio). Lista + formulário em
// etapas (numa página rolável) no padrão visual do app. Só gestor/admin grava.
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { esc, toast, sbQ, fetchPaginado, fmtBRL, confirmarAcao, handleSupabaseError,
         maskMoneyBR, parseMoneyBR, moneyToInput } from './utils.js';
import { cadastroCache, carregarCadastrosParaSelect, cadNovo } from './cadastros.js';

// ── Importação do Bling (Edge Function bling-produtos) ──
const BLING_PRODUTOS_FN = `${SUPABASE_URL}/functions/v1/bling-produtos`;
const BLING_HDRS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchBlingProdutos(pagina, filtros = {}) {
  const qs = new URLSearchParams({ pagina });
  for (const [k, v] of Object.entries(filtros)) if (v) qs.set(k, v);
  const r = await fetch(`${BLING_PRODUTOS_FN}?${qs}`, { headers: BLING_HDRS });
  return r.json();
}

// Lê os filtros escolhidos na tela de importação
function impFiltros() {
  const desde = document.getElementById('imp-desde')?.value || '';
  return desde ? { dataInclusaoInicial: desde } : {};
}
function impSoAtivos() { return document.getElementById('imp-ativos')?.checked ?? true; }

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

let produtosCache = [];
let filtroProdutos = '';
let filtroColecao = '';      // id da coleção selecionada no filtro ('' = todas)
let filtroCategoria = '';    // id da categoria ('' = todas)
let filtroFornecedor = '';   // id do fornecedor ('' = todos)
let paginaAtual = 1;         // paginação client-side da grid
const POR_PAGINA = 50;
let formVariacoes = [];   // variações em edição no formulário (client-side)

function panel() { return document.getElementById('panel-produtos'); }

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
    .select('id,nome,sku,codigo_barras,codigo_fornecedor,preco_venda,estoque_qtd,foto_url,ativo,categoria_id,colecao_id,fornecedor_id,formato')
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
          <span class="ciclo-emoji">${p.foto_url ? `<img src="${esc(p.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : IC_GEM}</span>
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
          <span class="ciclo-emoji">${p.foto_url ? `<img src="${esc(p.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : IC_GEM}</span>
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
          <span class="ciclo-emoji">${foto ? `<img src="${esc(foto)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : IC_GEM}</span>
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
    `<tr><td colspan="5"><div class="empty-state" style="padding:28px 0"><div class="empty-icon">${IC_GEM}</div><p>${(f || filtroColecao || filtroCategoria || filtroFornecedor) ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado ainda'}</p></div></td></tr>`;

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
  panel().innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><div class="section-title">Produtos</div>
      <div class="section-subtitle">${produtosCache.length} produto${produtosCache.length !== 1 ? 's' : ''} no catálogo</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" onclick="produtoImportarBling()">${IC_BARCODE} Importar do Bling</button>
        <button class="btn-primary btn-sm" onclick="produtoNovo()">${IC_PLUS} Novo produto</button>
      </div>
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
    </div>
    <div id="prod-lista">${tabelaHTML()}</div>`;
}

export function produtoFiltrar(v) { filtroProdutos = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarColecao(v) { filtroColecao = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarCategoria(v) { filtroCategoria = v; paginaAtual = 1; renderTabela(); }
export function produtoFiltrarFornecedor(v) { filtroFornecedor = v; paginaAtual = 1; renderTabela(); }
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
        <div class="form-group" style="margin:0"><label class="form-label">Incluídas no Bling a partir de</label>
          <input type="date" id="imp-desde" class="form-control" style="max-width:190px"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--plum);padding-bottom:10px;cursor:pointer">
          <input type="checkbox" id="imp-ativos" checked> Só produtos ativos</label>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 0 0">Deixe a data vazia pra trazer tudo. Ex.: pra só os últimos 2 anos, escolha a data de 2 anos atrás.</p>
      <button class="btn-primary btn-sm" style="margin-top:12px" onclick="produtoImportBlingPreview()">${IC_BARCODE} Buscar prévia (página 1)</button>
    </div>
    <div id="import-bling-area"></div>`;
}

function impErro(msg) {
  return `<div class="card" style="border-color:var(--danger)"><div style="color:var(--danger);font-size:13px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg> ${esc(msg)}</div></div>`;
}

export async function produtoImportBlingPreview() {
  const area = document.getElementById('import-bling-area');
  area.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Buscando no Bling...</div>';
  let resp;
  try { resp = await fetchBlingProdutos(1, impFiltros()); }
  catch (e) { area.innerHTML = impErro('Falha ao chamar a função bling-produtos: ' + e.message); return; }
  console.log('[import-bling] resposta crua da funcao:', resp);
  if (resp?.error) { area.innerHTML = impErro('Bling: ' + resp.error); return; }
  let arr = resp?.data || resp?.retorno?.produtos || [];
  if (impSoAtivos()) arr = arr.filter(p => (p.situacao ?? 'A') === 'A');
  if (!arr.length) {
    area.innerHTML = impErro('A página 1 voltou sem produtos no formato esperado. Segue a resposta crua da função — me manda isto:')
      + `<pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;background:var(--cream);padding:10px;border-radius:8px;max-height:340px;overflow:auto">${esc(JSON.stringify(resp, null, 2))}</pre>`;
    return;
  }
  console.log('[import-bling] 1º produto cru do Bling:', arr[0]);

  const mapped = arr.slice(0, 12).map(mapProdutoBling);
  const rows = mapped.map(m => `<tr class="ciclo-row">
    <td class="ciclo-td"><div style="display:flex;align-items:center;gap:8px"><span class="ciclo-emoji">${m.foto_url ? `<img src="${esc(m.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">` : IC_GEM}</span><div class="ciclo-desc">${esc(m.nome)}</div></div></td>
    <td class="ciclo-td">${m.sku ? esc(m.sku) : '—'}</td>
    <td class="ciclo-td">${m.codigo_barras ? esc(m.codigo_barras) : '<span style="color:var(--danger)">faltando</span>'}</td>
    <td class="ciclo-td">${fmtBRL(m.preco_venda)}</td></tr>`).join('');

  area.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:13px;color:var(--plum);font-weight:600;margin-bottom:8px">Prévia — ${arr.length} produto(s) na página 1 (mostrando ${mapped.length})</div>
      <div class="pag-wrap"><table class="pag-table"><thead><tr><th class="pag-th">Produto</th><th class="pag-th">SKU</th><th class="pag-th">Cód. barras</th><th class="pag-th">Preço</th></tr></thead><tbody>${rows}</tbody></table></div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">Ver JSON cru do 1º produto (conferência de campos)</summary>
        <pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;background:var(--cream);padding:10px;border-radius:8px;max-height:280px;overflow:auto">${esc(JSON.stringify(arr[0], null, 2))}</pre></details>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="produtoImportBlingRun()">Importar TODOS os produtos</button>
        <span style="font-size:12px;color:var(--muted)">Confira o código de barras e a foto acima antes de puxar tudo.</span>
      </div>
    </div>`;
}

export async function produtoImportBlingRun() {
  const area = document.getElementById('import-bling-area');
  area.innerHTML = '<div class="card"><div id="imp-prog" style="font-size:13px">Iniciando importação...</div></div>';
  const prog = () => document.getElementById('imp-prog');

  // Existentes: usados pra deduplicar (nunca duplica) E pra completar campos
  // vazios (custo zerado / sem foto) com o que veio do Bling — sem sobrescrever nada.
  const { data: existentes } = await fetchPaginado(() => sb.from('produtos').select('id,sku,codigo_barras,custo_compra,foto_url').order('id'));
  const porSku = new Map((existentes || []).filter(p => p.sku).map(p => [p.sku, p]));
  const porBarras = new Map((existentes || []).filter(p => p.codigo_barras).map(p => [p.codigo_barras, p]));

  // Filtros capturados UMA vez no início (valem pra rodada inteira)
  const filtros = impFiltros();
  const soAtivos = impSoAtivos();

  let pagina = 1, totalBling = 0, pulados = 0, foraDoFiltro = 0;
  const paraInserir = [];
  const paraCompletar = [];   // updates parciais: só campos hoje vazios
  while (pagina <= 200) {
    if (prog()) prog().textContent = `Buscando página ${pagina} no Bling... (${paraInserir.length} novos · ${paraCompletar.length} a completar)`;
    let resp;
    try { resp = await fetchBlingProdutos(pagina, filtros); }
    catch (e) { if (prog()) prog().innerHTML = impErro('Erro na página ' + pagina + ': ' + e.message); return; }
    if (resp?.error) { if (prog()) prog().innerHTML = impErro('Bling: ' + resp.error); return; }
    const arr = resp?.data || [];
    if (!arr.length) break;
    totalBling += arr.length;
    for (const p of arr) {
      if (soAtivos && (p.situacao ?? 'A') !== 'A') { foraDoFiltro++; continue; }
      const m = mapProdutoBling(p);
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
    pagina++;
    await sleep(350); // respeita ~3 req/s do Bling
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
    <div style="font-size:13px;margin-top:6px">Bling: ${totalBling} · Novos: ${gravados} · Completados (custo/foto que faltava): ${completados} · Já completos: ${pulados}${foraDoFiltro ? ` · Fora do filtro (inativos): ${foraDoFiltro}` : ''}</div>
    <button class="btn-primary btn-sm" style="margin-top:10px" onclick="produtoVoltarLista()">Ver produtos</button>`;
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

async function abrirForm(p) {
  await carregarCadastrosParaSelect();
  const editando = !!p;
  p = p || {};
  formVariacoes = []; // carregadas depois se editando

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
        <select id="p-categoria" class="form-control">${optsSelect('categorias', p.categoria_id)}</select></div>
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

    ${secHeader('Imagem')}
    <div class="foto-upload" onclick="document.getElementById('p-foto-input').click()">
      <img id="p-foto-preview" src="${esc(p.foto_url || '')}" style="display:${p.foto_url ? 'block' : 'none'};max-width:140px;max-height:140px;border-radius:10px;object-fit:cover">
      <div id="p-foto-placeholder" style="display:${p.foto_url ? 'none' : 'block'};color:var(--muted)">${IC_CAM}<br>Toque para adicionar imagem</div>
      <input type="file" id="p-foto-input" accept="image/*" style="display:none" onchange="previewFoto(this,'p-foto-preview','p-foto-placeholder')">
    </div>

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
          <select id="p-fornecedor" class="form-control">${optsSelect('fornecedores', p.fornecedor_id)}</select>
          <button type="button" class="btn-secondary btn-sm" title="Cadastrar fornecedor" onclick="produtoNovoFornecedor()">${IC_PLUS}</button>
        </div></div>
      <div class="form-group"><label class="form-label">Código no fornecedor</label>
        <input type="text" id="p-cod-fornecedor" class="form-control" placeholder="código da peça no fornecedor" value="${esc(p.codigo_fornecedor || '')}"></div>
    </div>

    ${secHeader('Tributação', 'Em breve')}
    <div class="empty-state" style="padding:14px 0"><p style="font-size:12px;color:var(--muted)">Dados fiscais (NCM, CEST, ICMS) chegam em breve.</p></div>

    ${secHeader('Variações')}
    <div id="p-variacoes-wrap"></div>

    <button class="btn-primary" style="width:100%;margin-top:22px" onclick="produtoSalvar(${editando ? `'${p.id}'` : 'null'})">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${editando ? 'Salvar alterações' : 'Salvar produto'}</button>`;

  produtoToggleVariacao();
  if (editando) carregarVariacoes(p.id);
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

export function produtoVarAdicionar() { formVariacoes.push({ atributo: '', valor: '', sku: '', codigo_barras: '', preco_venda: null, estoque_qtd: 0 }); renderVariacoes(); }
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

  // upload de imagem (se nova)
  let foto_url = document.getElementById('p-foto-preview').getAttribute('src') || null;
  const fileInput = document.getElementById('p-foto-input');
  if (fileInput.files[0]) {
    const file = fileInput.files[0];
    const fname = `produtos/${Date.now()}.${file.name.split('.').pop()}`;
    const { error: upErr } = await sb.storage.from('lizzie-fotos').upload(fname, file, { upsert: true });
    if (!upErr) { foto_url = sb.storage.from('lizzie-fotos').getPublicUrl(fname).data.publicUrl; }
  }
  if (foto_url === '') foto_url = null;

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
    estoque_qtd: parseInt(document.getElementById('p-estoque').value) || 0,
    deposito: document.getElementById('p-deposito').value.trim() || 'Geral',
  };

  let produtoId = id;
  let error;
  if (id) {
    ({ error } = await sb.from('produtos').update(payload).eq('id', id));
  } else {
    const r = await sb.from('produtos').insert(payload).select('id').single();
    error = r.error; produtoId = r.data?.id;
  }
  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar produto'; }
    if (/duplicate key|unique/i.test(error.message || '')) { toast('SKU ou código de barras já existe.'); return; }
    if (await handleSupabaseError(error, 'Erro ao salvar produto')) return;
    toast('Erro: ' + (error.message || 'tente novamente')); return;
  }

  // variações: substitui (apaga as antigas e regrava) só se formato = variacao
  if (produtoId) {
    await sb.from('produto_variacoes').delete().eq('produto_id', produtoId);
    if (formato === 'variacao') {
      const vlist = formVariacoes.filter(v => (v.atributo || '').trim() && (v.valor || '').trim())
        .map(v => ({ produto_id: produtoId, atributo: v.atributo.trim(), valor: v.valor.trim(),
          sku: v.sku || null, codigo_barras: v.codigo_barras || null,
          preco_venda: v.preco_venda ?? null, estoque_qtd: v.estoque_qtd || 0 }));
      if (vlist.length) await sb.from('produto_variacoes').insert(vlist);
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
