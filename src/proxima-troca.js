// Próxima troca (app da REVENDEDORA): mostra a data/hora que a staff marcou no
// desk e deixa ela PEDIR outra data. Ela nunca escreve em `maletas` (a RLS só
// permite gestor) — cria uma linha em solicitacoes_troca e a staff aprova.
//
// Layout fiel ao design "Lizzie Mobile Revendedora": card-herói com a data,
// linhas de detalhe e a lista de pedidos. As cores saem das variáveis do app
// (--rose/--text/--muted/--blush) para não destoar das outras telas.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, toast, formatDate, openModal, closeModal, confirmarAcao, handleSupabaseError, isoSomandoDias, DIAS_CICLO_MOSTRUARIO } from './utils.js';

const panel = () => document.getElementById('panel-proxima-troca');

const IC_CAL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v3M16 3v3"/></svg>';
const IC_CLOCK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// 'YYYY-MM-DD' → 'Sáb, 15 de agosto' (formato do design).
function dataPorExtenso(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return formatDate(iso);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
// 'HH:MM:SS' do Postgres → 'HH:MM'.
const horaCurta = h => (h || '').slice(0, 5);

// Dias até a data (negativo = já passou). Mesma conta da tela de Trocas do desk.
function diasAte(iso) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00:00') - hoje) / 86400000);
}

const STATUS_PILL = {
  pendente:  ['#faf1de', '#b8822c', 'Aguardando'],
  aprovada:  ['#e5f6ec', '#2f9e64', 'Aprovada'],
  recusada:  ['#f9e6ec', '#c1577d', 'Recusada'],
};
function pill(status) {
  const [bg, cor, txt] = STATUS_PILL[status] || STATUS_PILL.pendente;
  return `<span style="background:${bg};color:${cor};font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:999px;flex-shrink:0">${txt}</span>`;
}

export async function loadProximaTroca() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';

  // Escopo explícito por revendedora_id — não confia só na RLS (uma funcionária
  // que escolhe "entrar como revendedora" continua staff para o banco).
  const uid = state.currentUser.id;
  const [mRes, sRes] = await Promise.all([
    // select('*'): nomear hora_troca quebraria a tela onde a 0053 não rodou.
    sbQ(sb.from('maletas').select('*').eq('revendedora_id', uid).eq('status', 'ativa').maybeSingle()),
    sbQ(sb.from('solicitacoes_troca').select('*').eq('revendedora_id', uid)
      .order('created_at', { ascending: false }).limit(5)),
  ]);
  // handleSupabaseError sempre devolve true: sair por ele deixaria o spinner
  // eterno. Chamar para o toast/sessão e renderizar o estado.
  if (mRes.error) {
    await handleSupabaseError(mRes.error, 'Erro ao carregar a troca');
    panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_CAL}</div><p>Não foi possível carregar a próxima troca. Tente de novo.</p></div>`;
    return;
  }
  if (sRes.error && /relation|does not exist|schema cache/i.test(sRes.error.message || '')) {
    panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_CAL}</div><p>Rode a migração <b>0053</b> no Supabase para ativar a agenda de trocas.</p></div>`;
    return;
  }

  state.minhaTroca = { maleta: mRes.data || null, solicitacoes: sRes.data || [] };
  renderProximaTroca();
}

// Redesenha a partir de state.minhaTroca, sem ir ao banco. Exportado para que
// dê para redesenhar depois de mexer no estado (e para o teste conseguir ver a
// tela com dados — a revendedora de teste não tem maleta ativa).
export function renderProximaTroca() {
  const { maleta, solicitacoes } = state.minhaTroca || {};
  const pendente = (solicitacoes || []).find(s => s.status === 'pendente') || null;

  panel().innerHTML = `
    <div class="page-head"><div>
      <h2>Próxima troca</h2>
      <div class="sub">Agenda de troca de mostruário</div>
    </div></div>
    ${heroHtml(maleta, pendente)}
    ${proximosCiclosHtml(maleta)}
    ${pedidosHtml(solicitacoes)}`;
}

