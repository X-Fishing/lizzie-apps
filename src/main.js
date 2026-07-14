// ═══════════════════════════════════════════════
// BOOTSTRAP — main.js fino
// ═══════════════════════════════════════════════
// Ponto de entrada (ES module). A logica vive nos modulos src/*.js; aqui so:
//  1) imports;  2) init() (sessao/auth);  3) exposicao no window das funcoes
//     chamadas via on* no HTML;  4) registro de UI base e PWA.
// Seguranca: toda autorizacao e client-side; a real depende de RLS no Postgres
// (RLS-policies.sql). Ao criar tabela nova, habilitar RLS + policies antes de publicar.
import './styles.css';
import { sb, RECOVERY_IN_URL, URL_AUTH_ERROR } from './supabase.js';
import { state } from './state.js';
import { closeModal, openModal, fecharConfirma, hojeBR, maskDateBR, maskMoneyBR, previewFoto, showMsg, toast } from './utils.js';
import { showPanel, toggleCadastros } from './nav.js';
import { mostrarRecovery, ehAdmin, ehGestor, ehStaff, loadUser, maskTelBR, salvarComplemento, showSplash, switchTab, fazerLogin, mostrarRecuperar, voltarLogin, loginGoogle, enviarLinkRecuperacao, salvarNovaSenha, fazerCadastro } from './auth.js';
import { loadDashboard, loadCalculadora, loadClientes, loadMarketing, loadFormasPagamento, loadCategoriasFinanceiras } from './dashboard.js';
import { loadFinanceiro, abrirRecebimento, registrarRecebimento, recRecalc, recAtalho, copiarPixCola, pixConfigAbrir, pixConfigSalvar, zapCobranca, estornarRecebimento, estornarConfirmar } from './financeiro.js';
import { podeAcessarPanel, renderSidebar, toggleSnavGrupo } from './menu.js';
import { loadFuncionarios, funcTab, funcNovo, funcEditar, funcSalvar, funcUpdate, funcExcluir, perfilNovo, perfilEditar, perfilSalvar, perfilExcluir, perfilAbrir, perfilSalvarPermissoes } from './funcionarios.js';
import { calcPrazoGarantia, loadGarantias, filtrarGarantias, sortGarantiasStaff, setGFilter, renderGarantiaCard, verGarantia, openNovaGarantia, editarGarantia, salvarGarantia, mudarStatus, atualizarStatusCard, excluirGarantia } from './garantias.js';
import { openBlingSync, buscarBling, filtrarBling, verItensBling, voltarListaBling, importarItensBling, atualizarMaleta, previewMaletaPorId, confirmarMaleta, salvarBlingId, detectarBlingId, escolherBlingCandidato } from './bling.js';
import { loadVendas, setPFilter, verVenda, excluirVenda, registrarPagamento } from './pagamentos.js';
import { loadHistorico, filtrarHistorico, toggleHistorico } from './historico.js';
import { loadTrocasDashboard, setTrocaFiltro, toggleOrdemTroca, resolverTroca } from './trocas.js';
import { loadAdmin, renderAprovadas, verRevendedora, aprovarRev, revogarRev, definirPapel, marcarRevTeste, confirmarExclusaoRev, excluirRevendedora } from './admin.js';
import { loadConsignados, sortConsignados, renderCicloGrid, toggleCicloSoVendidos, toggleCicloSoNaoVendidos, abrirConferencia, abrirConferenciaCorrecao, salvarCorrecaoConferencia, renderConferencia, confMarcarDevolvido, confBuscaTeclas, confVerFoto, confComissaoEditada, confComissaoUsarFaixa, lightboxFotoNav, conferirFechamento, finalizarAposConferencia, baixarPdfMostruario, abrirHistoricoCiclo, voltarHistoricoCiclo, abrirCicloRev, voltarCardsCiclo, openBuscaPeca, renderBuscaPeca, finalizarCicloRev, deletarCicloRev, openVenda, atualizarTotalVenda, adicionarAoCarrinho, removerDoCarrinho, abrirFinalizarVenda, ajustarValorPago, confirmarVendaCarrinho, openNovoConsignado, salvarConsignado, openFechamento, gerarPdfFechamento, fecharPrint } from './consignados.js';
import { loadCategorias, loadColecoes, loadFornecedores, loadFaixasComissao, loadConfigRaspadinha, cadNovo, cadEditar, cadSalvar, cadExcluir } from './cadastros.js';
import { perfilAbrirFoto, perfilFecharFoto, perfilTirarSelfie, perfilCapturar, perfilArquivo, perfilSalvarFoto } from './perfil.js';
import { loadProdutos, produtoNovo, produtoEditar, produtoVoltarLista, produtoFiltrar, produtoFiltrarColecao, produtoFiltrarCategoria, produtoFiltrarFornecedor, produtoFiltrarCaracteristica, produtoPagina, produtoToggleGrupo, produtoSalvar, produtoExcluir, produtoToggleVariacao, produtoVarAdicionar, produtoVarRemover, produtoVarSet, produtoNovoFornecedor, maskMoneyProduto, produtoImportarBling, produtoImportBlingPreview, produtoImportBlingRun, produtoImportBlingParar, produtoImgAdd, produtoImgRemover, produtoImgPrincipal, produtoZoomFoto, produtoImportFotos, produtoFotosSelecionar, produtoFotosToggleSubstituir, produtoFotosImportar, produtoCustoEditar, produtoCustoTecla, produtoCustoSalvar, produtoPlanilha, produtoPlanilhaModelo, produtoPlanilhaExportar, produtoPlanilhaArquivo, produtoPlanilhaToggleCriar, produtoPlanilhaAplicar } from './produtos.js';
import { loadLancador, lancadorBipar, lancadorSetQtd, lancadorRemover, lancadorEnviar, lancadorCamera, fecharCamera, scanBarcodeInto, lancadorSelecionarRev, lancadorDestinoNova, lancadorDestinoExistente, lancadorTrocarDestino, lancadorAbrirBusca, lancadorFecharBusca, lancadorBuscaInput, lancadorBuscaTeclas, lancadorBuscaAdicionar } from './lancador.js';
import { abrirDivulgarMaleta, copiarLinkMaleta, mostrarQrMaleta, regenerarLinkMaleta } from './divulgar.js';

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
async function init() {
  // Listener ANTES do getSession para nao perder o evento PASSWORD_RECOVERY.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { mostrarRecovery(); return; }
    if (state.recoveryAtiva) return; // durante a redefinicao, ignora SIGNED_IN/OUT
    // IMPORTANTE: nao usar await/chamadas Supabase direto aqui — isso causa
    // deadlock do lock de auth (login novo travava em "carregando"). Adia com
    // setTimeout(0) para o callback liberar o lock antes de loadUser consultar.
    if (event === 'SIGNED_IN' && session) {
      // O supabase re-dispara SIGNED_IN ao voltar o foco da aba / refresh de token.
      // Se já é o mesmo usuário carregado, NÃO recarrega (senão pula pro dashboard).
      if (state.currentUser && state.currentUser.id === session.user.id) return;
      setTimeout(() => loadUser(session.user), 0);
    }
    if (event === 'SIGNED_OUT') { state.currentUser = null; state.currentProfile = null; showSplash(); }
  });

  const { data: { session } } = await sb.auth.getSession();

  if (URL_AUTH_ERROR) {
    // Link de recuperacao invalido ou expirado: avisa em vez de cair no login mudo.
    history.replaceState(null, '', location.pathname);
    showSplash();
    showMsg(document.getElementById('login-msg'),
      'O link expirou ou já foi usado. Clique em "Esqueci minha senha" para receber um novo.', 'error');
  }
  // Veio pelo link de recuperacao do e-mail: mostra a tela de nova senha,
  // nao entra no app (mesmo que o link tenha criado uma sessao temporaria).
  else if (RECOVERY_IN_URL) { mostrarRecovery(); }
  else if (session) await loadUser(session.user);
  else showSplash();

  document.getElementById('g-entrada').value = hojeBR();
  calcPrazoGarantia();
}

