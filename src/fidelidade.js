// Programa de Fidelidade — cartela de selos da CLIENTE FINAL.
// 1 selo a cada R$150 cheios da venda; 10 selos = R$300 em peças (retirada na
// loja). Os selos são creditados no banco (trigger aplicar_fidelidade, 0029).
// Staff vê todas as clientes; a revendedora só as clientes p/ quem já vendeu.
// Escopado NA QUERY (não só na RLS) — ver loadFidelidade().
//
// Esta tela é só a LISTA. Clicar numa cliente navega para #/cliente/:id
// (src/cliente-compras.js), onde ficam a cartela, o extrato, o ajuste manual,
// o resgate do prêmio e as compras dela.
import { sb } from './supabase.js';
import { state } from './state.js';
import { esc, escAttrJs, sbQ, handleSupabaseError, telFmt, telValido } from './utils.js';
import { ehStaff } from './auth.js';

const IC_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_GIFT  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>';
const IC_STAMP = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 6.5a4 4 0 0 0-8 0c0 2.5 3 4 3.5 6h1c.5-2 3.5-3.5 3.5-6z"/><circle cx="12" cy="12" r="10"/></svg>';

let cache = [];        // [{id, nome, celular, selos, premios}]
let busca = '';

const panel = () => document.getElementById('panel-fidelidade');
// Telefone fora do padrão = a cartela pode misturar mais de uma pessoa
// (o celular é a chave de identidade da cliente).
const telRuim = c => !!c && !telValido(c);

// Cartela visual de 10 casinhas (5×2). Exportada — o modal pós-venda reusa.
export function renderCartelaFidelidade(selos) {
  const n = Math.max(0, Math.min(10, Number(selos) || 0));
  const casas = Array.from({ length: 10 }, (_, i) =>
    i < n
      ? `<div class="fid-selo on">${IC_CHECK}</div>`
      : `<div class="fid-selo">${i + 1}</div>`).join('');
  return `<div class="fid-cartela">${casas}</div>`;
}

export async function loadFidelidade() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const staff = ehStaff();
  // A RLS de clientes/fidelidade_* escopa pelo PAPEL REAL gravado no banco
  // (profiles.role) — mas "Entrar como Revendedora" (auth.js:escolherModo)
  // só troca o papel NA MEMÓRIA da sessão, sem tocar no banco nem no
  // auth.uid(). Uma funcionária que escolhe esse modo continua staff pra a
  // RLS e receberia a base INTEIRA de clientes/selos aqui — mesmo a tela
  // dizendo "suas clientes" (render() já usa ehStaff() pro texto). Por isso
  // NÃO confiamos na RLS pra escopar: filtramos pelo papel EFETIVO da sessão,
  // igual historico.js/pagamentos.js já fazem com vendas.revendedora_id.
  let clienteIds = null;
  if (!staff) {
    const { data: minhasVendas, error: vErr } = await sbQ(sb.from('vendas')
      .select('cliente_id').eq('revendedora_id', state.currentUser.id).not('cliente_id', 'is', null));
    if (vErr) { if (await handleSupabaseError(vErr, 'Erro ao carregar fidelidade')) return; }
    clienteIds = [...new Set((minhasVendas || []).map(v => v.cliente_id))];
    if (!clienteIds.length) { cache = []; render(); return; }
  }
  const [cRes, cartRes, premRes] = await Promise.all([
    sbQ(clienteIds
      ? sb.from('clientes').select('id,nome,celular').in('id', clienteIds).order('nome')
      : sb.from('clientes').select('id,nome,celular').order('nome')),
    sbQ(clienteIds
      ? sb.from('fidelidade_cartelas').select('cliente_id,selos').eq('status', 'aberta').in('cliente_id', clienteIds)
      : sb.from('fidelidade_cartelas').select('cliente_id,selos').eq('status', 'aberta')),
    sbQ(clienteIds
      ? sb.from('fidelidade_premios').select('cliente_id').eq('status', 'pendente').in('cliente_id', clienteIds)
      : sb.from('fidelidade_premios').select('cliente_id').eq('status', 'pendente')),
  ]);
  if (cRes.error) {
    if (/relation|does not exist|schema cache/i.test(cRes.error.message || '')) {
      panel().innerHTML = `<div class="empty-state"><div class="empty-icon">${IC_STAMP}</div><p>Rode as migrações <b>0028</b> e <b>0029</b> no Supabase para ativar a fidelidade.</p></div>`;
      return;
    }
    if (await handleSupabaseError(cRes.error, 'Erro ao carregar fidelidade')) return;
  }
  const selosPorCli = {};
  (cartRes.data || []).forEach(c => { selosPorCli[c.cliente_id] = c.selos; });
  const premiosPorCli = {};
  (premRes.data || []).forEach(p => { premiosPorCli[p.cliente_id] = (premiosPorCli[p.cliente_id] || 0) + 1; });
  cache = (cRes.data || []).map(c => ({
    ...c, selos: selosPorCli[c.id] || 0, premios: premiosPorCli[c.id] || 0,
  }));
  render();
}

