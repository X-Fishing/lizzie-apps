// Auditoria de exclusões (só admin) — consulta o audit_log alimentado por
// gatilhos de banco (supabase/migrations/0059_audit_log_exclusoes.sql).
// Tela só de LEITURA: nenhuma ação de escrita aqui de propósito.
import { sb } from './supabase.js';
import { esc, sbQ, openModal } from './utils.js';
import { IS_ADMIN } from './menu.js';

const IC_EYE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" width="15" height="15"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const IC_EMPTY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
const IC_LOCK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

const TABELAS = ['maletas', 'consignados', 'vendas', 'venda_itens', 'venda_pagamentos', 'recebimentos',
  'produtos', 'clientes', 'financeiro_lancamentos', 'fidelidade_selos', 'fidelidade_cartelas', 'fidelidade_premios'];
const TABELA_LABEL = {
  maletas: 'Maletas', consignados: 'Peças do catálogo', vendas: 'Vendas', venda_itens: 'Itens de venda',
  venda_pagamentos: 'Pagamentos', recebimentos: 'Recebimentos', produtos: 'Produtos', clientes: 'Clientes',
  financeiro_lancamentos: 'Financeiro', fidelidade_selos: 'Selos de fidelidade',
  fidelidade_cartelas: 'Cartelas de fidelidade', fidelidade_premios: 'Prêmios de fidelidade',
};

let AUDIT = [];
let fTabela = '', fDe = '', fAte = '';

const panel = () => document.getElementById('panel-auditoria');
const HTML_RESTRITO = `<div class="empty-state"><div class="empty-icon">${IC_LOCK}</div><p>Área restrita ao administrador.</p></div>`;
const HTML_LOADING = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
const HTML_ERRO = `<div class="empty-state"><div class="empty-icon">${IC_EMPTY}</div><p>Erro ao carregar. Já rodou a migração <b>0059_audit_log_exclusoes.sql</b> no Supabase?</p></div>`;

function fmtDataHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function resumoRegistro(a) {
  const d = a.dados || {};
  return d.descricao || d.nome || d.nome_cliente || d.numero || a.registro_id || '—';
}

async function carregarAuditoria() {
  let q = sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
  if (fTabela) q = q.eq('tabela', fTabela);
  if (fDe) q = q.gte('created_at', fDe + 'T00:00:00');
  if (fAte) q = q.lte('created_at', fAte + 'T23:59:59.999');
  const { data, error } = await sbQ(q);
  if (error) { console.error('Erro ao carregar audit_log:', error); return false; }
  AUDIT = data || [];
  return true;
}

export async function loadAuditoria() {
  if (!IS_ADMIN) { panel().innerHTML = HTML_RESTRITO; return; }
  panel().innerHTML = HTML_LOADING;
  if (!await carregarAuditoria()) { panel().innerHTML = HTML_ERRO; return; }
  renderAuditoria();
}

export async function auditFiltrar() {
  fTabela = document.getElementById('audit-f-tabela').value;
  fDe = document.getElementById('audit-f-de').value;
  fAte = document.getElementById('audit-f-ate').value;
  if (!await carregarAuditoria()) { panel().innerHTML = HTML_ERRO; return; }
  renderAuditoria();
}

function renderAuditoria() {
  const filtros = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <select id="audit-f-tabela" class="form-control" style="max-width:220px" onchange="auditFiltrar()">
      <option value="">Todas as tabelas</option>
      ${TABELAS.map(t => `<option value="${t}" ${fTabela === t ? 'selected' : ''}>${TABELA_LABEL[t] || t}</option>`).join('')}
    </select>
    <input type="date" id="audit-f-de" class="form-control" style="max-width:160px" value="${fDe}" onchange="auditFiltrar()" title="De">
    <input type="date" id="audit-f-ate" class="form-control" style="max-width:160px" value="${fAte}" onchange="auditFiltrar()" title="Até">
  </div>`;

  const temFiltro = fTabela || fDe || fAte;
  const rows = AUDIT.length ? AUDIT.map(a => `
    <tr class="ciclo-row" style="cursor:pointer" onclick="auditVerDetalhe('${a.id}')">
      <td class="ciclo-td" style="white-space:nowrap;font-size:12.5px">${fmtDataHora(a.created_at)}</td>
      <td class="ciclo-td">${esc(a.ator_nome || '—')}</td>
      <td class="ciclo-td"><span class="ciclo-badge">${esc(TABELA_LABEL[a.tabela] || a.tabela)}</span></td>
      <td class="ciclo-td">${esc(String(resumoRegistro(a)))}</td>
      <td class="ciclo-td" style="text-align:right">
        <button class="btn-icon" title="Ver dado apagado" style="color:var(--rose)" onclick="event.stopPropagation();auditVerDetalhe('${a.id}')">${IC_EYE}</button>
      </td>
    </tr>`).join('') :
    `<tr><td colspan="5"><div class="empty-state" style="padding:24px 0"><div class="empty-icon">${IC_EMPTY}</div><p>Nenhuma exclusão registrada${temFiltro ? ' com esse filtro' : ''}</p></div></td></tr>`;

  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Auditoria</h2><div class="sub">${AUDIT.length} exclus${AUDIT.length !== 1 ? 'ões' : 'ão'} registrada${AUDIT.length !== 1 ? 's' : ''}${AUDIT.length >= 500 ? ' (últimas 500)' : ''}</div></div>
    </div>
    ${filtros}
    <div class="pag-wrap"><table class="pag-table"><thead><tr>
        <th class="pag-th">Quando</th><th class="pag-th">Quem</th><th class="pag-th">Tabela</th>
        <th class="pag-th">Registro</th><th class="pag-th" style="text-align:right">Detalhe</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function auditVerDetalhe(id) {
  const a = AUDIT.find(x => x.id === id);
  if (!a) return;
  document.getElementById('audit-detalhe-content').innerHTML = `
    <div style="margin-bottom:10px;font-size:13px;color:var(--muted)">
      <b>${esc(TABELA_LABEL[a.tabela] || a.tabela)}</b> · apagado por <b>${esc(a.ator_nome || 'desconhecido')}</b> em ${fmtDataHora(a.created_at)}
    </div>
    <pre style="background:var(--blush);border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto">${esc(JSON.stringify(a.dados, null, 2))}</pre>`;
  openModal('modal-audit-detalhe');
}
