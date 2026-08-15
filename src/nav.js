// Navegacao entre paineis, agora dirigida pelo HASH da URL (router.js) para
// que o botao "voltar" do navegador funcione. showPanel() continua sendo a
// API publica usada em todo o app: ele apenas empurra o hash; o hashchange
// resolve e chama o executor real (aplicarTela) com os guards de sempre.
// Loaders/papeis sao chamados via window (cross-module), como antes.
import { state } from './state.js';
import { registrar, navegar, iniciar } from './router.js';

// 'fidelidade' NÃO está aqui de propósito: a revendedora também acessa (a RLS
// filtra as clientes dela). O acesso do staff continua controlado pela permissão
// do menu (marketing_fidelidade), via podeAcessarPanel.
export const PANEIS_STAFF = ['financeiro','contas-a-pagar','calculadora','clientes','bonus','funcionarios','perfis','formas-pagamento','categorias-financeiras','produtos','categorias','colecoes','fornecedores','faixas-comissao','config-raspadinha','precificacao','entrada-mercadoria','lancador','etiquetas-config','nuvemshop'];

// hash "bonito" p/ dashboard e revendedoras; demais = proprio nome do painel.
function hashDePanel(name) {
  if (name === 'dashboard') return '/';
  if (name === 'admin') return '/revendedoras';
  return '/' + name;
}

// Guards de papel/permissao: devolve o painel EFETIVO (ou 'dashboard').
function panelPermitido(name) {
  if (name === 'trocas' && !ehStaff()) return 'dashboard';
  // Inverso do 'trocas': a agenda pessoal é da revendedora. Sem isto o staff
  // chegaria por URL — e o guard de permissão abaixo não pega, porque
  // podeAcessarPanel devolve true para painel fora do MENU.
  if (name === 'proxima-troca' && ehStaff()) return 'dashboard';
  // Mesma ideia: "Minhas Clientes" é a agenda da revendedora. O staff tem a
  // tela Clientes (cad_clientes), que mostra a base inteira.
  if (name === 'minhas-clientes' && ehStaff()) return 'dashboard';
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
  ['dashboard','garantias','consignados','pagamentos','historico','trocas','admin','fidelidade','proxima-troca','cliente-compras','minhas-clientes', ...PANEIS_STAFF].forEach(p => {
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
  atualizarBreadcrumb(name);   // breadcrumb da topbar (global, menu.js)
  drawerSincronizar(name);     // item ativo + grupo aberto na gaveta (revendedora)

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
  if (name === 'etiquetas-config') loadEtiquetasConfig();
  if (name === 'nuvemshop') loadNuvemshop();
  if (name === 'config-raspadinha') loadConfigRaspadinha();
  if (name === 'precificacao') loadPrecificacao();
  if (name === 'entrada-mercadoria') loadEntradaMercadoria();
  if (name === 'fidelidade') loadFidelidade();
  if (name === 'proxima-troca') loadProximaTroca();
  if (name === 'minhas-clientes') loadMinhasClientes();
  if (name === 'bonus') loadBonus();
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

// Tela da cliente final como rota propria (#/cliente/:id). Os dois papeis
// acessam: o proprio loader escopa as compras (staff ve todas, revendedora so
// as dela) e recusa a cliente sem vinculo — por isso nao entra em PANEIS_STAFF.
function irParaCliente(id) {
  if (!state.currentUser) return;
  aplicarTela('cliente-compras');
  loadClienteCompras(id);   // global (cliente-compras.js)
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

// Abrir a tela de uma cliente final (compras + fidelidade). Usada pela
// Fidelidade, pelo CRUD de Clientes e por Minhas Clientes.
// Guarda de onde veio: history.back() sozinho nao serve, porque history.length
// conta a aba INTEIRA — abrir o app direto em #/cliente/:id e clicar Voltar
// sairia do app e deixaria a tela em branco (pior ainda no PWA standalone).
export function abrirCliente(id) {
  const atual = location.hash.slice(1);
  state.clienteVoltarPara = (atual && !atual.startsWith('/cliente/')) ? atual : null;
  navegar('/cliente/' + encodeURIComponent(id));
}

// Para onde o botao Voltar da tela da cliente leva. Sem origem conhecida
// (link direto, F5), cai na tela que faz sentido para o papel.
export function voltarDaCliente() {
  const destino = state.clienteVoltarPara;
  state.clienteVoltarPara = null;
  if (destino) { navegar(destino, { replace: true }); return; }
  navegar(hashDePanel(ehStaff() ? 'clientes' : 'minhas-clientes'), { replace: true });
}

// Registra as rotas e liga o router. Chamado no login (usuario ja carregado).
export function iniciarRoteamento() {
  registrar('/', () => irPara(panelInicial()));
  registrar('/revendedoras', () => irPara('admin'));
  registrar('/revendedoras/:id', ({ id }) => irParaDetalheRev(id));
  registrar('/cliente/:id', ({ id }) => irParaCliente(id));
  registrar('/:panel', ({ panel }) => irPara(panel));
  iniciar();
}

// Mantido por compatibilidade (grupo Cadastros gerado pelo renderSidebar).
export function toggleCadastros() {
  const g = document.getElementById('snav-grp_cadastros');
  if (g) g.classList.toggle('collapsed');
}
