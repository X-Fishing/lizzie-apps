// ═══════════════════════════════════════════════════════════════════
// LEMBRETES — painel flutuante no canto inferior direito (SÓ STAFF).
//
// Junta num lugar só o que hoje só aparece se alguém abrir a tela certa:
// troca de mostruário chegando, revendedora devendo e conta a pagar vencida.
// Sem isso, o que está vencendo só é descoberto por acaso.
//
// Regras que sustentam este módulo:
//  - STAFF-ONLY. O gate real é o `if (ehStaff())` em auth.js, não o CSS —
//    as consultas são globais (não filtram por revendedora), então montar
//    isso para uma revendedora mostraria dado de todo mundo. A RLS do
//    Postgres já cobre o resto (todas as tabelas aqui são is_staff()).
//  - NÃO existe (e não deve voltar a existir) uma seção com dado de fiado
//    da CLIENTE FINAL de uma revendedora (quem deve, quanto, quando
//    combinou) — não é dívida da revendedora com a Lizzie, é um combinado
//    dela com a cliente dela; a empresa não precisa saber (removido em
//    20/08/2026 por isso). Isso é diferente de coletarRecebimentos abaixo,
//    que é a revendedora devendo À LIZZIE — esse continua.
//  - Cada seção é gated pela permissão da TELA que ela abre, e quando a
//    pessoa não tem a permissão a consulta nem sai — não se busca dado que
//    não se pode ver.
//  - NUNCA chamar toast() daqui. Isto roda de 10 em 10 minutos; um toast de
//    erro viraria tortura. Falha vira console.warn e a seção some.
// ═══════════════════════════════════════════════════════════════════
import { sb } from './supabase.js';
import { esc, sbQ, fmtBRL, formatDate, hojeISO } from './utils.js';
import { podeAcessarPanel } from './menu.js';
import { showPanel } from './nav.js';
import { infoDaData } from './trocas.js';

const REFRESH_MS = 10 * 60 * 1000;
const MAX_ITENS_VISIVEIS = 5;   // o resto vira "Ver todos (N)"

const IC_SINO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';
const IC_X = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

let _iniciado = false;
let _aberto = false;
let _secoes = [];

// ── Coleta ─────────────────────────────────────────────────────────
// Cada coletor devolve { chave, titulo, panel, itens:[{txt, sub, urgente}] }
// ou null quando não há nada (ou quando a pessoa não pode ver aquela tela).

// Troca de mostruário: reusa o cálculo já existente da tela de Trocas
// (infoDaData → vencida / proximo <= 7 dias). Lê as maletas com select('*')
// de propósito: `data_troca` só existe depois da migration 0050, e nomear a
// coluna faria a consulta inteira falhar onde ela ainda não rodou.
async function coletarTrocas() {
  if (!podeAcessarPanel('trocas')) return null;
  const { data: maletas, error } = await sbQ(sb.from('maletas').select('*').eq('status', 'ativa'));
  if (error) { console.warn('[lembretes] trocas:', error.message); return null; }
  const comData = (maletas || []).filter(m => m.data_troca);
  if (!comData.length) return null;

  const ids = [...new Set(comData.map(m => m.revendedora_id))];
  const { data: perfis } = await sbQ(sb.from('profiles').select('id,nome,troca_resolvida_em').in('id', ids));
  const perfilPor = Object.fromEntries((perfis || []).map(p => [p.id, p]));

  const itens = [];
  comData.forEach(m => {
    const p = perfilPor[m.revendedora_id];
    const info = infoDaData(m.data_troca, m.created_at);
    if (info.status !== 'vencida' && info.status !== 'proximo') return;
    // Mesma regra da tela de Trocas: resolução só vale se for mais nova que
    // o ciclo atual da maleta — senão a revendedora sumiria pra sempre.
    if (p?.troca_resolvida_em && p.troca_resolvida_em >= m.created_at) return;
    const d = info.diasRestantes;
    itens.push({
      txt: p?.nome || 'Revendedora',
      sub: d < 0 ? `venceu há ${-d} dia${-d !== 1 ? 's' : ''}`
        : d === 0 ? 'vence hoje'
          : `em ${d} dia${d !== 1 ? 's' : ''} · ${formatDate(m.data_troca)}`,
      urgente: d < 0,
      ordem: d,
    });
  });
  if (!itens.length) return null;
  itens.sort((a, b) => a.ordem - b.ordem);
  return { chave: 'trocas', titulo: 'Trocas de mostruário', panel: 'trocas', itens };
}

// Pedidos de remarcação vindos do app da revendedora (0053), esperando resposta.
// Sem isto, a revendedora pede e ninguém no desk fica sabendo até abrir Trocas.
async function coletarSolicitacoesTroca() {
  if (!podeAcessarPanel('trocas')) return null;
  const { data, error } = await sbQ(sb.from('solicitacoes_troca')
    .select('id,revendedora_id,data_solicitada,hora_solicitada,created_at')
    .eq('status', 'pendente').order('created_at').limit(50));
  if (error) { console.warn('[lembretes] solicitacoes_troca:', error.message); return null; }
  if (!data?.length) return null;

  const ids = [...new Set(data.map(s => s.revendedora_id))];
  const { data: perfis } = await sbQ(sb.from('profiles').select('id,nome').in('id', ids));
  const nomePor = Object.fromEntries((perfis || []).map(p => [p.id, p.nome]));

  const itens = data.map(s => {
    const hora = (s.hora_solicitada || '').slice(0, 5);
    return {
      txt: nomePor[s.revendedora_id] || 'Revendedora',
      sub: `quer remarcar para ${formatDate(s.data_solicitada)}${hora ? ' às ' + hora : ''}`,
      urgente: true,   // pedido parado é revendedora esperando resposta
    };
  });
  return { chave: 'sol-troca', titulo: 'Trocas — pedidos de remarcação', panel: 'trocas', itens };
}