function render() {
  const emAndamento = cache.filter(c => c.selos > 0).length;
  const premios = cache.reduce((s, c) => s + c.premios, 0);
  const staff = ehStaff();
  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Fidelidade</h2><div class="sub">${staff ? 'Cartela de selos das clientes' : 'Cartela de selos das suas clientes'}</div></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Clientes</span><span class="kpi-ic">${IC_STAMP}</span></div><div class="kpi-val">${cache.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Cartelas em andamento</span><span class="kpi-ic">${IC_STAMP}</span></div><div class="kpi-val">${emAndamento}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Prêmios pendentes</span><span class="kpi-ic">${IC_GIFT}</span></div><div class="kpi-val"${premios ? ' style="color:var(--gold)"' : ''}>${premios}</div></div>
    </div>
    <div style="margin-bottom:14px"><input type="text" class="form-control" placeholder="Buscar por nome ou telefone..." value="${esc(busca)}" oninput="fidelidadeBuscar(this.value)"></div>
    <div id="fid-lista">${linhas()}</div>`;
}

function linhas() {
  const termo = busca.trim().toLowerCase();
  const lista = termo
    ? cache.filter(c => [c.nome, c.celular].some(v => (v || '').toLowerCase().includes(termo)))
    : cache;
  if (!lista.length) {
    return `<div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_STAMP}</div><p>${termo ? 'Nenhuma cliente encontrada' : 'Nenhuma cliente com fidelidade ainda'}</p></div>`;
  }
  // A revendedora usa card com barra (design mobile); a tabela tem min-width
  // 560px e no celular dela só existiria rolando de lado. Mesmos campos.
  if (!ehStaff()) {
    return lista.map(c => `
      <div class="fid-card" onclick="abrirCliente('${escAttrJs(c.id)}')">
        <div class="fid-card-topo">
          <div class="fid-card-nome">${esc(c.nome)}</div>
          <div class="fid-card-selos">${c.selos}/10${c.premios ? ` · ${c.premios} prêmio${c.premios > 1 ? 's' : ''}` : ''}</div>
        </div>
        <div class="fid-card-tel">${esc(telFmt(c.celular))}${telRuim(c.celular) ? ' <span class="badge badge-pendente" title="Número fora do padrão — esta cartela pode misturar mais de uma pessoa.">Telefone inválido</span>' : ''}</div>
        <div class="fid-bar"><div style="width:${Math.min(100, c.selos * 10)}%"></div></div>
      </div>`).join('');
  }

  return `<div class="pag-wrap"><table class="pag-table"><thead><tr>
    <th class="pag-th">Cliente</th><th class="pag-th">Telefone</th><th class="pag-th" style="text-align:center">Selos</th><th class="pag-th"></th>
  </tr></thead><tbody>${lista.map(c => `
    <tr class="pag-row" style="cursor:pointer" onclick="abrirCliente('${escAttrJs(c.id)}')">
      <td class="pag-td"><span class="ciclo-desc">${esc(c.nome)}</span></td>
      <td class="pag-td">${esc(telFmt(c.celular))}${telRuim(c.celular) ? '<span class="badge badge-pendente" style="margin-left:6px" title="Número fora do padrão — esta cartela pode misturar mais de uma pessoa.">Telefone inválido</span>' : ''}</td>
      <td class="pag-td" style="text-align:center"><span class="fid-progresso">${c.selos}/10</span></td>
      <td class="pag-td" style="text-align:right">${c.premios ? `<span class="badge badge-aberta" style="color:var(--gold);border-color:var(--gold)">${IC_GIFT} Prêmio</span>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

export function fidelidadeBuscar(v) {
  busca = v;
  const el = document.getElementById('fid-lista');
  if (el) el.innerHTML = linhas(); else render();
}
