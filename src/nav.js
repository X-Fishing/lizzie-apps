// Navegacao entre paineis. Chama loaders/papeis via window (cross-module).
export const PANEIS_STAFF = ['financeiro','calculadora','clientes','marketing','funcionarios','formas-pagamento','categorias-financeiras','produtos','categorias','colecoes','fornecedores','lancador'];

export function showPanel(name) {
  if (name === 'trocas' && !ehStaff()) name = 'dashboard';
  if (name === 'admin' && !ehGestor()) name = 'dashboard';
  if (PANEIS_STAFF.includes(name) && !ehStaff()) name = 'dashboard';
  ['dashboard','garantias','consignados','pagamentos','historico','trocas','admin', ...PANEIS_STAFF].forEach(p => {
    document.getElementById('panel-' + p).style.display = p === name ? 'block' : 'none';
    const nav = document.getElementById('nav-' + p);
    if (nav) nav.classList.toggle('active', p === name);
  });
  // Sincroniza o estado ativo na barra lateral do dashboard PC.
  document.querySelectorAll('.staff-nav [data-panel]').forEach(b =>
    b.classList.toggle('active', b.dataset.panel === name));

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
  if (name === 'lancador') loadLancador();
}

export function toggleCadastros() {
  document.getElementById('snav-cadastros').classList.toggle('collapsed');
}
