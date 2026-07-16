// Precificação — motor de cálculo (portado da planilha "Cadastro Preço"),
// tela de Parâmetros/cotações e Calculadora avulsa.
// Fórmulas (planilha decodificada):
//   ouro ('o'):  custo = ((mao_de_obra + banho) * (cotacao/1000) * peso) + (peca_bruta * (1 - desconto))
//   demais:      custo = ((cotacao/1000) * peso)                          + (peca_bruta * (1 - desconto))
//   custo_verniz = verniz > 0 ? custo + peso * (verniz/1000) : custo
//   preco_sugerido = (custo_verniz * margem) + rateio
// Descontos/percentuais em pontos percentuais (19 = 19%).
import { sb } from './supabase.js';
import { esc, toast, sbQ, fmtBRL, handleSupabaseError, parseMoneyBR, moneyToInput, fetchPaginado, maskMoneyBR, openModal, closeModal, confirmarAcao } from './utils.js';
import { cadastroCache, carregarCadastrosParaSelect } from './cadastros.js';

const r2 = n => Math.round(n * 100) / 100;

// ── Cache de parâmetros/banhos (carregado sob demanda, 1x por sessão) ──
let precifCache = null; // { params, banhos }

export async function carregarPrecificacao(force = false) {
  if (precifCache && !force) return precifCache;
  const [pRes, bRes] = await Promise.all([
    sbQ(sb.from('parametros_precificacao').select('*').eq('id', 1).maybeSingle()),
    sbQ(sb.from('tipos_banho').select('*').order('codigo')),
  ]);
  if (pRes.error || bRes.error) {
    console.error('Precificação (config):', pRes.error || bRes.error);
    return null; // migração 0013 não rodada, provavelmente
  }
  precifCache = {
    params: pRes.data || { mao_de_obra: 3, rateio: 4, margem: 3 },
    banhos: bRes.data || [],
  };
  return precifCache;
}

// ── Motor (puro) ────────────────────────────────────────────────────
export function calcularPrecificacao({ tipoBanho, cotacao, banho = 0, peso = 0, precoBruto = 0, verniz = 0, descontoPct = 0, params }) {
  const p = params || precifCache?.params || { mao_de_obra: 3, rateio: 4, margem: 3 };
  const desconto = Number(descontoPct || 0) / 100;
  const cot = Number(cotacao || 0);
  const brutoLiquido = Number(precoBruto || 0) * (1 - desconto);
  const custo = tipoBanho === 'o'
    ? ((Number(p.mao_de_obra) + Number(banho || 0)) * (cot / 1000) * Number(peso || 0)) + brutoLiquido
    : ((cot / 1000) * Number(peso || 0)) + brutoLiquido;
  const custoVerniz = Number(verniz || 0) > 0 ? custo + Number(peso || 0) * (Number(verniz) / 1000) : custo;
  const precoSugerido = (custoVerniz * Number(p.margem)) + Number(p.rateio);
  return { custo: r2(custo), custoVerniz: r2(custoVerniz), precoSugerido: r2(precoSugerido) };
}

const painelSemConfig = (panelId) => {
  document.getElementById(panelId).innerHTML =
    '<div class="empty-state"><div class="empty-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg></div><p>Configuração de precificação não encontrada — rode a migração <b>0013_precificacao.sql</b> no Supabase.</p></div>';
};

