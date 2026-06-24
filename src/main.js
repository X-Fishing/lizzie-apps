// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
// AUDITORIA RLS — 11/06/2026 — <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> RESOLVIDO
// Toda a autorizacao do app e client-side; a seguranca REAL depende de
// Row Level Security no Postgres. O teste anonimo (anon key publica) inicial
// mostrou profiles (7 linhas, telefones = PII/LGPD) e consignados (100 linhas)
// LEGIVEIS sem login — vazamento causado por policy template permissiva
// (using(true)) somada por OU. Corrigido aplicando RLS-policies.sql (dropa
// todas as policies das 6 tabelas e recria so as corretas: revendedora ve so
// o proprio, admin ve tudo). Re-teste anonimo: as 6 tabelas retornam 0 linhas.
// Se criar tabela nova, lembrar de habilitar RLS + policies antes de publicar.
import './styles.css';
import { sb, SUPABASE_URL, SUPABASE_KEY, RECOVERY_IN_URL, URL_AUTH_ERROR } from './supabase.js';
import { state } from './state.js';
import { CAT_LABEL, brToISO, closeModal, confirmarAcao, detectarCategoria, esc, fecharConfirma, fetchPaginado, fmtBRL, formatDate, handleSupabaseError, hojeBR, isAuthError, isoToBR, maskDateBR, maskMoneyBR, moneyToInput, openModal, parseMoneyBR, previewFoto, qtdDisp, sbQ, showMsg, toast } from './utils.js';
import { showPanel, toggleCadastros } from './nav.js';
import { mostrarRecovery, ROLE_LABELS, ehAdmin, ehGestor, ehStaff, loadUser, maskTelBR, salvarComplemento, showSplash, switchTab, fazerLogin, mostrarRecuperar, voltarLogin, loginGoogle, enviarLinkRecuperacao, salvarNovaSenha, fazerCadastro } from './auth.js';
import { loadDashboard, loadFinanceiro, loadCalculadora, loadClientes, loadMarketing, loadFuncionarios, loadFormasPagamento, loadCategoriasFinanceiras } from './dashboard.js';
import { calcPrazoGarantia, loadGarantias, filtrarGarantias, sortGarantiasStaff, setGFilter, renderGarantiaCard, verGarantia, openNovaGarantia, editarGarantia, salvarGarantia, mudarStatus, atualizarStatusCard, excluirGarantia } from './garantias.js';
import { openBlingSync, buscarBling, filtrarBling, verItensBling, voltarListaBling, importarItensBling, atualizarMaleta, previewMaletaPorId, confirmarMaleta, salvarBlingId, detectarBlingId, escolherBlingCandidato, normalizarNome, fetchTodosBling, SITUACAO_ABERTO, BLING_ITENS_FN, BLING_HEADERS } from './bling.js';
import { loadVendas, setPFilter, verVenda, excluirVenda, registrarPagamento } from './pagamentos.js';
import { loadHistorico, filtrarHistorico, toggleHistorico } from './historico.js';
import { loadTrocasDashboard, setTrocaFiltro, toggleOrdemTroca, carregarProximasTrocas, compararPorTroca, atualizarBadgesTroca } from './trocas.js';
import { loadAdmin, renderAprovadas, verRevendedora, aprovarRev, revogarRev, definirPapel, confirmarExclusaoRev, excluirRevendedora } from './admin.js';
import { loadConsignados, sortConsignados, renderCicloGrid, abrirHistoricoCiclo, voltarHistoricoCiclo, abrirCicloRev, voltarCardsCiclo, openBuscaPeca, renderBuscaPeca, finalizarCicloRev, deletarCicloRev, openVenda, atualizarTotalVenda, adicionarAoCarrinho, removerDoCarrinho, abrirFinalizarVenda, ajustarValorPago, confirmarVendaCarrinho, openNovoConsignado, salvarConsignado, openFechamento, gerarPdfFechamento, fecharPrint } from './consignados.js';








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



                                  // gestão de acesso (papéis, excluir)
          // Bling, catálogo, aprovar
 // vê tudo (não-revendedora)






// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════









// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════




// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════


// ═══════════════════════════════════════════════
// GARANTIAS
// ═══════════════════════════════════════════════












// ═══════════════════════════════════════════════
// CICLO (CONSIGNADOS)
// ═══════════════════════════════════════════════
































// ═══════════════════════════════════════════════
// CARRINHO DE VENDA
// ═══════════════════════════════════════════════











// ═══════════════════════════════════════════════
// BLING
// ═══════════════════════════════════════════════






















// ═══════════════════════════════════════════════
// PAGAMENTOS (vendas)
// ═══════════════════════════════════════════════






// ═══════════════════════════════════════════════
// HISTÓRICO
// ═══════════════════════════════════════════════






// ═══════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════



// ═══════════════════════════════════════════════
// DASHBOARD DE TROCAS (admin)
// ═══════════════════════════════════════════════

















// ── Atualizar itens da maleta (Bling -> app, append-only, gestor) ──────








// ═══════════════════════════════════════════════
// FECHAMENTO DO CICLO
// ═══════════════════════════════════════════════



// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════


document.querySelectorAll('.modal-overlay').forEach(o => {
  // data-lock-outside: so fecha pelo botao Fechar/Cancelar (ex.: garantia),
  // evitando perder dados por um clique acidental fora do pop-up.
  o.addEventListener('click', e => {
    if (e.target === o && !o.hasAttribute('data-lock-outside')) o.classList.remove('show');
  });
});






// Expoe no window TODAS as funcoes chamadas via on* no HTML (estatico e gerado),
// pois main.js agora e um ES module (escopo proprio). Lista derivada dos handlers on*.
Object.assign(window, { renderAprovadas, renderGarantiaCard, ehAdmin, ehStaff, ehGestor, loadDashboard, loadGarantias, loadConsignados, loadVendas, loadHistorico, loadTrocasDashboard, loadAdmin, loadFinanceiro, loadCalculadora, loadClientes, loadMarketing, loadFuncionarios, loadFormasPagamento, loadCategoriasFinanceiras, sb, abrirCicloRev, abrirFinalizarVenda, abrirHistoricoCiclo, adicionarAoCarrinho, ajustarValorPago, aprovarRev, atualizarMaleta, atualizarStatusCard, atualizarTotalVenda, buscarBling, calcPrazoGarantia, closeModal, confirmarExclusaoRev, confirmarMaleta, confirmarVendaCarrinho, definirPapel, deletarCicloRev, detectarBlingId, editarGarantia, enviarLinkRecuperacao, escolherBlingCandidato, excluirGarantia, excluirRevendedora, excluirVenda, fazerCadastro, fazerLogin, fecharConfirma, fecharPrint, filtrarBling, filtrarGarantias, filtrarHistorico, finalizarCicloRev, gerarPdfFechamento, importarItensBling, loginGoogle, maskDateBR, maskMoneyBR, maskTelBR, mostrarRecuperar, mudarStatus, openBlingSync, openBuscaPeca, openFechamento, openNovaGarantia, openNovoConsignado, openVenda, previewFoto, previewMaletaPorId, registrarPagamento, removerDoCarrinho, renderBuscaPeca, renderCicloGrid, revogarRev, salvarBlingId, salvarComplemento, salvarConsignado, salvarGarantia, salvarNovaSenha, setGFilter, setPFilter, setTrocaFiltro, showPanel, sortConsignados, sortGarantiasStaff, switchTab, toggleCadastros, toggleHistorico, toggleOrdemTroca, verGarantia, verItensBling, verRevendedora, verVenda, voltarCardsCiclo, voltarHistoricoCiclo, voltarListaBling, voltarLogin });

// START
init();

// PWA — install prompt + iOS banner + service worker
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

  // Registro do service worker e feito pelo vite-plugin-pwa (registerType: 'autoUpdate').
})();
