// Estado compartilhado entre modulos. Sempre MUTAR as propriedades (state.x = ...),
// nunca reatribuir o objeto inteiro — assim todos os modulos enxergam o mesmo valor.
export const state = {
  recoveryAtiva: false,
  currentUser: null,
  currentProfile: null,
  allGarantias: [],
  allConsignados: [],
  allVendas: [],
  vendaItensCache: {},
  revNameMap: {},
  revBlingMap: {},
  avisosSync: [],           // maleta_sync_avisos não resolvidos (admin) — ver migration 0062
  revTesteSet: new Set(),   // ids de revendedoras TESTE (fora de faturamento/estoque)
  gFilter: 'todas',
  gSort: { col: 'prazo_maximo', dir: 'asc' },
  pFilter: 'todos',
  cSort: { col: 'ordem', dir: 'asc' },   // ordem de lançamento (pedido da equipe) — ver migration 0060
  cicloRevSelecionada: null,
  cicloSoVendidos: false,
  cicloSoNaoVendidos: false,  // exclusivo com cicloSoVendidos
  maletaAtivaId: null,       // revendedora: id da maleta 'ativa' (catálogo só mostra ela)
  historicoCicloSel: null,
  carrinhoVenda: [],
  vendaPagamentos: [],        // [{forma, valor}] — rateio do modal de venda (0051)
  solicitacoesTroca: [],      // staff: pedidos de remarcação pendentes (0053)
  minhaTroca: null,           // revendedora: { maleta, solicitacao } da própria troca (0053)
  clienteVoltarPara: null,    // hash de origem da tela #/cliente/:id (botao Voltar)
  vendaClienteId: null,       // cliente encontrada pelo autocomplete de telefone (PDV)
  posVendaCtx: null,          // contexto do modal pós-venda (fidelidade + garantia)
  blingRevs: [],
  blingItensAtual: [],
  blingPedidosCache: [],
  blingFiltro: '',
  proximaTrocaMap: {},
  maletasTrocaMap: {}, // { revendedora_id: data_troca (ISO) } das maletas ativas do app
  proximaTrocaCarregado: false,
  proximaTrocaPromessa: null,
  ordemTrocaProxima: false,
  aprovadasCache: [],
  historicoExpandido: null,
  trocasFiltroAtivo: 'todas',
  maletaCtx: { revId: null, nome: '', pedidoNumero: null, pedidos: {}, itensRpc: [] },
  _confirmaCb: null,
};
