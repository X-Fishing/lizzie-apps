// Cadastros base (staff/gestor): Categorias, Coleções e Fornecedores.
// Engine genérico CRUD inline (lista + formulário no próprio painel), no
// padrão visual do app. Só gestor/admin grava (RLS reforça no banco).
import { sb } from './supabase.js';
import { esc, toast, sbQ, confirmarAcao, handleSupabaseError, fmtBRL } from './utils.js';

// ── ícones de linha reutilizados (mesma família Lucide do app) ──
const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_EMPTY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';
const IC_CARD  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>';

// ── Configuração de cada cadastro ──────────────────────────────────────
const CFG = {
  categorias: {
    panel: 'categorias', titulo: 'Categorias', singular: 'categoria',
    order: 'nome',
    campos: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'banho_padrao', label: 'Banho padrão (milésimos — só ouro)', type: 'number' },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'banho_padrao'],
    fmt: { banho_padrao: v => (Number(v) || 0) + ' mil.' },
  },
  colecoes: {
    panel: 'colecoes', titulo: 'Coleções', singular: 'coleção', novoLabel: 'Nova coleção',
    order: 'nome',
    campos: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'ano',  label: 'Ano', type: 'number' },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'ano'],
    render: linhas => linhas.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">${linhas.map(c => `
          <div class="card" style="${c.ativo === false ? 'opacity:.55;' : ''}display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--plum)">${esc(c.nome)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${c.ano ? esc(c.ano) : 'Sem ano'}${c.ativo === false ? ' · inativo' : ''}</div>
            </div>
            <div style="white-space:nowrap">${cadAcoesHtml('colecoes', c.id)}</div>
          </div>`).join('')}</div>`
      : `<div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhuma coleção ainda</p></div>`,
  },
  fornecedores: {
    panel: 'fornecedores', titulo: 'Fornecedores', singular: 'fornecedor',
    order: 'nome',
    campos: [
      { key: 'nome',       label: 'Nome / Razão social', type: 'text', required: true },
      { key: 'cnpj_cpf',   label: 'CNPJ / CPF', type: 'text' },
      { key: 'telefone',   label: 'Telefone', type: 'text' },
      { key: 'email',      label: 'E-mail', type: 'text' },
      { key: 'contato',    label: 'Pessoa de contato', type: 'text' },
      { key: 'desconto',   label: 'Desconto na peça bruta (%)', type: 'number' },
      { key: 'observacao', label: 'Observação', type: 'textarea' },
      { key: 'ativo',      label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'telefone', 'desconto'],
    fmt: { desconto: v => (Number(v) || 0) + '%' },
    validar: p => (p.desconto != null && (p.desconto < 0 || p.desconto > 100)) ? 'Desconto deve estar entre 0 e 100.' : null,
  },
  faixas_comissao: {
    panel: 'faixas-comissao', titulo: 'Faixas de Comissão', singular: 'faixa de comissão',
    subtitulo: 'Comissão por valor de venda',
    order: 'valor_min',
    campos: [
      { key: 'valor_min',  label: 'De (R$) — início da faixa (inclusive)', type: 'number', required: true },
      { key: 'valor_max',  label: 'Até (R$) — deixe vazio para "acima de"', type: 'number' },
      { key: 'percentual', label: 'Comissão (%)', type: 'number', required: true },
      { key: 'ativo',      label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['valor_min', 'valor_max', 'percentual'],
    fmt: {
      valor_min:  v => fmtBRL(v),
      valor_max:  v => v == null ? 'sem limite (acima de)' : fmtBRL(v),
      percentual: v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '%',
    },
    validar: p => {
      if (p.valor_min == null || p.valor_min < 0) return 'Informe o início da faixa (R$).';
      if (p.percentual == null || p.percentual < 0 || p.percentual > 100) return 'Percentual deve estar entre 0 e 100.';
      if (p.valor_max != null && Number(p.valor_min) > Number(p.valor_max)) return 'O início da faixa deve ser menor ou igual ao fim.';
      return null;
    },
    avisos: linhas => avisoFaixasComissao(linhas),
  },
  formas_pagamento: {
    panel: 'formas-pagamento', titulo: 'Formas de Pagamento', singular: 'forma de pagamento', novoLabel: 'Nova forma', migracao: '0020_formas_pgto_categorias_fin.sql',
    subtitulo: 'Taxas e prazos usados no fechamento de vendas',
    order: 'nome',
    campos: [
      { key: 'nome',  label: 'Nome (ex.: Cartão de crédito 3x)', type: 'text', required: true },
      { key: 'taxa',  label: 'Taxa (%)', type: 'number', default: 0 },
      { key: 'prazo', label: 'Prazo de recebimento (ex.: na hora, 30 dias)', type: 'text' },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'taxa', 'prazo'],
    render: linhas => linhas.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${linhas.map(f => `
          <div class="card" style="display:flex;align-items:center;gap:14px${f.ativo === false ? ';opacity:.55' : ''}">
            <div class="kpi-ic" style="width:40px;height:40px">${IC_CARD}</div>
            <div style="flex:1;min-width:0">
              <div class="ciclo-desc">${esc(f.nome)}${f.ativo === false ? ' <span class="badge badge-aberta" style="font-size:10px">inativo</span>' : ''}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">Recebimento em ${esc(f.prazo || '—')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--plum)">${Number(f.taxa || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</div>
              <div style="font-size:11px;color:var(--muted)">taxa</div>
            </div>
            <div style="white-space:nowrap">${cadAcoesHtml('formas_pagamento', f.id)}</div>
          </div>`).join('')}</div>`
      : `<div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_CARD}</div><p>Nenhuma forma de pagamento ainda</p></div>`,
  },
  categorias_financeiras: {
    panel: 'categorias-financeiras', titulo: 'Categorias Financeiras', singular: 'categoria financeira', novoLabel: 'Nova categoria', migracao: '0020_formas_pgto_categorias_fin.sql',
    subtitulo: 'Organização de receitas e despesas nos lançamentos',
    order: 'nome',
    campos: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'tipo', label: 'Tipo', type: 'select', default: 'despesa',
        options: [{ value: 'receita', label: 'Receita' }, { value: 'despesa', label: 'Despesa' }] },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'tipo'],
    render: linhas => {
      const col = (titulo, cor, itens) => `
        <div style="flex:1;min-width:240px">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:${cor};margin-bottom:10px">${titulo} (${itens.length})</div>
          ${itens.length ? itens.map(c => `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;margin-bottom:8px${c.ativo === false ? ';opacity:.55' : ''}">
            <span class="ciclo-desc">${esc(c.nome)}${c.ativo === false ? ' <span class="badge badge-aberta" style="font-size:10px">inativo</span>' : ''}</span>
            <span style="white-space:nowrap">${cadAcoesHtml('categorias_financeiras', c.id)}</span></div>`).join('')
            : '<div style="font-size:12px;color:var(--muted)">Nenhuma ainda</div>'}
        </div>`;
      return `<div style="display:flex;gap:20px;flex-wrap:wrap">
        ${col('Receitas', 'var(--success)', linhas.filter(c => c.tipo === 'receita'))}
        ${col('Despesas', 'var(--danger)', linhas.filter(c => c.tipo === 'despesa'))}</div>`;
    },
  },
  config_raspadinha: {
    panel: 'config-raspadinha', titulo: 'Raspadinha', singular: 'configuração de raspadinha',
    subtitulo: 'A cada X reais vendidos na maleta, a revendedora ganha 1 raspadinha',
    order: 'valor_por_raspadinha',
    campos: [
      { key: 'valor_por_raspadinha', label: 'Valor por raspadinha (R$) — ex.: 300', type: 'number', required: true },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['valor_por_raspadinha'],
    fmt: { valor_por_raspadinha: v => fmtBRL(v) },
    validar: p => {
      if (p.valor_por_raspadinha == null || Number(p.valor_por_raspadinha) <= 0) return 'Informe um valor maior que zero.';
      return null;
    },
    avisos: linhas => {
      const ativas = linhas.filter(l => l.ativo);
      return ativas.length > 1
        ? '<div class="alert alert-warning" style="margin-bottom:12px"><b>Atenção:</b> há mais de uma configuração ativa — a régua usa a primeira. Deixe só uma ativa.</div>'
        : '';
    },
  },
};

const LABEL_COL = {
  nome: 'Nome', ano: 'Ano', telefone: 'Telefone', contato: 'Contato',
  valor_min: 'De', valor_max: 'Até', percentual: 'Comissão', desconto: 'Desconto',
  banho_padrao: 'Banho padrão',
};

// Alerta (não bloqueia) sobreposição e lacuna entre faixas ATIVAS.
function avisoFaixasComissao(linhas) {
  const ativas = (linhas || []).filter(f => f.ativo !== false)
    .slice().sort((a, b) => Number(a.valor_min) - Number(b.valor_min));
  // Comparações em CENTAVOS inteiros (evita falso positivo de ponto
  // flutuante: 7000 - 6999.99 = 0.0100000000002 em float).
  const cent = v => Math.round(Number(v) * 100);
  const problemas = [];
  for (let i = 1; i < ativas.length; i++) {
    const ant = ativas[i - 1], cur = ativas[i];
    if (ant.valor_max == null) {
      problemas.push(`"${fmtBRL(ant.valor_min)} em diante" é sem limite, mas existe faixa começando em ${fmtBRL(cur.valor_min)} (sobreposição).`);
    } else if (cent(cur.valor_min) <= cent(ant.valor_max)) {
      problemas.push(`Sobreposição: até ${fmtBRL(ant.valor_max)} e a próxima começa em ${fmtBRL(cur.valor_min)}.`);
    } else if (cent(cur.valor_min) - cent(ant.valor_max) > 1) {
      problemas.push(`Lacuna sem faixa: entre ${fmtBRL(ant.valor_max)} e ${fmtBRL(cur.valor_min)}.`);
    }
  }
  const dicaTeto = ativas.length && ativas[ativas.length - 1].valor_max != null
    ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Dica: acima de ${fmtBRL(ativas[ativas.length - 1].valor_max)} a comissão fica 0% — se quiser cobrir qualquer valor, deixe o "Até" da última faixa em branco (sem limite).</div>`
    : '';
  if (!problemas.length) return dicaTeto;
  return `<div class="alert alert-warning" style="margin-bottom:12px;font-size:12.5px">
    <b>Atenção à configuração das faixas:</b><br>${problemas.map(esc).join('<br>')}</div>${dicaTeto}`;
}

// Cache simples para alimentar os <select> do cadastro de produto.
export const cadastroCache = { categorias: [], colecoes: [], fornecedores: [] };

function panelEl(tabela) { return document.getElementById('panel-' + CFG[tabela].panel); }

// ── Carrega e renderiza a lista ─────────────────────────────────────────
async function carregar(tabela) {
  const cfg = CFG[tabela];
  const el = panelEl(tabela);
  el.innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from(tabela).select('*').order(cfg.order, { ascending: true }));
  if (error) {
    // Tabela ainda não criada: mensagem clara em vez de spinner eterno.
    const faltaTabela = /relation|does not exist|schema cache/i.test(error.message || '');
    el.innerHTML = `<div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_EMPTY}</div><p>${
      faltaTabela && cfg.migracao
        ? `Rode a migração <b>${cfg.migracao}</b> no Supabase para ativar "${cfg.titulo}".`
        : 'Erro ao carregar ' + cfg.titulo + '.'}</p></div>`;
    if (!faltaTabela) await handleSupabaseError(error, 'Erro ao carregar ' + cfg.titulo);
    return;
  }
  cadastroCache[tabela] = data || [];
  render(tabela, data || []);
}

function render(tabela, linhas) {
  const cfg = CFG[tabela];
  const cols = cfg.colunas;
  const thead = cols.map(c => `<th class="pag-th">${LABEL_COL[c] || c}</th>`).join('') +
    '<th class="pag-th" style="text-align:right">Ações</th>';
  const val = (it, c) => cfg.fmt?.[c] ? cfg.fmt[c](it[c]) : esc(it[c] ?? '—');
  const rows = linhas.length ? linhas.map(it => `
    <tr class="ciclo-row">
      ${cols.map((c, i) => `<td class="ciclo-td">${i === 0
        ? `<span class="ciclo-desc">${val(it, c)}</span>${it.ativo === false ? ' <span class="badge badge-aberta" style="font-size:10px">inativo</span>' : ''}`
        : val(it, c)}</td>`).join('')}
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="cadEditar('${tabela}','${it.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="cadExcluir('${tabela}','${it.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="${cols.length + 1}"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhum registro ainda</p></div></td></tr>`;

  // Corpo: render customizado (cards/colunas) ou a tabela padrão.
  const corpo = cfg.render
    ? cfg.render(linhas, tabela)
    : `<div class="pag-wrap"><table class="pag-table"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table></div>`;

  panelEl(tabela).innerHTML = `
    <div class="page-head">
      <div>
        <h2>${cfg.titulo}</h2>
        <div class="sub">${cfg.subtitulo ? cfg.subtitulo + ' · ' : ''}${linhas.length} registro${linhas.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="acts"><button class="btn-primary btn-sm" onclick="cadNovo('${tabela}')">${IC_PLUS} ${cfg.novoLabel || 'Novo'}</button></div>
    </div>
    ${cfg.avisos ? cfg.avisos(linhas) : ''}
    ${corpo}`;
}

// Botões de ação (editar/excluir) reusados pelo render customizado (cards).
export function cadAcoesHtml(tabela, id) {
  return `<button class="btn-icon" title="Editar" onclick="event.stopPropagation();cadEditar('${tabela}','${id}')" style="color:var(--rose)">${IC_EDIT}</button>
    <button class="btn-icon" title="Excluir" onclick="event.stopPropagation();cadExcluir('${tabela}','${id}')" style="color:var(--danger)">${IC_TRASH}</button>`;
}

// ── Formulário (modal genérico) ─────────────────────────────────────────
function abrirForm(tabela, registro) {
  const cfg = CFG[tabela];
  const editando = !!registro;
  const r = registro || {};
  const campos = cfg.campos.map(f => {
    const val = r[f.key] ?? (f.default ?? '');
    if (f.type === 'bool') {
      const checked = (r[f.key] ?? f.default ?? true) ? 'checked' : '';
      return `<label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="cad-f-${f.key}" ${checked} style="width:auto"> ${f.label}</label>`;
    }
    if (f.type === 'textarea') {
      return `<div class="form-group"><label class="form-label">${f.label}</label>
        <textarea id="cad-f-${f.key}" class="form-control" rows="2">${esc(val)}</textarea></div>`;
    }
    if (f.type === 'select') {
      const cur = r[f.key] ?? f.default ?? (f.options[0]?.value);
      return `<div class="form-group"><label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
        <select id="cad-f-${f.key}" class="form-control">${f.options.map(o => `<option value="${esc(o.value)}" ${String(cur) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
    }
    const inputType = f.type === 'number' ? 'number' : 'text';
    return `<div class="form-group"><label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
      <input type="${inputType}" id="cad-f-${f.key}" class="form-control" value="${esc(val)}"></div>`;
  }).join('');

  document.getElementById('cad-modal-titulo').textContent =
    (editando ? 'Editar ' : 'Nova ') + cfg.singular;
  document.getElementById('cad-modal-body').innerHTML = campos;
  const salvar = document.getElementById('cad-modal-salvar');
  salvar.style.display = '';   // pode ter sido escondido por um modal de detalhe
  salvar.setAttribute('onclick', `cadSalvar('${tabela}',${editando ? `'${r.id}'` : 'null'})`);
  document.getElementById('modal-cadastro').classList.add('show');
}

export function cadNovo(tabela) { abrirForm(tabela, null); }
export function cadEditar(tabela, id) {
  const reg = (cadastroCache[tabela] || []).find(x => String(x.id) === String(id));
  abrirForm(tabela, reg);
}

export async function cadSalvar(tabela, id) {
  const cfg = CFG[tabela];
  const payload = {};
  for (const f of cfg.campos) {
    const elf = document.getElementById('cad-f-' + f.key);
    if (!elf) continue;
    if (f.type === 'bool') payload[f.key] = elf.checked;
    else if (f.type === 'number') payload[f.key] = elf.value.trim() === '' ? null : Number(elf.value);
    else payload[f.key] = elf.value.trim() || null;
  }
  // == null (e não !valor): 0 é válido em campos numéricos (ex.: faixa "De R$ 0")
  const obrig = cfg.campos.find(f => f.required && (payload[f.key] == null || payload[f.key] === ''));
  if (obrig) { toast(obrig.label + ' é obrigatório'); return; }
  if (cfg.validar) {
    const errMsg = cfg.validar(payload);
    if (errMsg) { toast(errMsg); return; }
  }

  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true;
  const q = id ? sb.from(tabela).update(payload).eq('id', id) : sb.from(tabela).insert(payload);
  const { error } = await q;
  btn.disabled = false;
  if (error) {
    if (/duplicate key|unique/i.test(error.message || '')) { toast('Já existe um registro com esse nome.'); return; }
    if (await handleSupabaseError(error, 'Erro ao salvar')) return;
    toast('Erro ao salvar'); return;
  }
  toast('Salvo!');
  document.getElementById('modal-cadastro').classList.remove('show');
  await carregar(tabela);
  // Avisa telas abertas (ex.: form de produto) para atualizarem seus selects.
  window.dispatchEvent(new CustomEvent('cadastro-salvo', { detail: { tabela } }));
}

export function cadExcluir(tabela, id) {
  const cfg = CFG[tabela];
  const reg = (cadastroCache[tabela] || []).find(x => String(x.id) === String(id));
  confirmarAcao('Excluir ' + cfg.singular,
    `Excluir "${reg?.nome || ''}"? Isso não pode ser desfeito.`, 'Excluir', async () => {
      const { error } = await sb.from(tabela).delete().eq('id', id);
      if (error) {
        if (/foreign key|violates/i.test(error.message || '')) {
          toast('Não dá para excluir: há produtos usando este registro.'); return;
        }
        if (await handleSupabaseError(error, 'Erro ao excluir')) return;
        toast('Erro ao excluir'); return;
      }
      toast('Excluído.');
      carregar(tabela);
    });
}

// Loaders chamados pela navegação (showPanel).
export function loadCategorias()      { carregar('categorias'); }
export function loadColecoes()        { carregar('colecoes'); }
export function loadFornecedores()    { carregar('fornecedores'); }
export function loadFaixasComissao()  { carregar('faixas_comissao'); }
export function loadConfigRaspadinha() { carregar('config_raspadinha'); }
export function loadFormasPagamento() { carregar('formas_pagamento'); }
export function loadCategoriasFinanceiras() { carregar('categorias_financeiras'); }

// Carrega os 3 cadastros para alimentar selects do produto (uma vez por abertura).
export async function carregarCadastrosParaSelect() {
  const [c1, c2, c3] = await Promise.all([
    sbQ(sb.from('categorias').select('*').order('nome')), // * = inclui banho_padrao (0015)
    sbQ(sb.from('colecoes').select('id,nome,ativo').order('nome')),
    sbQ(sb.from('fornecedores').select('*').order('nome')), // * = inclui desconto quando a 0013 existir
  ]);
  cadastroCache.categorias   = c1.data || [];
  cadastroCache.colecoes     = c2.data || [];
  cadastroCache.fornecedores = c3.data || [];
}