// ═══════════════════════════════════════════════════════════════════
// TELA "PRECIFICAÇÃO" (Cadastros): parâmetros globais + cotações
// ═══════════════════════════════════════════════════════════════════
export async function loadPrecificacao() {
  const panel = document.getElementById('panel-precificacao');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const cfg = await carregarPrecificacao(true);
  if (!cfg) { painelSemConfig('panel-precificacao'); return; }
  const { params, banhos } = cfg;

  panel.innerHTML = `
    <div class="page-head"><div>
      <h2>Precificação</h2>
      <div class="sub">Parâmetros do cálculo de custo e preço sugerido</div>
    </div></div>

    <div class="dash-card" style="margin-bottom:16px">
      <h3>Parâmetros globais</h3>
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label class="form-label">Mão de obra</label>
          <input type="number" step="0.01" id="pp-mao" class="form-control" value="${params.mao_de_obra}"></div>
        <div class="form-group"><label class="form-label">Rateio (R$ somado ao preço)</label>
          <input type="number" step="0.01" id="pp-rateio" class="form-control" value="${params.rateio}"></div>
        <div class="form-group"><label class="form-label">Margem (multiplicador do custo)</label>
          <input type="number" step="0.01" id="pp-margem" class="form-control" value="${params.margem}"></div>
      </div>
      <button class="btn btn-primary" onclick="precifSalvarParams(this)">Salvar parâmetros</button>
    </div>

    <div class="dash-card">
      <h3>Cotações por tipo de banho</h3>
      <div class="dash-sub">A cotação do ouro muda — os produtos guardam a cotação usada no cadastro (snapshot); use a reprecificação para atualizar em massa (próxima etapa).</div>
      <div class="pag-wrap" style="margin-top:10px"><table class="pag-table"><thead><tr>
        <th class="pag-th">Código</th><th class="pag-th">Nome</th><th class="pag-th">Cotação</th>
        <th class="pag-th">Sufixo no nome</th><th class="pag-th" style="text-align:center">Ativo</th>
      </tr></thead><tbody>
        ${banhos.map(b => `<tr class="ciclo-row">
          <td class="ciclo-td"><span class="ciclo-ref">${esc(b.codigo)}</span></td>
          <td class="ciclo-td"><input type="text" class="form-control" style="padding:6px 10px" id="tb-nome-${esc(b.codigo)}" value="${esc(b.nome)}"></td>
          <td class="ciclo-td"><input type="number" step="0.0001" class="form-control" style="padding:6px 10px;width:120px" id="tb-cot-${esc(b.codigo)}" value="${b.cotacao}">
            ${Number(b.cotacao) >= 99999 ? '<div style="font-size:10px;color:var(--warning);font-weight:600" title="Herdado da planilha para inviabilizar este banho — defina a cotação real ou desative">⚠ valor de bloqueio — revisar</div>' : ''}</td>
          <td class="ciclo-td"><input type="text" class="form-control" style="padding:6px 10px" id="tb-suf-${esc(b.codigo)}" value="${esc(b.sufixo_nome || '')}" placeholder="— nada —"></td>
          <td class="ciclo-td" style="text-align:center"><input type="checkbox" id="tb-atv-${esc(b.codigo)}" ${b.ativo ? 'checked' : ''}></td>
        </tr>`).join('')}
      </tbody></table></div>
      <button class="btn btn-primary" style="margin-top:12px" onclick="precifSalvarBanhos(this)">Salvar cotações</button>
    </div>`;
}

export async function precifSalvarParams(btn) {
  const payload = {
    id: 1,
    mao_de_obra: parseFloat(document.getElementById('pp-mao').value) || 0,
    rateio: parseFloat(document.getElementById('pp-rateio').value) || 0,
    margem: parseFloat(document.getElementById('pp-margem').value) || 0,
    updated_at: new Date().toISOString(),
  };
  if (payload.margem <= 0) { toast('Margem deve ser maior que zero.'); return; }
  btn.disabled = true;
  const { error } = await sbQ(sb.from('parametros_precificacao').upsert(payload));
  btn.disabled = false;
  if (error) { console.error('Parâmetros:', error); if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) return; }
  precifCache = null; // força recarga no próximo cálculo
  toast('Parâmetros salvos!');
}

export async function precifSalvarBanhos(btn) {
  const cfg = precifCache;
  if (!cfg) return;
  const rows = cfg.banhos.map(b => ({
    codigo: b.codigo,
    nome: document.getElementById(`tb-nome-${b.codigo}`).value.trim() || b.nome,
    cotacao: parseFloat(document.getElementById(`tb-cot-${b.codigo}`).value) || 0,
    sufixo_nome: document.getElementById(`tb-suf-${b.codigo}`).value.trim() || null,
    ativo: document.getElementById(`tb-atv-${b.codigo}`).checked,
  }));
  btn.disabled = true;
  const { error } = await sbQ(sb.from('tipos_banho').upsert(rows));
  btn.disabled = false;
  if (error) { console.error('Cotações:', error); if (await handleSupabaseError(error, `Erro ao salvar: ${error.message}`)) return; }
  precifCache = null;
  toast('Cotações salvas!');
}

