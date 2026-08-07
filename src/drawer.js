// Menu gaveta do app da REVENDEDORA (design "Lizzie Mobile Revendedora").
// Substitui a nav inferior só para ela — o staff continua na nav/sidebar, que
// é gerada por menu.js a partir das permissões.
//
// A sincronização do item ativo é chamada por nav.js (aplicarTela), o mesmo
// ponto que já acende o botão da nav inferior: assim voltar pelo navegador,
// link direto (#/pagamentos) e clique no menu terminam no mesmo estado.
import { showPanel } from './nav.js';

// Cada grupo declara quais painéis moram dentro dele, para o grupo da tela
// ativa abrir sozinho (senão a pessoa abre o menu e não vê onde está).
const GRUPOS = {
  maleta: ['consignados', 'garantias', 'proxima-troca'],
  vendas: ['pagamentos', 'historico', 'fidelidade'],
};

const el = id => document.getElementById(id);

export function openDrawer() {
  el('drawer')?.classList.add('show');
  el('drawer-overlay')?.classList.add('show');
  // Trava o scroll do fundo enquanto a gaveta está aberta.
  document.body.style.overflow = 'hidden';
}

export function closeDrawer() {
  el('drawer')?.classList.remove('show');
  el('drawer-overlay')?.classList.remove('show');
  document.body.style.overflow = '';
}

export function toggleDrawer() {
  if (el('drawer')?.classList.contains('show')) closeDrawer(); else openDrawer();
}

export function drawerToggleGrupo(nome) {
  const sub = el('drawer-sub-' + nome);
  const grp = el('drawer-grp-' + nome);
  if (!sub || !grp) return;
  const aberto = sub.classList.toggle('show');
  grp.setAttribute('aria-expanded', String(aberto));
}

// Navegar sempre fecha a gaveta: no celular ela cobre a tela toda.
export function drawerIr(panel) {
  closeDrawer();
  showPanel(panel);
}

// Acende o item da tela atual e abre o grupo que o contém. Chamado por
// aplicarTela() a cada troca de painel.
export function drawerSincronizar(panel) {
  document.querySelectorAll('[data-drawer-panel]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-drawer-panel') === panel));

  for (const [nome, paineis] of Object.entries(GRUPOS)) {
    if (!paineis.includes(panel)) continue;
    el('drawer-sub-' + nome)?.classList.add('show');
    el('drawer-grp-' + nome)?.setAttribute('aria-expanded', 'true');
  }
}

// Liga a gaveta para a revendedora (chamado em auth.js/montarAppUI).
export function ativarDrawer() {
  el('app')?.classList.add('rev-drawer');
  const b = el('btn-drawer');
  if (b) b.style.display = '';
  // Estado inicial do design: "Minha Maleta" aberto, "Vendas" recolhido.
  el('drawer-sub-maleta')?.classList.add('show');
}
