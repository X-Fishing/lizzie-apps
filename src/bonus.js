// Bônus de Aniversário: aniversariantes do MÊS (revendedoras + clientes finais)
// com ação "Avisar" via WhatsApp (deep link wa.me, sem API). O rastreio de
// bônus enviado/valor (mockup) depende de infra futura — fora do escopo agora.
import { sb } from './supabase.js';
import { esc, sbQ, isoToBR } from './utils.js';

const IC_CAKE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/></svg>';
const IC_USER = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const IC_WA   = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/></svg>';

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
let lista = [];        // { tipo, nome, telefone, nascimento(ISO) }
let filtro = 'todos';  // todos | revendedora | cliente

const panel = () => document.getElementById('panel-bonus');
const soDigitos = s => (s || '').replace(/\D/g, '');
const diaMes = iso => Number(iso.slice(8, 10));   // p/ ordenar por dia

export async function loadBonus() {
  panel().innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const mes = new Date().getMonth() + 1;
  const mm = String(mes).padStart(2, '0');

  const [{ data: docs }, { data: profs }, { data: clientes }] = await Promise.all([
    sbQ(sb.from('revendedora_docs').select('profile_id,data_nascimento')),   // RLS: só gestor
    sbQ(sb.from('profiles').select('id,nome,telefone').eq('role', 'revendedora').eq('aprovada', true)),
    sbQ(sb.from('clientes').select('nome,celular,data_nascimento')),
  ]);

  const profMap = new Map((profs || []).map(p => [String(p.id), p]));
  lista = [];
  for (const d of (docs || [])) {
    if (!d.data_nascimento || d.data_nascimento.slice(5, 7) !== mm) continue;
    const p = profMap.get(String(d.profile_id));
    if (p) lista.push({ tipo: 'revendedora', nome: p.nome, telefone: p.telefone, nascimento: d.data_nascimento });
  }
  for (const c of (clientes || [])) {
    if (!c.data_nascimento || c.data_nascimento.slice(5, 7) !== mm) continue;
    lista.push({ tipo: 'cliente', nome: c.nome, telefone: c.celular, nascimento: c.data_nascimento });
  }
  lista.sort((a, b) => diaMes(a.nascimento) - diaMes(b.nascimento));
  render(mes);
}

export function bonusFiltro(f) { filtro = f; render(new Date().getMonth() + 1); }

function waLink(tel, nome) {
  const d = soDigitos(tel);
  if (!d) return null;
  const num = d.length <= 11 ? '55' + d : d;
  const msg = `Feliz aniversário, ${nome.split(' ')[0]}! A Lizzie Semijoias preparou um presente especial pra você. 🎁`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

function render(mes) {
  const revs = lista.filter(x => x.tipo === 'revendedora');
  const clis = lista.filter(x => x.tipo === 'cliente');
  const vis = filtro === 'todos' ? lista : lista.filter(x => x.tipo === filtro);

  const chip = (k, txt) => `<button class="chip${filtro === k ? ' active' : ''}" onclick="bonusFiltro('${k}')">${txt}</button>`;
  const badge = t => t === 'revendedora'
    ? '<span class="badge badge-ativo">Revendedora</span>'
    : '<span class="badge badge-pendente" style="background:rgba(201,116,138,.12);color:var(--rose);border-color:var(--rose)">Cliente</span>';

  const rows = vis.length ? vis.map(x => {
    const wa = waLink(x.telefone, x.nome);
    return `<tr class="pag-row">
      <td class="pag-td"><span class="ciclo-desc">${esc(x.nome)}</span></td>
      <td class="pag-td">${badge(x.tipo)}</td>
      <td class="pag-td">${esc(isoToBR(x.nascimento).slice(0, 5))}</td>
      <td class="pag-td">${esc(x.telefone || '—')}</td>
      <td class="pag-td" style="text-align:right">${wa
        ? `<a href="${wa}" target="_blank" rel="noopener" class="btn-secondary btn-sm" style="text-decoration:none;border-color:#25d366;color:#1a7a44">${IC_WA} Avisar</a>`
        : '<span style="font-size:11px;color:var(--muted)">sem telefone</span>'}</td>
    </tr>`;
  }).join('')
    : `<tr><td colspan="5"><div class="empty-state" style="padding:40px 0"><div class="empty-icon">${IC_CAKE}</div><p>Nenhum aniversariante ${filtro !== 'todos' ? 'nesse filtro ' : ''}em ${MESES[mes - 1]}</p></div></td></tr>`;

  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Bônus de Aniversário</h2><div class="sub">Aniversariantes de ${MESES[mes - 1]} — revendedoras e clientes finais</div></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Aniversariantes do mês</span><span class="kpi-ic">${IC_CAKE}</span></div><div class="kpi-val">${lista.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Revendedoras</span><span class="kpi-ic">${IC_USER}</span></div><div class="kpi-val">${revs.length}</div></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Clientes</span><span class="kpi-ic">${IC_USER}</span></div><div class="kpi-val">${clis.length}</div></div>
    </div>
    <div class="chips" style="margin-bottom:14px">${chip('todos', 'Todos')}${chip('revendedora', 'Revendedoras')}${chip('cliente', 'Clientes finais')}</div>
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Nome</th><th class="pag-th">Perfil</th><th class="pag-th">Aniversário</th><th class="pag-th">Telefone</th>
      <th class="pag-th" style="text-align:right">Ação</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:12px">Aniversários de revendedoras vêm do cadastro (só gestores veem). O disparo automático e o registro de bônus enviado entram num ciclo futuro.</div>`;
}