// ═══════════════════════════════════════════════════════════════════
// CALCULADORA (simulador avulso — não grava nada)
// ═══════════════════════════════════════════════════════════════════
export async function loadCalculadora() {
  const panel = document.getElementById('panel-calculadora');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const cfg = await carregarPrecificacao();
  if (!cfg) { painelSemConfig('panel-calculadora'); return; }
  await carregarCadastrosParaSelect(); // fornecedores (com desconto)

  panel.innerHTML = `
    <div class="page-head"><div>
      <h2>Calculadora de custo</h2>
      <div class="sub">Simulador rápido de 1 peça — para lançar remessas use Vendas → Entrada de Mercadoria</div>
    </div></div>
    <div class="dash-card" style="max-width:640px">
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Fornecedor</label>
          <select id="calc-forn" class="form-control" onchange="calcularSimulacao()">
            <option value="">— sem fornecedor (0%) —</option>
            ${(cadastroCache.fornecedores || []).filter(f => f.ativo !== false).map(f =>
              `<option value="${f.desconto || 0}">${esc(f.nome)}${Number(f.desconto) ? ` (${Number(f.desconto)}% desc.)` : ''}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Tipo de banho</label>
          <select id="calc-banho-tipo" class="form-control" onchange="calcularSimulacao()">
            ${cfg.banhos.filter(b => b.ativo).map(b => `<option value="${esc(b.codigo)}" data-cotacao="${b.cotacao}">${esc(b.nome)}</option>`).join('')}
          </select></div>
        <div class="form-group" id="calc-wrap-banho"><label class="form-label">Banho (milésimos — só ouro)</label>
          <input type="number" step="0.01" id="calc-banho" class="form-control" value="0" oninput="calcularSimulacao()"></div>
        <div class="form-group"><label class="form-label">Peso (g)</label>
          <input type="number" step="0.01" id="calc-peso" class="form-control" value="0" oninput="calcularSimulacao()"></div>
        <div class="form-group"><label class="form-label">Peça bruta (R$)</label>
          <input type="text" id="calc-bruto" class="form-control" inputmode="numeric" placeholder="0,00" oninput="maskMoneyBR(this);calcularSimulacao()"></div>
        <div class="form-group"><label class="form-label">Verniz</label>
          <input type="number" step="0.01" id="calc-verniz" class="form-control" value="0" oninput="calcularSimulacao()"></div>
      </div>
      <div id="calc-resultado" style="margin-top:8px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--blush);display:flex;gap:22px;flex-wrap:wrap">
        <span>Custo<br><b id="calc-r-custo" style="font-size:17px;color:var(--plum)">${fmtBRL(0)}</b></span>
        <span>Custo c/ verniz<br><b id="calc-r-verniz" style="font-size:17px;color:var(--plum)">${fmtBRL(0)}</b></span>
        <span>Preço sugerido<br><b id="calc-r-sugerido" style="font-size:17px;color:var(--rose)">${fmtBRL(0)}</b></span>
      </div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:8px">
        Margem ×${cfg.params.margem} + rateio ${fmtBRL(cfg.params.rateio)} · mão de obra ${cfg.params.mao_de_obra} (ouro)
      </div>
    </div>`;
  calcularSimulacao();
}

// ═══════════════════════════════════════════════════════════════════
// ENTRADA DE MERCADORIA (grade estilo planilha): chegou a remessa do
// fornecedor — pesa peça a peça, confere o cálculo ao vivo e "Lançar"
// cadastra TODOS os produtos de uma vez (tudo-ou-nada, com snapshot).
// Rascunho persistido em localStorage (recarregar não perde o lote).
// ═══════════════════════════════════════════════════════════════════
let loteRows = [];
let loteProxSku = 1000;
let loteSkusExistentes = new Set(); // SKUs já no catálogo (checagem ao vivo)

const RASCUNHO_KEY = 'lizzie-entrada-mercadoria-rascunho';

function rascunhoSalvar() {
  try {
    localStorage.setItem(RASCUNHO_KEY, JSON.stringify({
      fornecedorId: document.getElementById('lote-forn')?.value || '',
      data: document.getElementById('lote-data')?.value || '',
      obs: document.getElementById('lote-obs')?.value || '',
      rows: loteRows,
    }));
  } catch { /* storage cheio/indisponível: segue sem rascunho */ }
}
function rascunhoLer() {
  try { return JSON.parse(localStorage.getItem(RASCUNHO_KEY) || 'null'); } catch { return null; }
}
function rascunhoLimpar() { try { localStorage.removeItem(RASCUNHO_KEY); } catch { /* ok */ } }

async function loteCarregarProximoSku() {
  // SKU automático: maior SKU numérico existente + 1 (e set p/ duplicidade)
  const { data } = await fetchPaginado(() => sb.from('produtos').select('sku').order('id'));
  loteSkusExistentes = new Set((data || []).map(p => (p.sku || '').trim()).filter(Boolean));
  const max = (data || []).reduce((m, p) => {
    const n = /^\d+$/.test(p.sku || '') ? parseInt(p.sku) : 0;
    return n > m ? n : m;
  }, 0);
  loteProxSku = max + 1;
}

export async function loadEntradaMercadoria() {
  const panel = document.getElementById('panel-entrada-mercadoria');
  panel.innerHTML = '<div class="loading"><div class="spinner">⟳</div><br>Carregando...</div>';
  const cfg = await carregarPrecificacao();
  if (!cfg) { painelSemConfig('panel-entrada-mercadoria'); return; }
  await carregarCadastrosParaSelect();
  await loteCarregarProximoSku();

  const rasc = rascunhoLer();
  loteRows = rasc?.rows || [];
  // Saneia rascunhos gravados com a trava antiga: banhoManual=true sem um
  // valor real digitado (0) voltava a bloquear o padrão da categoria p/ sempre.
  loteRows.forEach(r => { if (r.banhoManual && !(Number(r.banho) > 0)) r.banhoManual = false; });

  panel.innerHTML = `
    <div class="page-head"><div>
      <h2>Entrada de Mercadoria</h2>
      <div class="sub">Lance a remessa inteira como na planilha — cálculo ao vivo, produtos criados de uma vez</div>
    </div></div>
    <div class="dash-card" style="margin-bottom:14px">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="margin:0;min-width:230px"><label class="form-label">Fornecedor do lote *</label>
          <select id="lote-forn" class="form-control" onchange="loteRecalcTudo()">
            <option value="">— sem fornecedor (0%) —</option>
            ${(cadastroCache.fornecedores || []).filter(f => f.ativo !== false).map(f =>
              `<option value="${f.id}" ${rasc?.fornecedorId === String(f.id) ? 'selected' : ''}>${esc(f.nome)}${Number(f.desconto) ? ` (${Number(f.desconto)}% desc.)` : ''}</option>`).join('')}
          </select></div>
        <div class="form-group" style="margin:0"><label class="form-label">Data da entrada</label>
          <input type="date" id="lote-data" class="form-control" value="${rasc?.data || new Date().toISOString().slice(0, 10)}" onchange="loteRecalcTudo()"></div>
        <div class="form-group" style="margin:0;flex:1;min-width:180px"><label class="form-label">Observação do lote</label>
          <input type="text" id="lote-obs" class="form-control" placeholder="opcional" value="${esc(rasc?.obs || '')}" oninput="loteRecalcTudo()"></div>
      </div>
      <div class="btn-group" style="margin-top:12px">
        <button class="btn btn-outline" onclick="loteAdd()">+ Adicionar linha</button>
        <button class="btn btn-outline" onclick="entradaColarAbrir()">Colar da planilha</button>
        <button class="btn btn-outline" onclick="loteArredondarTodos()" title="Arredonda os preços finais não editados para cima, terminando em 9">Arredondar p/ final 9</button>
        <button class="btn btn-danger" onclick="entradaLimparLote()" title="Descarta todas as linhas e o rascunho salvo">Limpar lote</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Enter na última linha adiciona outra · Tab navega · rascunho salvo automaticamente</div>
    </div>
    <div id="lote-wrap"></div>`;
  loteRender();
}

function loteNovaLinha() {
  return {
    sku: String(loteProxSku++),
    categoriaId: '', modelo: '', tipo: '', banho: 0, banhoManual: false, verniz: 0,
    qntd: 1, codForn: '', pecaBruta: 0, peso: 0,
    precoFinal: null, precoManual: false,
  };
}

// DECISÃO (Rondon): a descrição do produto é EXATAMENTE o que for digitado
// no campo Descrição — sem prefixo de categoria e sem sufixo de banho.
// (A composição automática "categ + modelo + sufixo" foi removida.)

function loteCalc(r) {
  const banhoCfg = (precifCache?.banhos || []).find(b => b.codigo === r.tipo);
  const forn = (cadastroCache.fornecedores || []).find(f => String(f.id) === String(document.getElementById('lote-forn')?.value));
  const descontoPct = Number(forn?.desconto) || 0;
  const res = calcularPrecificacao({
    tipoBanho: r.tipo, cotacao: Number(banhoCfg?.cotacao) || 0,
    banho: r.banho, peso: r.peso, precoBruto: r.pecaBruta, verniz: r.verniz,
    descontoPct, params: precifCache?.params,
  });
  return { ...res, cotacao: Number(banhoCfg?.cotacao) || 0, descontoPct };
}

function loteSkuDuplicado(sku, idx) {
  const s = (sku || '').trim();
  if (!s) return false;
  if (loteSkusExistentes.has(s)) return true;
  return loteRows.some((r, j) => j !== idx && (r.sku || '').trim() === s);
}

function loteRender() {
  const wrap = document.getElementById('lote-wrap');
  if (!wrap) return;
  const inp = (i, campo, valor, extra = '') =>
    `<input class="form-control" value="${esc(valor ?? '')}" ${extra} oninput="loteSet(${i},'${campo}',this.value,this)" onkeydown="loteTecla(event,${i})">`;
  const linhas = loteRows.map((r, i) => {
    const c = loteCalc(r);
    return `<tr class="ciclo-row">
      <td class="ciclo-td">${inp(i, 'sku', r.sku, `id="lote-sku-${i}" style="${loteSkuDuplicado(r.sku, i) ? 'border-color:var(--danger);color:var(--danger)' : ''}" title="${loteSkuDuplicado(r.sku, i) ? 'SKU duplicado!' : ''}"`)}</td>
      <td class="ciclo-td"><select class="form-control" onchange="loteSet(${i},'categoriaId',this.value)">
        <option value="">categ...</option>
        ${(cadastroCache.categorias || []).filter(x => x.ativo !== false).map(x => `<option value="${x.id}" ${String(x.id) === String(r.categoriaId) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}
      </select></td>
      <td class="ciclo-td">${inp(i, 'modelo', r.modelo, 'placeholder="descrição completa da peça"')}</td>
      <td class="ciclo-td"><select class="form-control" onchange="loteSet(${i},'tipo',this.value)">
        <option value="">tipo...</option>
        ${(precifCache?.banhos || []).filter(b => b.ativo).map(b => `<option value="${esc(b.codigo)}" ${r.tipo === b.codigo ? 'selected' : ''}>${esc(b.codigo)} — ${esc(b.nome)}</option>`).join('')}
      </select></td>
      <td class="ciclo-td">${inp(i, 'banho', r.banho, `type="number" step="0.01" ${r.tipo === 'o' ? '' : 'disabled'}`)}</td>
      <td class="ciclo-td">${inp(i, 'verniz', r.verniz, 'type="number" step="0.01"')}</td>
      <td class="ciclo-td">${inp(i, 'qntd', r.qntd, 'type="number" min="1"')}</td>
      <td class="ciclo-td">${inp(i, 'codForn', r.codForn)}</td>
      <td class="ciclo-td">${inp(i, 'pecaBruta', r.pecaBruta ? moneyToInput(r.pecaBruta) : '', 'inputmode="numeric" placeholder="0,00" onfocus="this.select()"')}</td>
      <td class="ciclo-td">${inp(i, 'peso', r.peso || '', 'type="number" step="0.01" placeholder="g"')}</td>
      <td class="ciclo-td td-num"><span id="lote-custo-${i}">${fmtBRL(c.custo)}</span></td>
      <td class="ciclo-td td-num"><span id="lote-cverniz-${i}">${fmtBRL(c.custoVerniz)}</span></td>
      <td class="ciclo-td td-num" style="color:var(--muted)"><span id="lote-sug-${i}">${fmtBRL(c.precoSugerido)}</span></td>
      <td class="ciclo-td"><input class="form-control" style="font-weight:600;color:var(--rose)" id="lote-preco-${i}"
        inputmode="numeric" value="${r.precoManual && r.precoFinal != null ? moneyToInput(r.precoFinal) : moneyToInput(c.precoSugerido)}" oninput="loteSet(${i},'precoFinal',this.value,this)" onkeydown="loteTecla(event,${i})"></td>
      <td class="ciclo-td" style="white-space:nowrap">
        <button class="btn-icon" style="color:var(--rose)" title="Duplicar linha (gera SKU novo)" onclick="loteDuplicar(${i})"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
        <button class="btn-icon" style="color:var(--danger)" title="Remover linha" onclick="loteRemover(${i})">✕</button>
      </td>
    </tr>`;
  }).join('');

  // Totais do lote
  const tot = loteRows.reduce((t, r) => {
    const c = loteCalc(r);
    const preco = r.precoManual && r.precoFinal != null ? r.precoFinal : c.precoSugerido;
    t.pecas += r.qntd || 0;
    t.custo += c.custoVerniz * (r.qntd || 0);
    t.venda += preco * (r.qntd || 0);
    return t;
  }, { pecas: 0, custo: 0, venda: 0 });

  wrap.innerHTML = loteRows.length ? `
    <div class="pag-wrap"><table class="pag-table entrada-table">
      <colgroup>
        <col style="width:5.5%"><col style="width:8%"><col style="width:25%"><col style="width:7.5%">
        <col style="width:4.5%"><col style="width:4.5%"><col style="width:4%"><col style="width:6%">
        <col style="width:6.5%"><col style="width:4.5%"><col style="width:5.5%">
        <col style="width:5.5%"><col style="width:5.5%"><col style="width:7%"><col style="width:5%">
      </colgroup>
      <thead><tr>
      <th class="pag-th" title="Código (SKU) — gerado em sequência, editável">Cód.</th>
      <th class="pag-th" title="Categoria (agrupamento e banho padrão — não entra no nome)">Categ</th>
      <th class="pag-th" title="Descrição — é o nome final do produto, exatamente como digitado">Descrição</th>
      <th class="pag-th" title="Tipo de banho (usado na cotação — não entra no nome)">Tipo</th>
      <th class="pag-th" title="Banho (milésimos — só ouro; preenchido pelo padrão da categoria)">Banho</th>
      <th class="pag-th" title="Verniz">Vern.</th>
      <th class="pag-th" title="Quantidade (vai para o estoque)">Qtd</th>
      <th class="pag-th" title="Código no fornecedor">C. Forn</th>
      <th class="pag-th" title="Peça bruta (R$)">P. Bruta</th>
      <th class="pag-th" title="Peso em gramas">Peso</th>
      <th class="pag-th td-num" title="Custo calculado">Custo</th>
      <th class="pag-th td-num" title="Custo com verniz">C/ Vern.</th>
      <th class="pag-th td-num" title="Preço sugerido (margem + rateio)">Sug.</th>
      <th class="pag-th" title="Preço final (editável — arredondamento comercial)">Preço</th>
      <th class="pag-th"></th>
    </tr></thead><tbody>${linhas}</tbody></table></div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:6px">A descrição é exatamente o que você digitar — inclua o banho no texto se quiser diferenciar (ex.: "... Ouro 18 k"). Escolher a categoria preenche os milésimos padrão dela.</div>
    <div class="dash-card" style="margin-top:12px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--muted)">${loteRows.length} linha${loteRows.length > 1 ? 's' : ''} · <b id="lote-tot-pecas" style="color:var(--plum)">${tot.pecas}</b> peças</span>
      <span style="font-size:13px;color:var(--muted)">Custo total: <b id="lote-tot-custo" style="color:var(--plum)">${fmtBRL(tot.custo)}</b></span>
      <span style="font-size:13px;color:var(--muted)">Venda total: <b id="lote-tot-venda" style="color:var(--rose)">${fmtBRL(tot.venda)}</b></span>
      <button class="btn btn-primary" style="margin-left:auto" onclick="loteLancar(this)">Lançar ${loteRows.length} produto${loteRows.length > 1 ? 's' : ''}</button>
    </div>` :
    '<div class="empty-state" style="padding:30px 0"><p style="font-size:13px">Nenhuma linha ainda — use "+ Adicionar linha" ou "Colar da planilha".</p></div>';
  rascunhoSalvar();
}