// "Próximos ciclos" do design: a troca marcada + as duas seguintes projetadas
// pelo ciclo de 35 dias. As projetadas são PREVISTAS, não compromisso — por
// isso o rótulo diferente; quem marca de verdade é a Lizzie no desk.
function proximosCiclosHtml(maleta) {
  if (!maleta?.data_troca) return '';
  const hora = horaCurta(maleta.hora_troca);
  const linhas = [{ data: maleta.data_troca, agendada: true }];
  for (let i = 1; i <= 2; i++) {
    const d = isoSomandoDias(maleta.data_troca, DIAS_CICLO_MOSTRUARIO * i);
    if (d) linhas.push({ data: d, agendada: false });
  }
  const item = c => `<div class="card" style="padding:14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div style="min-width:0">
      <div style="font-size:14px;font-weight:600;color:var(--text)">${formatDate(c.data)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${c.agendada ? (hora || 'horário a combinar') : `previsão · ciclo de ${DIAS_CICLO_MOSTRUARIO} dias`}</div>
    </div>
    <span style="background:${c.agendada ? '#e6effa' : '#eeeaf2'};color:${c.agendada ? '#3568b0' : '#8b7fa0'};font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:999px;flex-shrink:0">${c.agendada ? 'Agendada' : 'Prevista'}</span>
  </div>`;
  return `<div style="font-family:'Playfair Display',serif;font-weight:600;font-size:18px;color:var(--text);margin:18px 0 10px">Próximos ciclos</div>
    ${linhas.map(item).join('')}`;
}