// Revendedora devendo à Lizzie: lançamento a receber vencido e não pago.
// `estornado` é filtrado no JS (mesma exclusão que a tela de Financeiro faz).
async function coletarRecebimentos() {
  if (!podeAcessarPanel('financeiro')) return null;
  const { data, error } = await sbQ(sb.from('financeiro_lancamentos')
    .select('id,pessoa_nome,descricao,valor,vencimento,estornado')
    .eq('tipo', 'receber').eq('pago', false)
    .lt('vencimento', hojeISO())
    .order('vencimento').limit(50));
  if (error) { console.warn('[lembretes] recebimentos:', error.message); return null; }
  const itens = (data || []).filter(l => !l.estornado).map(l => ({
    txt: l.pessoa_nome || l.descricao || 'Lançamento',
    sub: `${fmtBRL(l.valor)} · venceu ${formatDate(l.vencimento)}`,
    urgente: true,
  }));
  if (!itens.length) return null;
  return { chave: 'receber', titulo: 'Revendedoras devendo', panel: 'financeiro', itens };
}

// REMOVIDO (20/08/2026, LGPD): mostrava, pra qualquer conta staff, qual
// cliente final de qual revendedora estava devendo — dado que não interessa
// à Lizzie (é um combinado entre a revendedora e a cliente dela, não uma
// dívida da revendedora com a empresa; essa outra existe em coletarRecebimentos,
// abaixo, e continua). Não trocar por uma versão "escopada por revendedora":
// a decisão foi que esse dado simplesmente não deve aparecer aqui.

async function coletarContasPagar() {
  if (!podeAcessarPanel('contas-a-pagar')) return null;
  const { data, error } = await sbQ(sb.from('contas_a_pagar')
    .select('id,descricao,valor,vencimento')
    .eq('status', 'aberto')
    .lt('vencimento', hojeISO())
    .order('vencimento').limit(50));
  if (error) { console.warn('[lembretes] contas a pagar:', error.message); return null; }
  const itens = (data || []).map(c => ({
    txt: c.descricao || 'Conta',
    sub: `${fmtBRL(c.valor)} · venceu ${formatDate(c.vencimento)}`,
    urgente: true,
  }));
  if (!itens.length) return null;
  return { chave: 'pagar', titulo: 'Contas a pagar', panel: 'contas-a-pagar', itens };
}

export async function carregarAvisos() {
  const res = await Promise.all([
    coletarTrocas(), coletarSolicitacoesTroca(), coletarRecebimentos(), coletarContasPagar(),
  ].map(p => Promise.resolve(p).catch(e => { console.warn('[lembretes]', e); return null; })));
  return res.filter(Boolean);
}

// ── Render ─────────────────────────────────────────────────────────
function secaoHtml(s) {
  const visiveis = s.itens.slice(0, MAX_ITENS_VISIVEIS);
  const resto = s.itens.length - visiveis.length;
  const linhas = visiveis.map(i => `
    <div style="padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:12.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.txt)}</div>
      <div style="font-size:11.5px;color:${i.urgente ? 'var(--danger)' : '#e8932f'}">${esc(i.sub)}</div>
    </div>`).join('');
  const rodape = s.panel
    ? `<button type="button" class="lembrete-link" onclick="lembretesIrPara('${s.chave}')">Ver todos (${s.itens.length}) →</button>`
    : (resto > 0 ? `<div style="font-size:11px;color:var(--muted);padding-top:6px">+ ${resto} outro${resto !== 1 ? 's' : ''}</div>` : '');
  return `<div style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600">${esc(s.titulo)}</span>
      <span class="lembrete-count">${s.itens.length}</span>
    </div>
    ${linhas}
    ${rodape}
  </div>`;
}

function render() {
  const wrap = document.getElementById('lembretes');
  if (!wrap) return;
  const total = _secoes.reduce((n, s) => n + s.itens.length, 0);
  // Nada pendente: some por completo. Um "tudo em dia" fixo no canto só
  // ocuparia espaço e ensinaria a ignorar a bolha.
  if (!total) { wrap.style.display = 'none'; _aberto = false; return; }
  wrap.style.display = 'block';

  document.getElementById('lembretes-bolha').innerHTML =
    `${IC_SINO}<span class="lembrete-badge">${total}</span>`;
  const box = document.getElementById('lembretes-box');
  box.style.display = _aberto ? 'block' : 'none';
  if (_aberto) {
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--plum)">Lembretes</span>
        <button type="button" class="btn-icon" title="Fechar" onclick="toggleLembretes()">${IC_X}</button>
      </div>
      ${_secoes.map(secaoHtml).join('')}`;
  }
}

export function toggleLembretes() {
  _aberto = !_aberto;
  render();
}

export function lembretesIrPara(chave) {
  const s = _secoes.find(x => x.chave === chave);
  if (!s?.panel) return;
  _aberto = false;
  render();
  showPanel(s.panel);
}

export async function atualizarLembretes() {
  try {
    _secoes = await carregarAvisos();
  } catch (e) {
    console.warn('[lembretes] falha ao atualizar:', e);
    _secoes = [];
  }
  render();
}

// Chamado UMA vez, de auth.js, e só para staff — depois de carregarPermissoes(),
// senão podeAcessarPanel responderia com o conjunto de permissões ainda vazio.
export function iniciarLembretes() {
  if (_iniciado) return;
  _iniciado = true;
  atualizarLembretes();
  setInterval(atualizarLembretes, REFRESH_MS);
  // Voltar pra aba é o momento em que o dado velho mais incomoda.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) atualizarLembretes();
  });
}