// Descarta o lote atual + rascunho (o rascunho restaura sozinho ao recarregar;
// sem este botão, uma linha antiga de teste "assombra" a tela para sempre).
export function entradaLimparLote() {
  if (!loteRows.length) { rascunhoLimpar(); return; }
  confirmarAcao('Limpar lote', `Descartar ${loteRows.length} linha${loteRows.length > 1 ? 's' : ''} e o rascunho salvo? Nada foi lançado ainda.`, 'Limpar', () => {
    loteRows = [];
    rascunhoLimpar();
    loteRender();
    toast('Lote limpo.');
  });
}

export function loteDuplicar(i) {
  const r = loteRows[i];
  if (!r) return;
  loteRows.splice(i + 1, 0, { ...r, sku: String(loteProxSku++) });
  loteRender();
}

// Enter na última linha adiciona a próxima (fluxo de digitação contínua)
export function loteTecla(e, i) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (i === loteRows.length - 1) loteAdd();
  }
}

// Arredonda para CIMA até o próximo preço terminado em 9 (ex.: 87,35 → 89,00).
// Só mexe nos preços que você ainda não editou manualmente.
export function loteArredondarTodos() {
  loteRows.forEach(r => {
    if (r.precoManual) return;
    const c = loteCalc(r);
    let alvo = Math.ceil(c.precoSugerido);
    while (alvo % 10 !== 9) alvo++;
    r.precoFinal = alvo; r.precoManual = true;
  });
  loteRender();
  toast('Preços arredondados para o próximo final 9 (os editados à mão não mudaram).');
}