// ═══════════════════════════════════════════════════════════════════
// REGRA GLOBAL DE MODAIS: NÃO fecham por clique fora nem por arraste —
// apenas pelo botão Fechar/X (Esc é atalho opcional). Isso evita perder
// um formulário ao soltar o mouse fora durante uma seleção de texto.
// ═══════════════════════════════════════════════════════════════════

// Fechamento correto por modal (alguns têm teardown próprio).
function fecharModalPadrao(overlay) {
  const id = overlay.id;
  if (id === 'modal-complemento') return;                 // bloqueante de propósito (cadastro obrigatório)
  if (id === 'modal-scanner') { fecharCamera(); return; } // desliga a câmera
  if (id === 'modal-busca-produto') { lancadorFecharBusca(); return; }
  if (id === 'modal-confirma') { fecharConfirma(false); return; }
  overlay.classList.remove('show');
}

// Todo modal ganha um X no canto (injetado aqui para não repetir HTML),
// exceto os que já têm ou os intencionalmente bloqueantes.
document.querySelectorAll('.modal-overlay').forEach(o => {
  if (o.id === 'modal-complemento') return;
  const modal = o.querySelector('.modal');
  if (!modal || modal.querySelector('.modal-close-x')) return;
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'modal-close-x'; x.setAttribute('aria-label', 'Fechar');
  x.textContent = '✕';
  x.addEventListener('click', () => fecharModalPadrao(o));
  modal.prepend(x);
});

