// Modal pós-venda: aparece ao finalizar a venda. Mostra o resumo, os selos
// ganhos na cartela de fidelidade e os botões de WhatsApp (selos + garantia).
// Os envios são wa.me (modo grátis) — a revendedora só confirma.
import { state } from './state.js';
import { esc, fmtBRL, openModal, closeModal, toast } from './utils.js';
import { renderCartelaFidelidade } from './fidelidade.js';
import { enviarWhatsApp } from './whatsapp.js';

const primeiroNome = n => (n || '').trim().split(/\s+/)[0] || 'cliente';

// ret = jsonb do registrar_venda; snapshot = { cliente, tel, dataISO, total, itens }
export function abrirModalPosVenda(ret, snapshot) {
  // Banco antigo (retorno uuid string) ou sem cliente vinculada → sem fidelidade.
  const fid = (ret && typeof ret === 'object') ? ret.fidelidade : null;
  state.posVendaCtx = { ...snapshot, vendaId: ret?.venda_id || null, fid };

  const bloco = fid ? `
    <div style="text-align:center;margin:16px 0 4px">
      <div class="fid-progresso" style="font-size:20px">+${fid.selos_ganhos} selo${fid.selos_ganhos !== 1 ? 's' : ''} nesta compra</div>
      <div style="font-size:12px;color:var(--muted)">Cartela: ${fid.cartela_selos ?? 0}/10</div>
    </div>
    ${renderCartelaFidelidade(fid.cartela_selos ?? 0)}
    ${fid.completou ? `<div style="text-align:center;background:rgba(212,168,75,.12);border:1px solid var(--gold);border-radius:12px;padding:12px;margin-top:14px;color:var(--plum);font-size:13px"><b>Cartela completa!</b><br>A cliente ganhou R$ 300 em peças para retirar na loja.</div>` : ''}
  ` : `<div style="font-size:12px;color:var(--muted);text-align:center;margin:14px 0">Venda registrada.</div>`;

  document.getElementById('pos-venda-content').innerHTML = `
    <div style="font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--plum);margin-bottom:4px">Venda registrada</div>
    <div style="font-size:13px;color:var(--muted)">${esc(snapshot.cliente)} · ${fmtBRL(snapshot.total)}</div>
    ${bloco}
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">
      ${fid ? `<button class="btn-primary" style="width:100%" onclick="posVendaEnviarSelos()">Enviar selos no WhatsApp</button>` : ''}
      <button class="btn-secondary" style="width:100%" id="pos-venda-garantia" onclick="posVendaEnviarGarantia()">Enviar certificado de garantia</button>
      <button class="btn-secondary" style="width:100%;border:none;color:var(--muted)" onclick="closeModalPosVenda()">Concluir</button>
    </div>`;
  openModal('modal-pos-venda');
}

export function closeModalPosVenda() { closeModal('modal-pos-venda'); }

export function posVendaEnviarSelos() {
  const c = state.posVendaCtx;
  if (!c || !c.fid) { toast('Sem dados de fidelidade'); return; }
  const nome = primeiroNome(c.cliente);
  const x = c.fid.cartela_selos ?? 0;
  const fim = c.fid.completou
    ? 'cartela completa! Você ganhou R$ 300 em joias para retirar na loja 🎁'
    : `faltam ${10 - x} selo${10 - x !== 1 ? 's' : ''} para ganhar R$ 300 em joias`;
  const mensagem = `Oi ${nome}! 💗 Sua compra de ${fmtBRL(c.total)} na Lizzie Semijoias valeu +${c.fid.selos_ganhos} selo${c.fid.selos_ganhos !== 1 ? 's' : ''} no cartão fidelidade. Você está com ${x} de 10 selos — ${fim}.`;
  enviarWhatsApp({ telefone: c.tel, mensagem });
}

// Stub — a geração/envio do certificado de garantia é implementada na Fase 5.
export function posVendaEnviarGarantia() { toast('Certificado de garantia em breve.'); }
