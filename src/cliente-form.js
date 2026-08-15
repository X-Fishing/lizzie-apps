// Formulário de edição do cadastro da CLIENTE FINAL — um só, usado por três
// telas: Minhas Clientes (revendedora), a tela da cliente (#/cliente/:id) e o
// CRUD de Clientes do staff. Sem isto o mesmo formulário viveria em triplicata
// e a regra do telefone divergiria entre elas.
//
// Toda a escrita vai pela RPC cliente_editar (0056), SECURITY DEFINER, que
// valida permissão NO SERVIDOR: staff, ou a revendedora que já vendeu para
// esta cliente. Não existe policy de UPDATE em `clientes` para a revendedora —
// escrita barrada pela RLS voltaria "200 com lista vazia", em silêncio.
import { sb } from './supabase.js';
import { esc, sbQ, toast, openModal, closeModal, fmtDiaMes, diaMesPartes,
         telFmt, telValido, telNormalizado } from './utils.js';
// maskTelBR/maskDiaMes são usados só em handlers inline (oninput=) via window.

// Estado do formulário aberto. O callback não cabe num onclick= (que só
// carrega string), então mora aqui.
let atual = null;
let aoSalvar = null;

export function abrirEdicaoCliente(cliente, callback) {
  if (!cliente) return;
  atual = cliente;
  aoSalvar = callback || null;

  document.getElementById('cad-modal-titulo').textContent = 'Editar cliente';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="cf-nome" class="form-control" value="${esc(cliente.nome || '')}"></div>
    <div class="form-group"><label class="form-label">WhatsApp (com DDD)</label>
      <input type="tel" id="cf-cel" class="form-control" inputmode="numeric" maxlength="16" placeholder="(11) 98765-4321" value="${esc(telFmt(cliente.celular) === '—' ? '' : telFmt(cliente.celular))}" oninput="maskTelBR(this)">
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px">É por ele que a Lizzie reconhece a cliente e conta os selos. Se o número novo já for de outra cliente, o sistema recusa — fale com a administração para juntar os cadastros.</div></div>
    <div class="form-group"><label class="form-label">Aniversário</label>
      <input type="text" id="cf-nasc" class="form-control" inputmode="numeric" maxlength="5" placeholder="dd/mm" value="${esc(fmtDiaMes(cliente.aniversario_dia, cliente.aniversario_mes))}" oninput="maskDiaMes(this)"></div>
    <div class="form-group"><label class="form-label">Cidade</label>
      <input type="text" id="cf-cidade" class="form-control" value="${esc(cliente.cidade || '')}"></div>
    <div class="form-group"><label class="form-label">E-mail</label>
      <input type="text" id="cf-email" class="form-control" inputmode="email" value="${esc(cliente.email || '')}"></div>
    <div class="form-group"><label class="form-label">Observação</label>
      <textarea id="cf-obs" class="form-control" rows="2">${esc(cliente.observacao || '')}</textarea></div>`;

  const salvar = document.getElementById('cad-modal-salvar');
  salvar.style.display = '';
  salvar.disabled = false;
  salvar.textContent = 'Salvar';
  salvar.setAttribute('onclick', 'clienteFormSalvar()');
  openModal('modal-cadastro');
}

export async function clienteFormSalvar() {
  if (!atual) return;
  const val = id => (document.getElementById(id)?.value || '').trim();
  const nome = val('cf-nome');
  const cel  = val('cf-cel');
  const nascTxt = val('cf-nasc');
  const nasc = diaMesPartes(nascTxt);

  if (!nome) { toast('Informe o nome da cliente'); return; }
  if (cel && !telValido(cel)) { toast('Telefone inválido — informe um número real com DDD.'); return; }
  if (nascTxt && !nasc) { toast('Aniversário inválido — use dd/mm (ex.: 07/03).'); return; }

  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';
  // Strings vazias (e não null) em cidade/e-mail/observação: a RPC trata null
  // como "não mexe" e '' como "limpa" — sem isso não haveria como apagar um
  // dado errado.
  const { error } = await sbQ(sb.rpc('cliente_editar', {
    p_cliente_id: atual.id,
    p_nome: nome,
    p_tel: cel ? telNormalizado(cel) : null,
    p_dia: nasc?.dia ?? null,
    p_mes: nasc?.mes ?? null,
    p_cidade: val('cf-cidade'),
    p_email: val('cf-email'),
    p_obs: val('cf-obs'),
  }));
  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) {
    console.error('cliente_editar:', error);
    // 'erro' é obrigatório: o toast silencia mensagens que parecem de sucesso,
    // e "Este WhatsApp já é de outra cliente" precisa aparecer na tela.
    toast(/does not exist|schema cache/i.test(error.message || '')
      ? 'Função do banco não encontrada — rode a migração 0056 no Supabase.'
      : (error.message || 'Não foi possível salvar'), 'erro');
    return;
  }
  closeModal('modal-cadastro');
  toast('Cliente atualizada!');
  const cb = aoSalvar;
  atual = null; aoSalvar = null;
  if (cb) await cb();
}
