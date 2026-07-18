// Navegacao entre paineis, agora dirigida pelo HASH da URL (router.js) para
// que o botao "voltar" do navegador funcione. showPanel() continua sendo a
// API publica usada em todo o app: ele apenas empurra o hash; o hashchange
// resolve e chama o executor real (aplicarTela) com os guards de sempre.
// Loaders/papeis sao chamados via window (cross-module), como antes.
import { state } from './state.js';
import { registrar, navegar, iniciar } from './router.js';

export const PANEIS_STAFF = ['financeiro','contas-a-pagar','calculadora','clientes','bonus','funcionarios','perfis','formas-pagamento','categorias-financeiras','produtos','categorias','colecoes','fornecedores','faixas-comissao','config-raspadinha','precificacao','entrada-mercadoria','lancador'];

// hash "bonito" p/ dashboard e revendedoras; demais = proprio nome do painel.
function hashDePanel(name) {
  if (name === 'dashboard') return '/';
  if (name === 'admin') return '/revendedoras';
  return '/' + name;
}

// Guards de papel/permissao: devolve o painel EFETIVO (ou 'dashboard').
function panelPermitido(name) {
  if (name === 'trocas' && !ehStaff()) return 'dashboard';
  if (name === 'admin' && !ehGestor()) return 'dashboard';
  if (PANEIS_STAFF.includes(name) && !ehStaff()) return 'dashboard';
  if (name !== 'dashboard' && ehStaff() && !podeAcessarPanel(name)) {
    toast('Você não tem acesso a essa área.');
    return 'dashboard';
  }
  return name;
}

// Executor real: troca os paineis, sincroniza o menu ativo e dispara o loader.
function aplicarTela(name) {
  ['dashboard','garantias','consignados','pagamentos','historico','trocas','admin', ...PANEIS_STAFF].forEach(p => {
    const el = document.getElementById('panel-' + p);
    if (el) el.style.display = p === name ? 'block' : 'none';
    const nav = document.getElementById('nav-' + p);
    if (nav) nav.classList.toggle('active', p === name);
  });
  // Estado ativo na barra lateral do dashboard PC.
  document.querySelectorAll('.staff-nav [data-panel]').forEach(b =>
    b.classList.toggle('active', b.dataset.panel === name));
  // Entrada de Mercadoria usa a largura total da tela (grade larga).
  document.querySelector('.content')?.classList.toggle('tela-full', name === 'entrada-mercadoria');

  if (name === 'dashboard') loadDashboard();
  if (name === 'garantias') loadGarantias();
  if (name === 'consignados') loadConsignados();
  if (name === 'pagamentos') loadVendas();
  if (name === 'historico') loadHistorico();
  if (name === 'trocas') loadTrocasDashboard();
  if (name === 'admin') loadAdmin();
  if (name === 'financeiro') loadFinanceiro();
  if (name === 'contas-a-pagar') loadContasAPagar();
  if (name === 'calculadora') loadCalculadora();
  if (name === 'clientes') loadClientes();
  if (name === 'marketing') loadMarketing();
  if (name === 'funcionarios') loadFuncionarios();
  if (name === 'perfis') loadPerfis();
  if (name === 'formas-pagamento') loadFormasPagamento();
  if (name === 'categorias-financeiras') loadCategoriasFinanceiras();
  if (name === 'produtos') loadProdutos();
  if (name === 'categorias') loadCategorias();
  if (name === 'colecoes') loadColecoes();
  if (name === 'fornecedores') loadFornecedores();
  if (name === 'faixas-comissao') loadFaixasComissao();
  if (name === 'config-raspadinha') loadConfigRaspadinha();
  if (name === 'precificacao') loadPrecificacao();
  if (name === 'entrada-mercadoria') loadEntradaMercadoria();
  if (name === 'lancador') loadLancador();
  window.scrollTo(0, 0);
}

// Renderiza um painel a partir de uma rota (aplica guards; corrige o hash
// se o guard mudou o destino, sem poluir o historico).
function irPara(panel) {
  if (!state.currentUser) return;   // ainda no splash/login: nao renderiza nada
  const efetivo = panelPermitido(panel);
  if (efetivo !== panel) { navegar(hashDePanel(efetivo), { replace: true }); return; }
  aplicarTela(efetivo);
}

// Detalhe/edicao de revendedora como rota propria (#/revendedoras/:id).
function irParaDetalheRev(id) {
  if (!state.currentUser) return;
  if (panelPermitido('admin') !== 'admin') { navegar('/', { replace: true }); return; }
  aplicarTela('admin');   // garante o painel visivel
  abrirFormRev(id);       // global (admin.js) — renderiza o form dentro dele
}

// Painel inicial pos-login quando a URL nao aponta uma tela especifica.
function panelInicial() {
  return ehStaff() ? primeiroPanelInicial() : 'dashboard';
}

// ── API publica ────────────────────────────────────────────────────
// showPanel continua o ponto unico de navegacao: empurra o hash e o
// router aplica a tela (criando entrada no historico → "voltar" funciona).
export function showPanel(name) { navegar(hashDePanel(name)); }

// Abrir o detalhe de uma revendedora navegando (o "voltar" fecha o detalhe).
export function abrirRevendedora(id) { navegar('/revendedoras/' + encodeURIComponent(id)); }

// Registra as rotas e liga o router. Chamado no login (usuario ja carregado).
export function iniciarRoteamento() {
  registrar('/', () => irPara(panelInicial()));
  registrar('/revendedoras', () => irPara('admin'));
  registrar('/revendedoras/:id', ({ id }) => irParaDetalheRev(id));
  registrar('/:panel', ({ panel }) => irPara(panel));
  iniciar();
}

// Mantido por compatibilidade (grupo Cadastros gerado pelo renderSidebar).
export function toggleCadastros() {
  const g = document.getElementById('snav-grp_cadastros');
  if (g) g.classList.toggle('collapsed');
}
