// Menu lateral (dashboard PC / staff) — registry declarativo + permissões.
// A `chave` de cada item é a mesma gravada em perfil_permissoes.chave_menu.
// Granularidade "só-ver-menu": a permissão decide se o funcionário ENXERGA
// o item; as ações internas ficam liberadas para quem tem acesso.
import { sb } from './supabase.js';
import { state } from './state.js';
import { sbQ } from './utils.js';
import { ehAdmin, ehStaff } from './auth.js';

// ── ícones (mesma família Lucide já usada no app) ──────────────────
const IC = {
  grid:      '<svg class="ico" viewBox="0 0 24 24"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
  bag:       '<svg class="ico" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  gem:       '<svg class="ico" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>',
  columns:   '<svg class="ico" viewBox="0 0 24 24"><path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/></svg>',
  repeat:    '<svg class="ico" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  fin:       '<svg class="ico" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  calc:      '<svg class="ico" viewBox="0 0 24 24"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>',
  mega:      '<svg class="ico" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  tag:       '<svg class="ico" viewBox="0 0 24 24"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  layers:    '<svg class="ico" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
  fabrica:   '<svg class="ico" viewBox="0 0 24 24"><path d="M5 7 3 5"/><path d="M9 6V3h6v3"/><rect width="18" height="12" x="3" y="7" rx="2"/><path d="M3 13h18"/></svg>',
  users:     '<svg class="ico" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  userCheck: '<svg class="ico" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
  shield:    '<svg class="ico" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  crachaFunc:'<svg class="ico" viewBox="0 0 24 24"><path d="M16 2v2"/><path d="M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><path d="M8 2v2"/><circle cx="12" cy="11" r="3"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>',
  card:      '<svg class="ico" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
  percent:   '<svg class="ico" viewBox="0 0 24 24"><line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  cart:      '<svg class="ico" viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
  package:   '<svg class="ico" viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  gift:      '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
};

// ── Registry (fonte única do menu lateral) ─────────────────────────
// `panel` é o nome usado pelo showPanel() existente; `chave` é a
// permissão gravada no banco.
// IMPORTANTE: a `chave` de cada item é a permissão gravada no banco
// (perfil_permissoes.chave_menu). Ao MOVER um item de grupo, a chave viaja
// junto SEM mudar — senão os perfis perdem o acesso àquela tela.
export const MENU = [
  { chave: 'dashboard', panel: 'dashboard', label: 'Dashboard', icon: IC.grid },
  { grupo: 'grp_vendas', label: 'Vendas', icon: IC.bag, filhos: [
      { chave: 'vendas_controle',  panel: 'consignados', label: 'Controle de Vendas',  icon: IC.gem },
      { chave: 'cad_revendedoras', panel: 'admin',       label: 'Revendedoras',        icon: IC.userCheck },
      { chave: 'cad_clientes',     panel: 'clientes',    label: 'Clientes',            icon: IC.users, em_breve: true },
      { chave: 'vendas_lancar',    panel: 'lancador',    label: 'Lançar Mostruário',   icon: IC.columns },
      { chave: 'vendas_troca',     panel: 'trocas',      label: 'Troca de Mostruário', icon: IC.repeat },
      // chave 'cad_garantias' mantida: perfis existentes seguem valendo
      { chave: 'cad_garantias',    panel: 'garantias',   label: 'Garantias',           icon: IC.shield },
  ]},
  { grupo: 'grp_estoque', label: 'Estoque', icon: IC.package, filhos: [
      { chave: 'cad_fornecedores', panel: 'fornecedores', label: 'Fornecedores', icon: IC.fabrica },
      { chave: 'vendas_produtos',  panel: 'produtos',     label: 'Produtos',     icon: IC.gem },
      { chave: 'cad_categorias',   panel: 'categorias',   label: 'Categorias',   icon: IC.tag },
      { chave: 'cad_colecoes',     panel: 'colecoes',     label: 'Coleções',     icon: IC.layers },
      // chave 'vendas_entrada_mercadoria' mantida (só mudou de grupo)
      { chave: 'vendas_entrada_mercadoria', panel: 'entrada-mercadoria', label: 'Entrada de Mercadoria', icon: IC.cart },
      { chave: 'cad_precificacao', panel: 'precificacao', label: 'Precificação', icon: IC.percent },
      { chave: 'calculadora',      panel: 'calculadora',  label: 'Calculadora',  icon: IC.calc },
  ]},
  { grupo: 'grp_financeiro', label: 'Financeiro', icon: IC.fin, filhos: [
      // chave 'financeiro' mantida (item solto virou "Lançamentos" dentro do grupo)
      { chave: 'financeiro',           panel: 'financeiro',             label: 'Lançamentos',            icon: IC.fin },
      { chave: 'cad_formas_pagamento', panel: 'formas-pagamento',       label: 'Formas de Pagamento',    icon: IC.card, em_breve: true },
      { chave: 'cad_categorias_fin',   panel: 'categorias-financeiras', label: 'Categorias Financeiras', icon: IC.tag, em_breve: true },
  ]},
  { grupo: 'grp_marketing', label: 'Marketing', icon: IC.mega, filhos: [
      { chave: 'cad_raspadinha',  panel: 'config-raspadinha', label: 'Raspadinha', icon: IC.tag, admin_only: true },
      { chave: 'marketing_bonus', panel: 'bonus',             label: 'Bônus',      icon: IC.gift, em_breve: true },
  ]},
  { secao: 'Configurações', grupo: 'grp_cadastros', filhos: [
      { chave: 'cad_funcionarios',    panel: 'funcionarios',    label: 'Funcionários',        icon: IC.crachaFunc, admin_only: true },
      { chave: 'cad_perfis',          panel: 'perfis',          label: 'Perfis & Permissões', icon: IC.shield, admin_only: true },
      { chave: 'cad_faixas_comissao', panel: 'faixas-comissao', label: 'Faixas de Comissão',  icon: IC.percent },
  ]},
];

