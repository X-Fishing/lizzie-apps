// Navegacao entre paineis. Chama loaders/papeis via window (cross-module).
export const PANEIS_STAFF = ['financeiro','calculadora','clientes','marketing','funcionarios','formas-pagamento','categorias-financeiras','produtos','categorias','colecoes','fornecedores','faixas-comissao','precificacao','entrada-mercadoria','lancador'];

export function showPanel(name) {
  if (name === 'trocas' && !ehStaff()) name = 'dashboard';
  if (name === 'admin' && !ehGestor()) name = 'dashboard';
  if (PANEIS_STAFF.includes(name) && !ehStaff()) name = 'dashboard';
  // Guarda por perfil (staff): sem a chave do menu, volta pro dashboard.
  if (name !== 'dashboard' && ehStaff() && !podeAcessarPanel(name)) {
    toast('Você não tem acesso a essa área.');
    name = 'dashboard';
  }
  ['dashboard','garantias','consignados','pagamentos','historico','trocas','admin', ...PANEIS_STAFF].forEach(p => {
    document.getElementById('panel-' + p).style.display = p === name ? 'block' : 'none';
    const nav = document.getElementById('nav-' + p);
    if (nav) nav.classList.toggle('active', p === name);
  });
  // Sincroniza o estado ativo na barra lateral do dashboard PC.
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
  if (name === 'calculadora') loadCalculadora();
  if (name === 'clientes') loadClientes();
  if (name === 'marketing') loadMarketing();
  if (name === 'funcionarios') loadFuncionarios();
  if (name === 'formas-pagamento') loadFormasPagamento();
  if (name === 'categorias-financeiras') loadCategoriasFinanceiras();
  if (name === 'produtos') loadProdutos();
  if (name === 'categorias') loadCategorias();
  if (name === 'colecoes') loadColecoes();
  if (name === 'fornecedores') loadFornecedores();
  if (name === 'faixas-comissao') loadFaixasComissao();
  if (name === 'precificacao') loadPrecificacao();
  if (name === 'entrada-mercadoria') loadEntradaMercadoria();
  if (name === 'lancador') loadLancador();
}

// Mantido por compatibilidade (grupo Cadastros gerado pelo renderSidebar).
export function toggleCadastros() {
  const g = document.getElementById('snav-grp_cadastros');
  if (g) g.classList.toggle('collapsed');
}