// Esc fecha o modal aberto (atalho de teclado não sofre o bug do arraste).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // O lightbox de foto fica por cima de qualquer modal (z-index maior).
  const lightbox = document.querySelector('#lightbox-foto.show');
  if (lightbox) { lightbox.classList.remove('show'); return; }
  const abertos = [...document.querySelectorAll('.modal-overlay.show')];
  const topo = abertos[abertos.length - 1];
  if (topo) fecharModalPadrao(topo);
});

// Expoe no window TODAS as funcoes chamadas via on* no HTML (estatico e gerado),
// pois cada modulo tem escopo proprio (ES modules). Lista derivada dos handlers on*.
Object.assign(window, { renderAprovadas, renderGarantiaCard, ehAdmin, ehStaff, ehGestor, loadDashboard, loadGarantias, loadConsignados, loadVendas, loadHistorico, loadTrocasDashboard, loadAdmin, loadFinanceiro, loadCalculadora, loadClientes, loadMarketing, loadFuncionarios, loadFormasPagamento, loadCategoriasFinanceiras, sb, abrirCicloRev, abrirFinalizarVenda, abrirHistoricoCiclo, adicionarAoCarrinho, ajustarValorPago, aprovarRev, atualizarMaleta, atualizarStatusCard, atualizarTotalVenda, buscarBling, calcPrazoGarantia, closeModal, confirmarExclusaoRev, confirmarMaleta, confirmarVendaCarrinho, definirPapel, marcarRevTeste, deletarCicloRev, detectarBlingId, editarGarantia, enviarLinkRecuperacao, escolherBlingCandidato, excluirGarantia, excluirRevendedora, excluirVenda, fazerCadastro, fazerLogin, fecharConfirma, fecharPrint, filtrarBling, filtrarGarantias, filtrarHistorico, finalizarCicloRev, gerarPdfFechamento, importarItensBling, loginGoogle, maskDateBR, maskMoneyBR, maskTelBR, mostrarRecuperar, mudarStatus, openBlingSync, openBuscaPeca, openFechamento, openNovaGarantia, openNovoConsignado, openVenda, previewFoto, previewMaletaPorId, registrarPagamento, removerDoCarrinho, renderBuscaPeca, renderCicloGrid, revogarRev, salvarBlingId, salvarComplemento, salvarConsignado, salvarGarantia, salvarNovaSenha, setGFilter, setPFilter, setTrocaFiltro, resolverTroca, showPanel, sortConsignados, sortGarantiasStaff, toggleCicloSoVendidos, toggleCicloSoNaoVendidos, abrirConferencia, abrirConferenciaCorrecao, salvarCorrecaoConferencia, renderConferencia, confMarcarDevolvido, confBuscaTeclas, confVerFoto, confComissaoEditada, confComissaoUsarFaixa, lightboxFotoNav, conferirFechamento, finalizarAposConferencia, baixarPdfMostruario, switchTab, toggleCadastros, toggleHistorico, toggleOrdemTroca, verGarantia, verItensBling, verRevendedora, verVenda, voltarCardsCiclo, voltarHistoricoCiclo, voltarListaBling, voltarLogin,
  loadProdutos, produtoNovo, produtoEditar, produtoVoltarLista, produtoFiltrar, produtoFiltrarColecao, produtoFiltrarCategoria, produtoFiltrarFornecedor, produtoFiltrarCaracteristica, produtoPagina, produtoToggleGrupo, produtoSalvar, produtoExcluir, produtoToggleVariacao, produtoVarAdicionar, produtoVarRemover, produtoVarSet, produtoNovoFornecedor, maskMoneyProduto, produtoImportarBling, produtoImportBlingPreview, produtoImportBlingRun, produtoImportBlingParar, produtoImgAdd, produtoImgRemover, produtoImgPrincipal, produtoZoomFoto, produtoImportFotos, produtoFotosSelecionar, produtoFotosToggleSubstituir, produtoFotosImportar, produtoCustoEditar, produtoCustoTecla, produtoCustoSalvar, produtoPlanilha, produtoPlanilhaModelo, produtoPlanilhaExportar, produtoPlanilhaArquivo, produtoPlanilhaToggleCriar, produtoPlanilhaAplicar,
  loadCategorias, loadColecoes, loadFornecedores, loadFaixasComissao, loadConfigRaspadinha, cadNovo, cadEditar, cadSalvar, cadExcluir,
  perfilAbrirFoto, perfilFecharFoto, perfilTirarSelfie, perfilCapturar, perfilArquivo, perfilSalvarFoto,
  toast, podeAcessarPanel, renderSidebar, toggleSnavGrupo,
  abrirRecebimento, registrarRecebimento, recRecalc, recAtalho, copiarPixCola, pixConfigAbrir, pixConfigSalvar, zapCobranca, estornarRecebimento, estornarConfirmar,
  funcTab, funcNovo, funcEditar, funcSalvar, funcUpdate, funcExcluir, perfilNovo, perfilEditar, perfilSalvar, perfilExcluir, perfilAbrir, perfilSalvarPermissoes,
  loadLancador, lancadorBipar, lancadorSetQtd, lancadorRemover, lancadorEnviar, lancadorCamera, fecharCamera, scanBarcodeInto, lancadorSelecionarRev, lancadorDestinoNova, lancadorDestinoExistente, lancadorTrocarDestino, lancadorAbrirBusca, lancadorFecharBusca, lancadorBuscaInput, lancadorBuscaTeclas, lancadorBuscaAdicionar,
  abrirDivulgarMaleta, copiarLinkMaleta, mostrarQrMaleta, regenerarLinkMaleta });

