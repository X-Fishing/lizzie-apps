// Cadastro de Produtos (catálogo-mestre próprio). Lista + formulário em
// etapas (numa página rolável) no padrão visual do app. Só gestor/admin grava.
import { sb } from './supabase.js';
import { esc, toast, sbQ, fmtBRL, confirmarAcao, handleSupabaseError,
         maskMoneyBR, parseMoneyBR, moneyToInput } from './utils.js';
import { cadastroCache, carregarCadastrosParaSelect, cadNovo } from './cadastros.js';

const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_GEM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>';
const IC_BARCODE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>';
const IC_CAM   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

let produtosCache = [];
let filtroProdutos = '';
let formVariacoes = [];   // variações em edição no formulário (client-side)

function panel() { return document.getElementById('panel-produtos'); }

// ════════════════════════════════════════════════════════════════════
// LISTA
// ════════════════════════════════════════════════════════════════════
export async function loadProdutos() {
  panel().innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando produtos...</div>';
  const { data, error } = await sbQ(sb.from('produtos')
    .select('id,nome,sku,codigo_barras,preco_venda,estoque_qtd,foto_url,ativo,categoria_id,colecao_id')
    .order('nome', { ascending: true }));
  if (error) { if (await handleSupabaseError(error, 'Erro ao carregar produtos')) return; }
  produtosCache = data || [];
  renderLista();
}

function renderLista() {
  const f = filtroProdutos.trim().toLowerCase();
  const lista = f
    ? produtosCache.filter(p => [p.nome, p.sku, p.codigo_barras].some(v => (v || '').toLowerCase().includes(f)))
    : produtosCache;

  const linhas = lista.length ? lista.map(p => `
    <tr class="ciclo-row">
      <td class="ciclo-td">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="ciclo-emoji">${p.foto_url ? `<img src="${esc(p.foto_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : IC_GEM}</span>
          <div><div class="ciclo-desc">${esc(p.nome)}</div>
          <div style="font-size:11px;color:var(--muted)">${p.sku ? 'SKU ' + esc(p.sku) : ''}${p.codigo_barras ? ' · ' + esc(p.codigo_barras) : ''}</div></div>
        </div>
      </td>
      <td class="ciclo-td" style="text-align:center"><span class="ciclo-num">${p.estoque_qtd ?? 0}</span></td>
      <td class="ciclo-td"><span class="ciclo-preco">${fmtBRL(p.preco_venda)}</span></td>
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="produtoEditar('${p.id}')">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="produtoExcluir('${p.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="4"><div class="empty-state" style="padding:28px 0"><div class="empty-icon">${IC_GEM}</div><p>${f ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado ainda'}</p></div></td></tr>`;

  panel().innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><div class="section-title">Produtos</div>
      <div class="section-subtitle">${produtosCache.length} produto${produtosCache.length !== 1 ? 's' : ''} no catálogo</div></div>
      <button class="btn-primary btn-sm" onclick="produtoNovo()">${IC_PLUS} Novo produto</button>
    </div>
    <input type="text" class="form-control" style="margin-bottom:14px" placeholder="Buscar por nome, SKU ou código de barras..."
      value="${esc(filtroProdutos)}" oninput="produtoFiltrar(this.value)">
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Produto</th>
      <th class="pag-th" style="text-align:center">Estoque</th>
      <th class="pag-th">Preço</th>
      <th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`;
}

export function produtoFiltrar(v) { filtroProdutos = v; renderLista(); }

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
      <div class="form-group"><label class="form-label">Custo de compra (un.)</label>
        <input type="text" id="p-custo" class="form-control" inputmode="numeric" placeholder="0,00"
          value="${p.custo_compra ? moneyToInput(p.custo_compra) : ''}" oninput="maskMoneyProduto(this)"></div>
    </div>

    ${secHeader('Fornecedor')}
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Fornecedor</label>
        <div style="display:flex;gap:8px">
          <select id="p-fornecedor" class="form-control">${optsSelect('fornecedores', p.fornecedor_id)}</select>
          <button type="button" class="btn-secondary btn-sm" title="Cadastrar fornecedor" onclick="produtoNovoFornecedor()">${IC_PLUS}</button>
        </div></div>
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
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.atributo)}" oninput="produtoVarSet(${i},'atributo',this.value)" placeholder="Cor"></td>
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.valor)}" oninput="produtoVarSet(${i},'valor',this.value)" placeholder="Dourado"></td>
      <td class="ciclo-td"><input class="form-control" style="min-width:90px" value="${esc(v.codigo_barras)}" oninput="produtoVarSet(${i},'codigo_barras',this.value)" placeholder="Cód. barras"></td>
      <td class="ciclo-td" style="text-align:center"><input type="number" class="form-control" style="width:70px" value="${v.estoque_qtd ?? 0}" oninput="produtoVarSet(${i},'estoque_qtd',this.value)"></td>
      <td class="ciclo-td" style="text-align:right"><button class="btn-icon" style="color:var(--danger)" onclick="produtoVarRemover(${i})">${IC_TRASH}</button></td>
    </tr>`).join('');
  wrap.innerHTML = `
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Atributo</th><th class="pag-th">Valor</th><th class="pag-th">Cód. barras</th>
      <th class="pag-th" style="text-align:center">Estoque</th><th class="pag-th"></th>
    </tr></thead><tbody>${rows || `<tr><td colspan="5" style="padding:14px;color:var(--muted);font-size:12px">Nenhuma variação. Adicione abaixo.</td></tr>`}</tbody></table></div>
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