// ── Colar da planilha (Excel/Sheets): uma linha por peça, colunas na
// ordem da grade: SKU | Categ | Modelo | Tipo | Banho | Verniz | Qntd |
// Cód.Forn | Peça bruta | Peso. SKU vazio = gera automático.
export function entradaColarAbrir() {
  document.getElementById('cad-modal-titulo').textContent = 'Colar da planilha';
  document.getElementById('cad-modal-body').innerHTML = `
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">
      Cole as linhas copiadas do Excel/Sheets (separadas por Tab), nesta ordem de colunas:<br>
      <b>SKU · Categ · Descrição · Tipo (o/b/n/p/d) · Banho · Verniz · Qntd · Cód.Forn · Peça bruta · Peso</b><br>
      SKU vazio gera automático; a categoria casa pelo nome; a descrição vira o nome exato do produto.
    </div>
    <textarea id="colar-texto" class="form-control" rows="8" placeholder="cole aqui..."></textarea>`;
  document.getElementById('cad-modal-salvar').setAttribute('onclick', 'entradaColarProcessar()');
  openModal('modal-cadastro');
}

export function entradaColarProcessar() {
  const num = s => parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')) || 0;
  // NÃO trimar a linha inteira: SKU vazio vem como TAB inicial e o trim o
  // removeria, deslocando todas as colunas 1 posição à esquerda.
  const linhas = (document.getElementById('colar-texto').value || '')
    .split(/\r?\n/).filter(l => l.trim() !== '');
  if (!linhas.length) { toast('Nada para colar.'); return; }
  let ok = 0;
  for (const linha of linhas) {
    const c = linha.split('\t').map(x => x.trim());
    const [sku, categNome, modelo, tipoRaw, banho, verniz, qntd, codForn, pecaBruta, peso] = c;
    const cat = (cadastroCache.categorias || []).find(x => (x.nome || '').toLowerCase() === (categNome || '').toLowerCase());
    const tipoLower = (tipoRaw || '').toLowerCase();
    const banhoCfg = (precifCache?.banhos || []).find(b => b.codigo === tipoLower || (b.nome || '').toLowerCase() === tipoLower);
    const r = loteNovaLinha();
    if (sku) { r.sku = sku; } // senão fica o automático já gerado
    r.categoriaId = cat?.id || '';
    r.modelo = modelo || '';
    r.tipo = banhoCfg?.codigo || '';
    // '0' colado (padrão das planilhas p/ peças sem milesimagem) NÃO é valor
    // manual — só banho > 0 trava o automático da categoria.
    if (num(banho) > 0) { r.banho = num(banho); r.banhoManual = true; }
    else r.banho = Number(cat?.banho_padrao) || 0; // padrão da categoria
    r.verniz = num(verniz);
    r.qntd = Math.max(1, parseInt(qntd) || 1);
    r.codForn = codForn || '';
    r.pecaBruta = num(pecaBruta); r.peso = num(peso);
    loteRows.push(r);
    ok++;
  }
  closeModal('modal-cadastro');
  loteRender();
  toast(`${ok} linha${ok > 1 ? 's' : ''} adicionada${ok > 1 ? 's' : ''} — confira categorias e tipos antes de lançar.`);
}

