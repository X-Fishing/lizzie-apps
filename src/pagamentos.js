// Pagamentos: lista de vendas, detalhe, registrar pagamento, excluir.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, fmtBRL, formatDate, sbQ, fetchPaginado, toast, handleSupabaseError, confirmarAcao, openModal, closeModal, parseMoneyBR, moneyToInput, hojeBR, brToISO } from './utils.js';
import { enviarCertificado } from './certificado.js';
export async function loadVendas() {
  document.getElementById('p-list').innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  let q = sb.from('vendas').select('*').eq('revendedora_id', state.currentUser.id);
  const { data, error } = await sbQ(q.order('data_venda', { ascending: false }));
  if (error) {
    const msg = error.message === 'timeout' ? 'Conexão lenta. Tente novamente.' : 'Erro ao carregar.';
    document.getElementById('p-list').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div><p>${msg}</p></div>`;
    return;
  }
  state.allVendas = data || [];
  state.vendaItensCache = {};
  filtrarPagamentos();
}

export function filtrarPagamentos() {
  const list = state.pFilter === 'todos' ? state.allVendas : state.allVendas.filter(v => v.status === state.pFilter);
  const div = document.getElementById('p-list');

  const totalGeral = state.allVendas.reduce((s, v) => s + Number(v.valor_total || 0), 0);
  const totalPago = state.allVendas.reduce((s, v) => s + Number(v.valor_pago || 0), 0);
  const totalPendente = totalGeral - totalPago;
  const resumo = `<div class="pag-resumo">
    <div class="pag-resumo-card"><div class="pag-resumo-label">Total vendas</div><div class="pag-resumo-valor">R$ ${totalGeral.toFixed(2)}</div></div>
    <div class="pag-resumo-card"><div class="pag-resumo-label">Recebido</div><div class="pag-resumo-valor recv">R$ ${totalPago.toFixed(2)}</div></div>
    <div class="pag-resumo-card"><div class="pag-resumo-label">A receber</div><div class="pag-resumo-valor pend">R$ ${totalPendente.toFixed(2)}</div></div>
  </div>`;

  if (!list.length) {
    div.innerHTML = resumo + '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg></div><p>Nenhuma venda encontrada</p></div>';
    return;
  }

  const statusLabel = { pendente: 'Pendente', parcial: 'Parcial', quitado: 'Quitado' };
  const statusBadge = { pendente: 'badge-pendente', parcial: 'badge-parcial', quitado: 'badge-quitado' };

  const rows = list.map(v => {
    const pendente = Number(v.valor_total) - Number(v.valor_pago);
    return `<tr class="pag-row" onclick="verVenda('${v.id}')">
      <td class="pag-td"><div class="pag-cliente">${esc(v.nome_cliente)}</div><div class="pag-forma">${formatDate(v.data_venda)}</div></td>
      <td class="pag-td"><span class="pag-valor">R$ ${Number(v.valor_total).toFixed(2)}</span></td>
      <td class="pag-td"><span class="pag-forma">${v.forma_pagamento}</span></td>
      <td class="pag-td"><span class="pag-valor pag-valor-pago">R$ ${Number(v.valor_pago).toFixed(2)}</span></td>
      <td class="pag-td"><span class="pag-valor ${pendente>0?'pag-valor-pendente':''}">R$ ${pendente.toFixed(2)}</span></td>
      <td class="pag-td"><span class="badge ${statusBadge[v.status]}">${statusLabel[v.status]}</span></td>
      <td class="pag-td" style="text-align:right">${pendente > 0 && v.telefone_cliente ? `<button class="btn-icon" title="Cobrar no WhatsApp" style="color:#128C7E" onclick="event.stopPropagation();zapCobrancaCliente('${v.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg></button>` : ''}</td>
    </tr>`;
  }).join('');

  div.innerHTML = resumo + `<div class="pag-wrap"><table class="pag-table">
    <thead><tr>
      <th class="pag-th">Cliente</th>
      <th class="pag-th">Total</th>
      <th class="pag-th">Forma</th>
      <th class="pag-th">Pago</th>
      <th class="pag-th">Pendente</th>
      <th class="pag-th">Status</th>
      <th class="pag-th"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export function setPFilter(el, f) {
  state.pFilter = f;
  document.querySelectorAll('[data-pfilter]').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filtrarPagamentos();
}

export async function verVenda(id) {
  const v = state.allVendas.find(x => x.id === id);
  if (!v) return;

  const [itensRes, recebsRes] = await Promise.all([
    state.vendaItensCache[id]
      ? Promise.resolve({ data: state.vendaItensCache[id] })
      : sbQ(sb.from('venda_itens').select('*').eq('venda_id', id).order('created_at')),
    sbQ(sb.from('recebimentos').select('*').eq('venda_id', id).order('data_recebimento'))
  ]);
  if (itensRes.error) { toast('Erro ao carregar itens'); return; }
  const itens = itensRes.data || [];
  state.vendaItensCache[id] = itens;
  const recebimentos = (recebsRes.data) || [];

  const restante = Number(v.valor_total) - Number(v.valor_pago);
  const itensHtml = itens.map(it => `
    <div class="hist-item-row">
      <span>${it.quantidade}× ${esc(it.descricao)}${it.referencia ? ` <span style="color:var(--muted);font-size:11px">(${esc(it.referencia)})</span>` : ''}</span>
      <span>R$ ${(it.quantidade * Number(it.preco_unit)).toFixed(2)}</span>
    </div>`).join('');

  const recebsHtml = recebimentos.length
    ? recebimentos.map(r => `
        <div class="hist-item-row">
          <span style="color:var(--success)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${formatDate(r.data_recebimento)}</span>
          <span>R$ ${Number(r.valor).toFixed(2)}</span>
        </div>`).join('')
    : '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0">Nenhum recebimento registrado ainda</div>';

  document.getElementById('detalhe-venda-content').innerHTML = `
    <div class="modal-title"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg> ${esc(v.nome_cliente)}</div>
    <div class="detail-grid">
      <div class="detail-row"><div class="detail-key">Data venda</div><div class="detail-val">${formatDate(v.data_venda)}</div></div>
      <div class="detail-row"><div class="detail-key">Forma</div><div class="detail-val">${v.forma_pagamento}</div></div>
      <div class="detail-row"><div class="detail-key">Total</div><div class="detail-val">R$ ${Number(v.valor_total).toFixed(2)}</div></div>
      <div class="detail-row"><div class="detail-key">Pago</div><div class="detail-val" style="color:var(--success)">R$ ${Number(v.valor_pago).toFixed(2)}</div></div>
      <div class="detail-row"><div class="detail-key">Pendente</div><div class="detail-val" style="color:var(--danger)">R$ ${restante.toFixed(2)}</div></div>
      ${v.telefone_cliente ? `<div class="detail-row"><div class="detail-key">WhatsApp</div><div class="detail-val">${esc(v.telefone_cliente)}</div></div>` : ''}
      ${v.nascimento_cliente ? `<div class="detail-row"><div class="detail-key">Aniversário</div><div class="detail-val">${formatDate(v.nascimento_cliente)}</div></div>` : ''}
      ${v.data_combinada ? `<div class="detail-row"><div class="detail-key">Data combinada</div><div class="detail-val"${(v.data_combinada < new Date().toISOString().slice(0,10) && restante > 0) ? ' style="color:var(--danger)"' : ''}>${(() => { const p = v.data_combinada.split('T')[0].split('-'); return `${p[2]}/${p[1]}`; })()}</div></div>` : ''}
      ${v.observacao ? `<div class="detail-row"><div class="detail-key">Obs.</div><div class="detail-val">${esc(v.observacao)}</div></div>` : ''}
    </div>
    ${restante > 0 && v.telefone_cliente ? `<button class="btn-secondary" style="width:100%;margin-bottom:10px;border-color:#25D366;color:#128C7E" onclick="zapCobrancaCliente('${v.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg> Cobrar no WhatsApp</button>` : ''}
    ${v.telefone_cliente ? `<button class="btn-secondary" style="width:100%;margin-bottom:10px" onclick="reenviarGarantiaVenda('${v.id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg> Enviar certificado de garantia</button>` : ''}
    <div class="divider"></div>
    <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Itens da compra</div>
    <div style="background:#faf7f2;padding:10px 12px;border-radius:10px;margin-bottom:14px">${itensHtml}</div>
    <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recebimentos</div>
    <div style="background:#faf7f2;padding:10px 12px;border-radius:10px;margin-bottom:14px">${recebsHtml}</div>
    ${v.status !== 'quitado' ? `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Valor recebido (R$) *</label>
        <input type="text" id="p-reg-val" class="form-control" inputmode="numeric" placeholder="0,00" oninput="maskMoneyBR(this)">
      </div>
      <div class="form-group">
        <label class="form-label">Data do recebimento *</label>
        <input type="text" id="p-reg-data" class="form-control" placeholder="dd/mm/aaaa" maxlength="10" inputmode="numeric" oninput="maskDateBR(this)" value="${hojeBR()}">
      </div>
    </div>
    <button class="btn-primary" style="width:100%" onclick="registrarPagamento('${id}')">Confirmar recebimento</button>
    ` : `<div class="alert" style="background:rgba(76,175,130,0.1);color:var(--success);border:1px solid rgba(76,175,130,0.3);margin-top:8px;padding:10px 14px;border-radius:10px"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Pagamento quitado</div>`}
    <div style="display:flex;gap:10px;margin-top:10px">
      <button class="btn-secondary" style="flex:1" onclick="closeModal('modal-detalhe-venda')">Fechar</button>
      <button class="btn-danger" onclick="excluirVenda('${id}')"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Excluir</button>
    </div>`;
  openModal('modal-detalhe-venda');
}

// Regenera e reenvia o certificado de garantia de uma venda já registrada.
export async function reenviarGarantiaVenda(id) {
  const v = state.allVendas.find(x => x.id === id);
  if (!v) { toast('Venda não encontrada'); return; }
  const itens = (state.vendaItensCache[id] || []).map(it => ({
    descricao: it.descricao, referencia: it.referencia || null, quantidade: it.quantidade,
  }));
  try {
    await enviarCertificado({ vendaId: id, cliente: v.nome_cliente, tel: v.telefone_cliente, dataISO: v.data_venda, itens });
  } catch (e) {
    console.error('reenviarGarantiaVenda', e);
    toast('Não foi possível enviar o certificado — tente de novo', 'erro');
  }
}

export async function excluirVenda(id) {
  confirmarAcao('Excluir venda', 'Excluir esta venda? As peças vão voltar para o seu Catálogo. Essa ação não pode ser desfeita.', 'Excluir', async () => {
    let itens = state.vendaItensCache[id];
    if (!itens) {
      const { data, error } = await sbQ(sb.from('venda_itens').select('*').eq('venda_id', id));
      if (error) { toast('Erro ao buscar itens'); return; }
      itens = data || [];
    }

    for (const it of itens) {
      if (!it.consignado_id) continue;
      const { data: c } = await sbQ(sb.from('consignados').select('quantidade_vendida').eq('id', it.consignado_id).single());
      if (c) {
        const nova = Math.max(0, (c.quantidade_vendida || 0) - it.quantidade);
        await sbQ(sb.from('consignados').update({ quantidade_vendida: nova }).eq('id', it.consignado_id));
      }
    }

    // Remove itens e recebimentos antes da venda — nao depende de ON DELETE
    // CASCADE nas FKs (se o cascade existir, esses deletes sao inofensivos).
    await sbQ(sb.from('venda_itens').delete().eq('venda_id', id));
    await sbQ(sb.from('recebimentos').delete().eq('venda_id', id));

    const { error } = await sb.from('vendas').delete().eq('id', id);
    if (error) { toast('Erro ao excluir'); return; }
    toast('Venda excluída — peças devolvidas ao Catálogo');
    closeModal('modal-detalhe-venda');
    loadVendas();
  });
}

export async function registrarPagamento(id) {
  const v = state.allVendas.find(x => x.id === id);
  const val = parseMoneyBR(document.getElementById('p-reg-val').value);
  const dataBR = document.getElementById('p-reg-data').value;
  const data = brToISO(dataBR);
  if (!val || val <= 0) { toast('Valor inválido'); return; }
  if (!data) { toast('Data inválida (use dd/mm/aaaa)'); return; }

  const { error: errRec } = await sbQ(
    sb.from('recebimentos').insert({ venda_id: id, valor: val, data_recebimento: data })
  );
  if (errRec) { console.error(errRec); toast('Erro: ' + (errRec.message || 'tente novamente')); return; }

  const novoPago = Number(v.valor_pago) + val;
  const novoStatus = novoPago >= Number(v.valor_total) ? 'quitado' : 'parcial';
  const { error } = await sb.from('vendas').update({ valor_pago: novoPago, status: novoStatus }).eq('id', id);
  if (error) { toast('Erro ao atualizar venda'); return; }
  toast('Pagamento registrado!');
  closeModal('modal-detalhe-venda');
  loadVendas();
}

// WhatsApp de cobrança do fiado — mensagem pronta com o valor pendente e a
// data combinada (quando houver). Modelo do zapCobranca do financeiro.
export function zapCobrancaCliente(vendaId) {
  const v = state.allVendas.find(x => String(x.id) === String(vendaId));
  if (!v) return;
  let tel = String(v.telefone_cliente || '').replace(/\D/g, '');
  if (!tel) { toast('Cliente sem WhatsApp cadastrado.'); return; }
  if (!tel.startsWith('55') || tel.length <= 11) tel = '55' + tel;
  const pendente = Number(v.valor_total) - Number(v.valor_pago);
  if (pendente <= 0) { toast('Esta venda já está quitada.'); return; }
  const primeiro = (v.nome_cliente || '').trim().split(' ')[0] || 'tudo bem';
  const hoje = new Date().toISOString().slice(0, 10);
  const dc = v.data_combinada;
  const ddmm = iso => { const p = iso.split('T')[0].split('-'); return `${p[2]}/${p[1]}`; };
  const dcFmt = dc ? ddmm(dc) : '';
  const frase = !dc ? 'está em aberto'
    : dc < hoje ? `estava combinado para ${dcFmt}`
    : dc === hoje ? `combinamos para hoje (${dcFmt})`
    : `combinamos para ${dcFmt}`;
  const msg = `Oi ${primeiro}, tudo bem? 💗 Passando para lembrar com carinho do valor de ${fmtBRL(pendente)} da sua comprinha, que ${frase}. Qualquer dúvida estou à disposição! Obrigada 🌸`;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}
