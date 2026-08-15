// Clientes finais das revendedoras (base própria). Tela do STAFF: vê a base
// inteira, com quem vendeu para cada uma, quanto já compraram e quando foi a
// última compra. Clicar na linha abre a tela da cliente (#/cliente/:id).
//
// A EDIÇÃO passa pela RPC cliente_editar (0056), pelo formulário compartilhado
// em cliente-form.js — o mesmo que a revendedora usa em Minhas Clientes. Antes
// era um update direto na tabela, que aceitava gravar um celular já usado por
// outra cliente e só estourava com a mensagem crua do Postgres da constraint
// unique. A criação continua sendo insert direto (a RPC só edita).
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, sbQ, fetchPaginado, toast, confirmarAcao, openModal, closeModal, handleSupabaseError,
         isoToBR, formatDate, fmtBRL, diaMesPartes, fmtDiaMes, telFmt, telValido, telNormalizado } from './utils.js';
import { abrirEdicaoCliente } from './cliente-form.js';
// maskTelBR/maskDiaMes são usados só em handlers inline (oninput=) via window.

const IC_PLUS  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const IC_EDIT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IC_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
const IC_USERS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
const IC_CAKE  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/></svg>';

let cache = [];
let busca = '';

const panel = () => document.getElementById('panel-clientes');
const mesAtual = () => new Date().getMonth() + 1;
// Telefone fora do padrão = cadastro suspeito: como o celular é a chave de
// identidade, pode ter juntado mais de uma pessoa no mesmo registro.
const BADGE_TEL_RUIM = '<span class="badge badge-pendente" style="margin-left:6px" title="Número fora do padrão brasileiro — pode ser um telefone inventado, e pessoas diferentes podem ter sido juntadas neste cadastro.">Telefone inválido</span>';
const telRuim = c => !!c && !telValido(c);

export async function loadClientes() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  // fetchPaginado nas vendas: o PostgREST corta em 1000 linhas, e sem paginar
  // as clientes antigas apareceriam com "0 compras" sem nenhum aviso.
  const [{ data, error }, vendas, { data: profs }] = await Promise.all([
    sbQ(sb.from('clientes').select('*').order('nome')),
    fetchPaginado(() => sb.from('vendas')
      .select('cliente_id,valor_total,data_venda,revendedora_id')
      .not('cliente_id', 'is', null)),
    sbQ(sb.from('profiles').select('id,nome')),
  ]);
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message || '')) {
      panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_USERS}</div><p>Rode a migração <b>0021_clientes.sql</b> no Supabase para ativar a base de clientes.</p></div>`;
      return;
    }
    if (await handleSupabaseError(error, 'Erro ao carregar clientes')) return;
  }

  const nomeRev = new Map((profs || []).map(p => [String(p.id), p.nome]));
  const agg = new Map();
  for (const v of (vendas || [])) {
    const a = agg.get(v.cliente_id) || { compras: 0, total: 0, ultima: null, revs: new Set() };
    a.compras += 1;
    a.total += Number(v.valor_total || 0);
    if (!a.ultima || v.data_venda > a.ultima) a.ultima = v.data_venda;
    if (v.revendedora_id) a.revs.add(String(v.revendedora_id));
    agg.set(v.cliente_id, a);
  }

  cache = (data || []).map(c => {
    const a = agg.get(c.id);
    return {
      ...c,
      compras: a?.compras || 0,
      total: a?.total || 0,
      ultima: a?.ultima || null,
      revendedoras: a ? [...a.revs].map(id => nomeRev.get(id) || '—').sort() : [],
    };
  });
  render();
}

function render() {
  const mes = mesAtual();
  const aniv = cache.filter(c => c.aniversario_mes === mes).length;
  const comContato = cache.filter(c => c.celular).length;

  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Clientes</h2><div class="sub">${cache.length} cliente${cache.length !== 1 ? 's' : ''} cadastrado${cache.length !== 1 ? 's' : ''}</div></div>
      <div class="acts"><button class="btn-primary btn-sm" onclick="clienteNovo()">${IC_PLUS} Novo cliente</button></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Total</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${cache.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Aniversariantes do mês</span><span class="kpi-ic">${IC_CAKE}</span></div><div class="kpi-val">${aniv}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Com celular</span><span class="kpi-ic">${IC_USERS}</span></div><div class="kpi-val">${comContato}</div></div>
    </div>
    <div style="margin-bottom:14px"><input type="text" class="form-control" placeholder="Buscar por nome, telefone, cidade, e-mail ou revendedora..." value="${esc(busca)}" oninput="clienteBuscar(this.value)"></div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Cliente</th><th class="pag-th">Telefone</th><th class="pag-th">Revendedora(s)</th>
      <th class="pag-th" style="text-align:center">Compras</th><th class="pag-th" style="text-align:right">Total gasto</th>
      <th class="pag-th">Última compra</th><th class="pag-th">Aniversário</th>
      <th class="pag-th" style="text-align:right">Ações</th>
    </tr></thead><tbody id="cli-tbody">${linhasClientes()}</tbody></table></div>`;
}