// Card-herói: ícone + "DATA AGENDADA" + data por extenso, divisor e as linhas
// de detalhe. É a peça central do design.
function heroHtml(maleta, pendente) {
  if (!maleta || !maleta.data_troca) {
    return `<div class="empty-state"><div class="empty-icon">${IC_CAL}</div>
      <p>Sua próxima troca ainda não foi marcada.<br>Assim que a Lizzie agendar, ela aparece aqui.</p></div>`;
  }
  const dias = diasAte(maleta.data_troca);
  const hora = horaCurta(maleta.hora_troca);
  const legenda = dias < 0 ? `passou há ${-dias} dia${-dias !== 1 ? 's' : ''}`
    : dias === 0 ? 'é hoje'
      : `em ${dias} dia${dias !== 1 ? 's' : ''}`;
  const cor = dias < 0 ? 'var(--danger)' : dias <= 7 ? 'var(--warning)' : 'var(--muted)';
  const nM = maleta.numero_interno || maleta.numero;

  const linha = (rot, val) => `<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:10px">
    <span style="font-size:13px;color:var(--muted)">${rot}</span>
    <span style="font-size:13.5px;font-weight:600;color:var(--text);text-align:right">${val}</span></div>`;

  return `<div class="card" style="padding:20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--blush);color:var(--rose);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px">${IC_CAL}</div>
      <div style="min-width:0">
        <div style="font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--muted);text-transform:uppercase">Data agendada</div>
        <div style="font-weight:700;font-size:19px;color:var(--text);margin-top:2px">${esc(dataPorExtenso(maleta.data_troca))}</div>
        <div style="font-size:12px;color:${cor};font-weight:600;margin-top:2px">${legenda}</div>
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:16px"></div>
    ${linha('Horário', hora || '<span style="color:var(--muted);font-weight:400">a combinar</span>')}
    ${maleta.local_troca ? linha('Local', esc(maleta.local_troca)) : ''}
    ${nM ? linha('Maleta', `#${esc(String(nM))}`) : ''}
    ${linha('Ciclo atual', `${formatDate(String(maleta.created_at).slice(0, 10))} → ${formatDate(maleta.data_troca)}`)}
    ${pendente
    ? `<div style="display:flex;align-items:center;gap:8px;background:var(--blush);border-radius:12px;padding:11px 13px;margin-top:14px">
         <span style="color:var(--rose);flex-shrink:0;font-size:16px">${IC_CLOCK}</span>
         <span style="font-size:12.5px;color:var(--text);line-height:1.45">Você já pediu para remarcar. A Lizzie vai responder em breve.</span>
       </div>`
    : `<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px" onclick="abrirPedidoTroca()">Pedir outra data</button>`}
  </div>`;
}

// Histórico dos pedidos (o pendente no topo, com opção de cancelar).
function pedidosHtml(solicitacoes) {
  if (!solicitacoes?.length) return '';
  const item = (s) => {
    const quando = `${formatDate(s.data_solicitada)}${horaCurta(s.hora_solicitada) ? ' · ' + horaCurta(s.hora_solicitada) : ''}`;
    return `<div class="card" style="padding:14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text)">${esc(quando)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">pedido em ${formatDate(String(s.created_at).slice(0, 10))}</div>
          ${s.motivo ? `<div style="font-size:11.5px;color:var(--muted);font-style:italic;margin-top:4px">“${esc(s.motivo)}”</div>` : ''}
        </div>
        ${pill(s.status)}
      </div>
      ${s.status === 'pendente'
    ? `<button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;margin-top:12px" onclick="cancelarPedidoTroca('${s.id}')">Cancelar pedido</button>`
    : ''}
    </div>`;
  };
  return `<div style="font-family:'Playfair Display',serif;font-weight:600;font-size:18px;color:var(--text);margin:18px 0 10px">Meus pedidos</div>
    ${solicitacoes.map(item).join('')}`;
}

// ── Pedir outra data ───────────────────────────────────────────────────
// Reusa o modal-cadastro genérico (mesmo caminho de clientes.js/fidelidade.js).
export function abrirPedidoTroca() {
  const maleta = state.minhaTroca?.maleta;
  if (!maleta) { toast('Você ainda não tem maleta ativa.'); return; }

  document.getElementById('cad-modal-titulo').textContent = 'Pedir outra data';
  document.getElementById('cad-modal-body').innerHTML = `
    <div style="font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:14px">
      A Lizzie precisa aprovar. Enquanto isso, vale a data que já está marcada.
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nova data *</label>
        <input type="date" id="pt-data" class="form-control" value="${esc(maleta.data_troca || '')}"></div>
      <div class="form-group"><label class="form-label">Horário</label>
        <input type="time" id="pt-hora" class="form-control" value="${esc(horaCurta(maleta.hora_troca))}"></div>
    </div>
    <div class="form-group"><label class="form-label">Motivo (opcional)</label>
      <textarea id="pt-motivo" class="form-control" rows="2" placeholder="Ex.: viagem, compromisso no trabalho..."></textarea></div>`;
  const salvar = document.getElementById('cad-modal-salvar');
  salvar.style.display = '';
  salvar.textContent = 'Enviar pedido';
  salvar.setAttribute('onclick', 'enviarPedidoTroca()');
  openModal('modal-cadastro');
}

export async function enviarPedidoTroca() {
  const maleta = state.minhaTroca?.maleta;
  if (!maleta) return;
  const data = document.getElementById('pt-data')?.value || '';
  const hora = document.getElementById('pt-hora')?.value || null;
  const motivo = (document.getElementById('pt-motivo')?.value || '').trim() || null;

  if (!data) { toast('Escolha a nova data'); return; }
  if (data === maleta.data_troca && (hora || '') === horaCurta(maleta.hora_troca)) {
    toast('Essa é a data que já está marcada.'); return;
  }

  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true;
  // data_atual/hora_atual são um SNAPSHOT: a staff precisa ver de onde para
  // onde foi o pedido, mesmo que o desk mude a agenda depois.
  const { error } = await sbQ(sb.from('solicitacoes_troca').insert({
    maleta_id: maleta.id,
    revendedora_id: state.currentUser.id,
    data_atual: maleta.data_troca,
    hora_atual: maleta.hora_troca,
    data_solicitada: data,
    hora_solicitada: hora,
    motivo,
  }));
  btn.disabled = false;

  if (error) {
    // O índice único parcial barra um 2º pedido pendente na mesma maleta.
    toast(/duplicate key|unique/i.test(error.message || '')
      ? 'Você já tem um pedido aguardando resposta.'
      : (error.message || 'Não foi possível enviar'), 'erro');
    return;
  }
  toast('Pedido enviado! A Lizzie vai responder em breve.');
  closeModal('modal-cadastro');
  loadProximaTroca();
}

export function cancelarPedidoTroca(id) {
  confirmarAcao('Cancelar pedido', 'Cancelar o pedido de remarcação?\n\nA data que já está marcada continua valendo.', 'Cancelar pedido', async () => {
    // A RLS só deixa apagar o PRÓPRIO pedido e enquanto está pendente.
    const { error } = await sbQ(sb.from('solicitacoes_troca').delete().eq('id', id).eq('status', 'pendente'));
    if (error) { toast('Não foi possível cancelar', 'erro'); return; }
    toast('Pedido cancelado.');
    loadProximaTroca();
  });
}