export function loteAdd() {
  loteRows.push(loteNovaLinha());
  loteRender();
}

export function loteRemover(i) {
  loteRows.splice(i, 1);
  loteRender();
}

export function loteRecalcTudo() { loteRender(); }

export function loteSet(i, campo, valor, el) {
  const r = loteRows[i];
  if (!r) return;
  if (campo === 'pecaBruta') {
    if (el) { maskMoneyBR(el); r.pecaBruta = parseMoneyBR(el.value); }
  } else if (campo === 'precoFinal') {
    if (el) { maskMoneyBR(el); r.precoFinal = parseMoneyBR(el.value); r.precoManual = true; }
  } else if (campo === 'banho') {
    if (String(valor).trim() === '') {
      // campo APAGADO = "volta ao automático": destrava e reaplica o padrão
      const cat = (cadastroCache.categorias || []).find(x => String(x.id) === String(r.categoriaId));
      r.banho = Number(cat?.banho_padrao) || 0;
      r.banhoManual = false;
    } else {
      r.banho = parseFloat(valor) || 0;
      r.banhoManual = true; // digitou um valor: o padrão não sobrescreve mais
    }
  } else if (['verniz', 'peso'].includes(campo)) {
    r[campo] = parseFloat(valor) || 0;
  } else if (campo === 'qntd') {
    r.qntd = Math.max(1, parseInt(valor) || 1);
  } else if (campo === 'categoriaId') {
    r.categoriaId = valor;
    // Cada categoria tem sua milesimagem padrão: preenche o Banho sozinho
    // (a menos que o usuário já tenha digitado um valor manual nesta linha).
    const cat = (cadastroCache.categorias || []).find(x => String(x.id) === String(valor));
    if (cat && cat.banho_padrao === undefined) {
      toast('A coluna "banho padrão" não existe no banco — rode a migração 0015 no Supabase.');
    }
    if (!r.banhoManual) r.banho = Number(cat?.banho_padrao) || 0;
  } else {
    r[campo] = valor;
  }
  // recalcula só as células desta linha (sem re-render, p/ não perder o foco)
  const c = loteCalc(r);
  const set = (id, v) => { const cel = document.getElementById(id); if (cel) cel.textContent = v; };
  set(`lote-custo-${i}`, fmtBRL(c.custo));
  set(`lote-cverniz-${i}`, fmtBRL(c.custoVerniz));
  set(`lote-sug-${i}`, fmtBRL(c.precoSugerido));
  if (!r.precoManual) { const p = document.getElementById(`lote-preco-${i}`); if (p) p.value = moneyToInput(c.precoSugerido); }
  // duplicidade de SKU ao vivo (contra catálogo e outras linhas)
  if (campo === 'sku') {
    const s = document.getElementById(`lote-sku-${i}`);
    if (s) {
      const dup = loteSkuDuplicado(r.sku, i);
      s.style.borderColor = dup ? 'var(--danger)' : '';
      s.style.color = dup ? 'var(--danger)' : '';
      s.title = dup ? 'SKU duplicado!' : '';
    }
  }
  loteAtualizarTotais();
  rascunhoSalvar();
  // selects (categ/tipo) mudam estrutura da linha (banho habilita/sufixo do nome)
  if (campo === 'tipo' || campo === 'categoriaId') loteRender();
}