// START
init();

// PWA — botao "Instalar app" + banner iOS. O registro do service worker e feito
// pelo vite-plugin-pwa (registerType: 'autoUpdate').
(function () {
  const installBtn = document.getElementById('install-btn');
  const iosBanner = document.getElementById('ios-install-banner');
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    let deferredPrompt = null;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    const ehMobile = isIOS || isAndroid;

    // "Instalar app" só faz sentido no celular/tablet — no desktop não aparece.
    if (ehMobile) installBtn.classList.add('show');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });

    function abrirInstrucoesInstalar() {
      const el = document.getElementById('install-instrucoes');
      if (isIOS) {
        el.innerHTML = `No iPhone/iPad, use o <b>Safari</b>:<br><br>
          1. Toque no botão <b>Compartilhar</b> (quadradinho com a seta ↑, na barra de baixo)<br>
          2. Role e toque em <b>Adicionar à Tela de Início</b><br>
          3. Toque em <b>Adicionar</b><br><br>
          <span style="color:var(--muted);font-size:12px">Pelo Chrome do iPhone não dá — tem que ser o Safari.</span>`;
      } else if (isAndroid) {
        el.innerHTML = `No Android, use o <b>Chrome</b>:<br><br>
          1. Toque no menu <b>⋮</b> (três pontinhos, canto superior direito)<br>
          2. Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b><br>
          3. Confirme em <b>Instalar</b><br><br>
          <span style="color:var(--muted);font-size:12px">Se você abriu pelo Instagram/WhatsApp, toque em ⋮ → "Abrir no Chrome" antes.</span>`;
      } else {
        el.innerHTML = `No computador, use o <b>Chrome</b> ou <b>Edge</b>:<br><br>
          1. Clique no ícone de <b>instalar</b> (⊕ / monitor) no fim da barra de endereço<br>
          2. Confirme em <b>Instalar</b>`;
      }
      openModal('modal-install');
    }

    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === 'accepted') installBtn.classList.remove('show');
        return;
      }
      // Sem prompt nativo (iOS, navegador embutido, etc.) → instruções por aparelho.
      abrirInstrucoesInstalar();
    });

    window.addEventListener('appinstalled', () => {
      installBtn.classList.remove('show');
      iosBanner.classList.remove('show');
      closeModal('modal-install');
    });

    // Tarja automática no iOS, só na primeira vez.
    if (isIOS && !localStorage.getItem('lizzie-ios-banner-dismissed')) {
      setTimeout(() => iosBanner.classList.add('show'), 2500);
      iosBanner.querySelector('.ios-close').addEventListener('click', () => {
        iosBanner.classList.remove('show');
        localStorage.setItem('lizzie-ios-banner-dismissed', '1');
      });
    }
  }
})();