// Só as linhas — a busca atualiza só isto (o input fica intacto, sem perder foco).
function linhasClientes() {
  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? cache.filter(c => [c.nome, c.cidade, c.celular, c.email, ...c.revendedoras]
        .some(v => (v || '').toLowerCase().includes(termo)))
    : cache;
  return lista.length ? lista.map(c => `
    <tr class="pag-row" style="cursor:pointer" onclick="abrirCliente('${c.id}')">
      <td class="pag-td"><span class="ciclo-desc">${esc(c.nome)}</span>${c.cidade ? `<div style="font-size:11px;color:var(--muted)">${esc(c.cidade)}</div>` : ''}</td>
      <td class="pag-td">${esc(telFmt(c.celular))}${telRuim(c.celular) ? BADGE_TEL_RUIM : ''}</td>
      <td class="pag-td">${c.revendedoras.length ? esc(c.revendedoras.join(', ')) : '—'}</td>
      <td class="pag-td" style="text-align:center">${c.compras || '—'}</td>
      <td class="pag-td" style="text-align:right">${c.compras ? fmtBRL(c.total) : '—'}</td>
      <td class="pag-td">${c.ultima ? formatDate(c.ultima) : '—'}</td>
      <td class="pag-td">${fmtDiaMes(c.aniversario_dia, c.aniversario_mes) || '—'}</td>
      <td class="pag-td" style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">
        <button class="btn-icon" title="Editar" onclick="clienteEditar('${c.id}')" style="color:var(--rose)">${IC_EDIT}</button>
        <button class="btn-icon" title="Excluir" onclick="clienteExcluir('${c.id}')" style="color:var(--danger)">${IC_TRASH}</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="8"><div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_USERS}</div><p>${termo ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}</p></div></td></tr>`;
}

export function clienteBuscar(v) {
  busca = v;
  const tb = document.getElementById('cli-tbody');
  if (tb) tb.innerHTML = linhasClientes(); else render();
}

// ── Edição: formulário compartilhado (mesmo da revendedora) ────────
export function clienteEditar(id) {
  abrirEdicaoCliente(cache.find(x => String(x.id) === String(id)), loadClientes);
}

// ── Cadastro NOVO (a RPC cliente_editar só edita) ──────────────────
export function clienteNovo() {
  document.getElementById('cad-modal-titulo').textContent = 'Novo cliente';
  document.getElementById('cad-modal-body').innerHTML = `
    <div class="form-group"><label class="form-label">Nome *</label>
      <input type="text" id="cli-nome" class="form-control" value=""></div>
    <div class="form-group"><label class="form-label">Celular (com DDD)</label>
      <input type="text" id="cli-cel" class="form-control" inputmode="numeric" maxlength="16" placeholder="(11) 98765-4321" value="" oninput="maskTelBR(this)"></div>
    <div class="form-group"><label class="form-label">E-mail</label>
      <input type="text" id="cli-email" class="form-control" inputmode="email" value=""></div>
    <div class="form-group"><label class="form-label">Cidade</label>
      <input type="text" id="cli-cidade" class="form-control" value=""></div>
    <div class="form-group"><label class="form-label">Aniversário</label>
      <input type="text" id="cli-nasc" class="form-control" inputmode="numeric" placeholder="dd/mm" maxlength="5" value="" oninput="maskDiaMes(this)"></div>
    <div class="form-group"><label class="form-label">Observação</label>
      <textarea id="cli-obs" class="form-control" rows="2"></textarea></div>`;
  const salvar = document.getElementById('cad-modal-salvar');
  salvar.style.display = '';
  salvar.disabled = false;
  salvar.textContent = 'Salvar';
  salvar.setAttribute('onclick', 'clienteSalvar()');
  openModal('modal-cadastro');
}

export async function clienteSalvar() {
  const val = elId => (document.getElementById(elId)?.value || '').trim();
  const nome = val('cli-nome');
  if (!nome) { toast('Nome é obrigatório'); return; }
  // Celular é a CHAVE de identidade da cliente (unique) e da cartela de
  // fidelidade: número inventado funde pessoas diferentes. Vazio é permitido
  // (fica null — a coluna é unique, mas nulos não colidem); preenchido tem de
  // ser real. Mesma regra do banco (0038: tel_br_valido).
  const cel = val('cli-cel');
  if (cel && !telValido(cel)) { toast('Telefone inválido — informe um número real com DDD.'); return; }
  // Aniversário é dd/mm, sem ano, e é opcional. Só reclama se foi digitado
  // algo que não é uma data válida — engolir em silêncio esconderia erro de
  // digitação.
  const nascTxt = val('cli-nasc');
  const nasc = diaMesPartes(nascTxt);
  if (nascTxt && !nasc) { toast('Aniversário inválido — use dd/mm (ex.: 07/03).'); return; }
  const nb = v => v || null;
  const payload = {
    nome,
    celular: cel ? telNormalizado(cel) : null,
    email: nb(val('cli-email')),
    cidade: nb(val('cli-cidade')),
    aniversario_dia: nasc?.dia ?? null,
    aniversario_mes: nasc?.mes ?? null,
    observacao: nb(val('cli-obs')),
    criado_por: state.currentUser.id,
  };
  const btn = document.getElementById('cad-modal-salvar');
  btn.disabled = true;
  const { error } = await sbQ(sb.from('clientes').insert(payload));
  btn.disabled = false;
  if (error) {
    if (/duplicate key|unique/i.test(error.message || '')) { toast('Já existe uma cliente com esse celular.', 'erro'); return; }
    if (await handleSupabaseError(error, 'Erro ao salvar')) return;
    toast('Erro ao salvar', 'erro'); return;
  }
  toast('Cliente salvo!');
  closeModal('modal-cadastro');
  loadClientes();
}

export function clienteExcluir(id) {
  const c = cache.find(x => String(x.id) === String(id));
  const aviso = c?.compras
    ? ` Ela tem ${c.compras} compra${c.compras !== 1 ? 's' : ''} registrada${c.compras !== 1 ? 's' : ''} — as vendas ficam, mas perdem o vínculo (e a cartela de fidelidade dela é apagada).`
    : '';
  confirmarAcao('Excluir cliente', `Excluir "${c?.nome || ''}"?${aviso} Isso não pode ser desfeito.`, 'Excluir', async () => {
    const { error } = await sbQ(sb.from('clientes').delete().eq('id', id));
    if (error) { if (await handleSupabaseError(error, 'Erro ao excluir')) return; toast('Erro ao excluir', 'erro'); return; }
    toast('Cliente excluído.');
    loadClientes();
  });
}
