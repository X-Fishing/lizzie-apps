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
  revTesteSet: new Set(),   // ids de revendedoras TESTE (fora de faturamento/estoque)
  gFilter: 'todas',
  gSort: { col: 'prazo_maximo', dir: 'asc' },
  pFilter: 'todos',
  cSort: { col: 'descricao', dir: 'asc' },
  cicloRevSelecionada: null,
  cicloSoVendidos: false,
  cicloSoNaoVendidos: false,  // exclusivo com cicloSoVendidos
  maletaAtivaId: null,       // revendedora: id da maleta 'ativa' (catálogo só mostra ela)
  historicoCicloSel: null,
  carrinhoVenda: [],
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