function loteAtualizarTotais() {
  const tot = loteRows.reduce((t, r) => {
    const c = loteCalc(r);
    const preco = r.precoManual && r.precoFinal != null ? r.precoFinal : c.precoSugerido;
    t.pecas += r.qntd || 0; t.custo += c.custoVerniz * (r.qntd || 0); t.venda += preco * (r.qntd || 0);
    return t;
  }, { pecas: 0, custo: 0, venda: 0 });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('lote-tot-pecas', String(tot.pecas));
  set('lote-tot-custo', fmtBRL(tot.custo));
  set('lote-tot-venda', fmtBRL(tot.venda));
}

export async function loteLancar(btn) {
  if (!ehGestor()) { toast('Sem permissão'); return; }
  if (!loteRows.length) { toast('Adicione ao menos uma linha.'); return; }
  const fornId = document.getElementById('lote-forn').value || null;

  // Validação completa ANTES (tudo-ou-nada: com erro, nada é lançado)
  const erros = [];
  loteRows.forEach((r, i) => {
    const n = i + 1;
    if (!r.sku.trim()) erros.push(`Linha ${n}: sem código (SKU).`);
    else if (loteSkuDuplicado(r.sku, i)) erros.push(`Linha ${n}: SKU "${r.sku}" duplicado (no catálogo ou no lote).`);
    if (!r.modelo.trim()) erros.push(`Linha ${n}: a descrição é obrigatória.`);
    if (!r.tipo) erros.push(`Linha ${n}: escolha o tipo de banho.`);
    if (!(r.peso > 0)) erros.push(`Linha ${n}: informe o peso em gramas.`);
    if (!(r.qntd >= 1)) erros.push(`Linha ${n}: quantidade deve ser 1 ou mais.`);
    const c = loteCalc(r);
    const preco = r.precoManual && r.precoFinal != null ? r.precoFinal : c.precoSugerido;
    if (!(preco > 0)) erros.push(`Linha ${n}: preço final deve ser maior que zero.`);
  });
  if (erros.length) {
    console.warn('Entrada de mercadoria — erros de validação:', erros);
    toast(erros.slice(0, 3).join(' ') + (erros.length > 3 ? ` (+${erros.length - 3} erros — veja o console)` : ''));
    loteRender(); // re-marca os SKUs duplicados em vermelho
    return;
  }

  btn.disabled = true; btn.textContent = 'Lançando...';
  const agora = new Date().toISOString();
  const payloads = loteRows.map(r => {
    const c = loteCalc(r);
    const precoFinal = r.precoManual && r.precoFinal != null ? r.precoFinal : c.precoSugerido;
    return {
      nome: r.modelo.trim(), // descrição literal — exatamente como digitada
      sku: r.sku.trim(),
      categoria_id: r.categoriaId || null,
      fornecedor_id: fornId,
      codigo_fornecedor: r.codForn.trim() || null,
      formato: 'simples',
      estoque_qtd: r.qntd,
      deposito: 'Geral',
      preco_venda: precoFinal,
      custo_compra: c.custoVerniz,      // "preço de custo" (como a planilha exportava)
      modelo: r.modelo.trim() || null,
      tipo_banho: r.tipo,
      banho: r.banho, verniz: r.verniz, peso: r.peso,
      preco_bruto: r.pecaBruta || null,
      custo: c.custo, custo_verniz: c.custoVerniz, preco_sugerido: c.precoSugerido,
      cotacao_usada: c.cotacao, desconto_usado: c.descontoPct, precificado_em: agora,
    };
  });
  const { error } = await sbQ(sb.from('produtos').insert(payloads));
  btn.disabled = false; btn.textContent = 'Lançar';
  if (error) {
    console.error('Lançamento em lote:', error);
    if (/duplicate key|unique/i.test(error.message || '')) { toast('SKU já existente no catálogo — confira os códigos.'); return; }
    if (await handleSupabaseError(error, `Erro ao lançar: ${error.message}`)) return;
  }
  // TODO etiquetas: quando a impressão (Zebra/Argox) existir, oferecer aqui
  // "Imprimir etiquetas do lote" com os produtos recém-lançados.
  toast(`${payloads.length} produto${payloads.length > 1 ? 's' : ''} lançado${payloads.length > 1 ? 's' : ''} no catálogo!`);
  loteRows = [];
  rascunhoLimpar();
  await loteCarregarProximoSku();
  loteRender();
}

export function calcularSimulacao() {
  const cfg = precifCache;
  if (!cfg) return;
  const selTipo = document.getElementById('calc-banho-tipo');
  const tipo = selTipo.value;
  const cotacao = parseFloat(selTipo.selectedOptions[0]?.dataset.cotacao) || 0;
  document.getElementById('calc-wrap-banho').style.display = tipo === 'o' ? '' : 'none';
  const r = calcularPrecificacao({
    tipoBanho: tipo, cotacao,
    banho: parseFloat(document.getElementById('calc-banho').value) || 0,
    peso: parseFloat(document.getElementById('calc-peso').value) || 0,
    precoBruto: parseMoneyBR(document.getElementById('calc-bruto').value),
    verniz: parseFloat(document.getElementById('calc-verniz').value) || 0,
    descontoPct: parseFloat(document.getElementById('calc-forn').value) || 0,
    params: cfg.params,
  });
  document.getElementById('calc-r-custo').textContent = fmtBRL(r.custo);
  document.getElementById('calc-r-verniz').textContent = fmtBRL(r.custoVerniz);
  document.getElementById('calc-r-sugerido').textContent = fmtBRL(r.precoSugerido);
}
