// Cadastros base (staff/gestor): Categorias, Coleções e Fornecedores.
// Engine genérico CRUD inline (lista + formulário no próprio painel), no
// padrão visual do app. Só gestor/admin grava (RLS reforça no banco).
import { sb } from './supabase.js';
import { esc, toast, sbQ, confirmarAcao, handleSupabaseError } from './utils.js';

// ── ícones de linha reutilizados (mesma família Lucide do app) ──
const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_EMPTY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';

// ── Configuração de cada cadastro ──────────────────────────────────────
const CFG = {
  categorias: {
    panel: 'categorias', titulo: 'Categorias', singular: 'categoria',
    order: 'nome',
    campos: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome'],
  },
  colecoes: {
    panel: 'colecoes', titulo: 'Coleções', singular: 'coleção',
    order: 'nome',
    campos: [
      { key: 'nome', label: 'Nome', type: 'text', required: true },
      { key: 'ano',  label: 'Ano', type: 'number' },
      { key: 'ativo', label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'ano'],
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
      { key: 'observacao', label: 'Observação', type: 'textarea' },
      { key: 'ativo',      label: 'Ativo', type: 'bool', default: true },
    ],
    colunas: ['nome', 'telefone', 'contato'],
  },
};

const LABEL_COL = {
  nome: 'Nome', ano: 'Ano', telefone: 'Telefone', contato: 'Contato',
};

// Cache simples para alimentar os <select> do cadastro de produto.
export const cadastroCache = { categorias: [], colecoes: [], fornecedores: [] };

function panelEl(tabela) { return document.getElementById('panel-' + CFG[tabela].panel); }

// ── Carrega e renderiza a lista ─────────────────────────────────────────
async function carregar(tabela) {
  const cfg = CFG[tabela];
  const el = panelEl(tabela);
  el.innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';
  const { data, error } = await sbQ(sb.from(tabela).select('*').order(cfg.order, { ascending: true }));
  if (error) { if (await handleSupabaseError(error, 'Erro ao carregar ' + cfg.titulo)) return; }
  cadastroCache[tabela] = data || [];
  render(tabela, data || []);
}

function render(tabela, linhas) {
  const cfg = CFG[tabela];
  const cols = cfg.colunas;
  const thead = cols.map(c => `<th class="pag-th">${LABEL_COL[c] || c}</th>`).join('') +
    '<th class="pag-th" style="text-align:right">Ações</th>';
  const rows = linhas.length ? linhas.map(it => `
    <tr class="ciclo-row">
      ${cols.map((c, i) => `<td class="ciclo-td">${i === 0
        ? `<span class="ciclo-desc">${esc(it[c] ?? '—')}</span>${it.ativo === false ? ' <span class="badge badge-aberta" style="font-size:10px">inativo</span>' : ''}`
        : esc(it[c] ?? '—')}</td>`).join('')}
      <td class="ciclo-td" style="text-align:right;white-space:nowrap">
        <button class="btn-icon" title="Editar" onclick="cadEditar('${tabela}','${it.id}')">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="cadExcluir('${tabela}','${it.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="${cols.length + 1}"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhum registro ainda</p></div></td></tr>`;

  panelEl(tabela).innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <div class="section-title">${cfg.titulo}</div>
        <div class="section-subtitle">${linhas.length} registro${linhas.length !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn-primary btn-sm" onclick="cadNovo('${tabela}')">${IC_PLUS} Novo</button>
    </div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
    const inputType = f.type === 'number' ? 'number' : 'text';
    return `<div class="form-group"><label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
      <input type="${inputType}" id="cad-f-${f.key}" class="form-control" value="${esc(val)}"></div>`;
  }).join('');

  document.getElementById('cad-modal-titulo').textContent =
    (editando ? 'Editar ' : 'Nova ') + cfg.singular;
  document.getElementById('cad-modal-body').innerHTML = campos;
  document.getElementById('cad-modal-salvar').setAttribute(
    'onclick', `cadSalvar('${tabela}',${editando ? `'${r.id}'` : 'null'})`);
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
  const obrig = cfg.campos.find(f => f.required && !payload[f.key]);
  if (obrig) { toast(obrig.label + ' é obrigatório'); return; }

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
export function loadCategorias()   { carregar('categorias'); }
export function loadColecoes()     { carregar('colecoes'); }
export function loadFornecedores() { carregar('fornecedores'); }

// Carrega os 3 cadastros para alimentar selects do produto (uma vez por abertura).
export async function carregarCadastrosParaSelect() {
  const [c1, c2, c3] = await Promise.all([
    sbQ(sb.from('categorias').select('id,nome,ativo').order('nome')),
    sbQ(sb.from('colecoes').select('id,nome,ativo').order('nome')),
    sbQ(sb.from('fornecedores').select('id,nome,ativo').order('nome')),
  ]);
  cadastroCache.categorias   = c1.data || [];
  cadastroCache.colecoes     = c2.data || [];
  cadastroCache.fornecedores = c3.data || [];
}