// Ações especiais: permissões que NÃO são itens de menu (aparecem num
// grupo próprio no checklist de perfis). Checagem: IS_ADMIN || PERMISSOES.has(chave).
export const ACOES = [
  { chave: 'acao_editar_maleta_finalizada', label: 'Editar/corrigir maleta finalizada' },
  { chave: 'acao_estornar_recebimento',     label: 'Estornar recebimento (financeiro)' },
];

function todosItens() {
  return MENU.flatMap(m => m.filhos ? m.filhos : [m]);
}
export function todasChaves() { return [...todosItens().map(i => i.chave), ...ACOES.map(a => a.chave)]; }

// ── Permissões (carregadas 1x no login, mantidas em memória) ───────
export let PERMISSOES = new Set();
export let IS_ADMIN = false;

export async function carregarPermissoes() {
  IS_ADMIN = ehAdmin();          // admin por profiles.role continua admin
  PERMISSOES = new Set();
  if (!ehStaff()) return;        // revendedora não usa a sidebar staff
  // Vincula o funcionário (criado por e-mail) ao usuário logado.
  await sbQ(sb.rpc('fn_vincular_funcionario'));
  const uid = state.currentUser.id;
  const { data: eu, error } = await sbQ(sb.from('funcionarios')
    .select('is_admin, perfil_id').eq('auth_user_id', uid).maybeSingle());
  if (!error && eu) {
    IS_ADMIN = IS_ADMIN || !!eu.is_admin;
    const { data } = await sbQ(sb.rpc('fn_minhas_permissoes'));
    PERMISSOES = new Set((data || []).map(r => r.chave_menu));
  } else {
    // Legado / SQL ainda não rodado: staff sem registro em funcionarios
    // mantém o acesso atual (tudo), para não quebrar quem já usa.
    PERMISSOES = new Set(todasChaves());
  }
}

export function podeVer(item) {
  if (item.admin_only && !IS_ADMIN) return false;
  return IS_ADMIN || PERMISSOES.has(item.chave);
}

// Painel inicial pós-login (staff): o PRIMEIRO item do menu que a pessoa
// pode ver, respeitando perfil_permissoes e pulando "Em breve". Evita que
// um funcionário parcial caia na dashboard (financeiro/DRE) sem permissão.
// Admin e quem tem a chave 'dashboard' continuam caindo na dashboard.
export function primeiroPanelInicial() {
  if (IS_ADMIN) return 'dashboard';
  for (const item of todosItens()) {
    if (item.em_breve || !item.panel) continue;
    if (podeVer(item)) return item.panel;
  }
  return 'dashboard';
}

// Guarda de navegação: painéis fora do registry (garantias mobile,
// pagamentos, histórico...) passam direto.
export function podeAcessarPanel(panel) {
  const item = todosItens().find(i => i.panel === panel);
  if (!item) return true;
  if (item.em_breve) return false;
  return podeVer(item);
}

// ── Render ─────────────────────────────────────────────────────────
function btnItem(item) {
  if (item.em_breve) {
    return `<button class="snav-item" data-panel="${item.panel}" disabled style="opacity:.55;cursor:default">
      <span class="snav-ic">${item.icon}</span>${item.label}<span class="badge-soon">Em breve</span></button>`;
  }
  return `<button class="snav-item" data-panel="${item.panel}" onclick="showPanel('${item.panel}')">
    <span class="snav-ic">${item.icon}</span>${item.label}</button>`;
}

export function renderSidebar() {
  const el = document.getElementById('snav-menu');
  if (!el) return;
  if (!ehStaff()) { el.innerHTML = ''; return; }
  // restaura o estado recolhido/aberto da sidebar
  try {
    document.getElementById('app').classList.toggle('snav-fechada', localStorage.getItem('lizzie-snav-fechada') === '1');
  } catch { /* ok */ }
  const html = MENU.map(m => {
    if (m.filhos) {
      const filhos = m.filhos.filter(podeVer);
      if (!filhos.length) return '';   // pai/seção some sem filhos visíveis
      const label = m.secao
        ? `<div class="snav-group-label" onclick="toggleSnavGrupo(this)"><span class="snav-caret">▼</span>${m.secao}</div>`
        : `<div class="snav-group-label" onclick="toggleSnavGrupo(this)"><span class="snav-caret">▼</span><span class="snav-ic" style="display:inline-flex;vertical-align:middle;margin-right:5px">${m.icon}</span>${m.label}</div>`;
      return `<div class="snav-group" id="snav-${m.grupo}">${label}<div class="snav-sub">${filhos.map(btnItem).join('')}</div></div>`;
    }
    return podeVer(m) ? btnItem(m) : '';
  }).join('');
  el.innerHTML = html;
}

export function toggleSnavGrupo(elLabel) {
  elLabel.closest('.snav-group').classList.toggle('collapsed');
}

// Sidebar retrátil (estado lembrado entre sessões)
export function toggleSidebarLateral() {
  const app = document.getElementById('app');
  const fechada = app.classList.toggle('snav-fechada');
  try { localStorage.setItem('lizzie-snav-fechada', fechada ? '1' : ''); } catch { /* ok */ }
}
