// Loja do site (Nuvemshop) — conexão, status e vínculo manual dos produtos.
//
// O estoque que vai para o site é o DISPONÍVEL: saldo central menos o que
// está em maleta ativa de revendedora. A conta é feita no banco (RPC
// estoque_disponivel_site); aqui só configuramos a conexão e o de-para
// produto ↔ variante da loja.
//
// O access_token nunca volta do servidor: depois de salvo, a tela só mostra
// "Conectado desde ...". O campo fica sempre vazio.
import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { esc, toast, sbQ, fetchPaginado, handleSupabaseError } from './utils.js';

const IC_LINK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const IC_COPY = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const IC_STORE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m2 7 2-5h16l2 5"/><path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7"/><path d="M2 7h20"/></svg>';

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/nuvemshop-webhook-pedido`;

// Alvo do vínculo em edição: { tipo: 'produto'|'variacao', id, nome }
let vincAlvo = null;
let vincResultados = [];
let semParCache = [];
let filtroSemPar = '';
let semCriarCount = 0;

function panel() { return document.getElementById('panel-nuvemshop'); }

async function chamarFn(caminho, opcoes = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}`,
      ...(opcoes.headers ?? {}),
    },
  });
  const j = await resp.json().catch(() => ({}));
  return { ok: resp.ok && !j.error, status: resp.status, ...j };
}

// ── Tela ────────────────────────────────────────────────────────────
export async function loadNuvemshop() {
  panel().innerHTML = '<div class="loading"><div class="spinner"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div><br>Carregando...</div>';

  const { data: st, error } = await sbQ(sb.rpc('nuvemshop_status'));
  // handleSupabaseError sempre devolve true: sair por ele deixaria o spinner
  // eterno. Chamar para o toast/sessão e renderizar o estado.
  if (error) {
    await handleSupabaseError(error, 'Erro ao ler o status da loja');
    panel().innerHTML = '<div class="empty-state"><p>Não foi possível ler o status da loja. Tente de novo.</p></div>';
    return;
  }
  const status = Array.isArray(st) ? st[0] : st;

  await Promise.all([carregarSemPar(), carregarComFotoSemCriar()]);
  render(status);
}

// Produtos ativos com foto que ainda não existem na loja (nunca tiveram
// nuvemshop_product_id) — candidatos ao "Enviar agora" (criação em massa).
async function carregarComFotoSemCriar() {
  const { count } = await sbQ(sb.from('produtos')
    .select('id', { count: 'exact', head: true })
    .eq('ativo', true)
    .not('foto_url', 'is', null)
    .neq('foto_url', '')
    .is('nuvemshop_product_id', null));
  semCriarCount = count || 0;
}

async function carregarSemPar() {
  const { data: prods } = await fetchPaginado(() => sb.from('produtos')
    .select('id,nome,sku,formato,nuvemshop_variant_id,nuvemshop_sync_status')
    .eq('ativo', true).order('nome'));

  const { data: vars } = await fetchPaginado(() => sb.from('produto_variacoes')
    .select('id,produto_id,atributo,valor,sku,nuvemshop_variant_id'));

  const varsPor = new Map();
  for (const v of (vars || [])) {
    const k = String(v.produto_id);
    if (!varsPor.has(k)) varsPor.set(k, []);
    varsPor.get(k).push(v);
  }

  const lista = [];
  for (const p of (prods || [])) {
    if (p.formato === 'variacao') {
      for (const v of (varsPor.get(String(p.id)) || [])) {
        if (!v.nuvemshop_variant_id) {
          lista.push({ tipo: 'variacao', id: v.id, produto_id: p.id, nome: `${p.nome} — ${v.atributo}: ${v.valor}`, sku: v.sku });
        }
      }
    } else if (!p.nuvemshop_variant_id) {
      lista.push({ tipo: 'produto', id: p.id, nome: p.nome, sku: p.sku });
    }
  }
  semParCache = lista;
}

function render(status) {
  const conectado = !!status?.conectado;
  const desde = status?.conectado_em
    ? new Date(status.conectado_em).toLocaleString('pt-BR')
    : null;

  panel().innerHTML = `
    <div class="page-head">
      <div><h2>Loja do site (Nuvemshop)</h2>
        <div class="sub">O site mostra o estoque disponível — o que está em maleta com revendedora não aparece.</div></div>
    </div>

    <div class="card" style="max-width:560px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="color:var(--rose)">${IC_STORE}</span>
        <b>Conexão</b>
        ${conectado
          ? `<span class="badge badge-ativo" style="margin-left:auto">Conectado</span>`
          : `<span class="badge badge-pendente" style="margin-left:auto">Não conectado</span>`}
      </div>
      ${conectado ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">
        Loja <b>${esc(String(status.store_id ?? ''))}</b> — conectada desde ${esc(desde || '—')}.
        Por segurança o token não é exibido; preencha de novo só para trocá-lo.
      </div>` : ''}

      <div class="form-group"><label class="form-label">ID da loja (store_id)</label>
        <input type="text" id="ns-store" class="form-control" inputmode="numeric"
          placeholder="ex.: 1234567" value="${conectado ? esc(String(status.store_id ?? '')) : ''}"></div>

      <div class="form-group"><label class="form-label">Access token</label>
        <input type="password" id="ns-token" class="form-control" autocomplete="new-password"
          placeholder="${conectado ? 'deixe em branco para manter o atual' : 'cole o token da Nuvemshop'}"></div>

      <button class="btn-primary" style="width:100%" onclick="nuvemshopSalvarToken(this)">Salvar e conectar</button>
    </div>

    <div class="card" style="max-width:560px;margin-bottom:16px">
      <div style="margin-bottom:8px"><b>Webhook de pedidos</b></div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">
        No admin da Nuvemshop, em <b>Configurações → Notificações</b>, cadastre esta URL
        para o evento <b>order/paid</b>. É o que dá baixa no estoque quando a venda sai pelo site.
      </div>
      <div style="display:flex;gap:8px">
        <input type="text" class="form-control" readonly value="${esc(WEBHOOK_URL)}"
          style="flex:1;font-size:12px" onclick="this.select()">
        <button class="btn-secondary btn-sm" onclick="nuvemshopCopiarWebhook(this)">${IC_COPY} Copiar</button>
      </div>
    </div>

    <div class="card" style="max-width:560px;margin-bottom:16px">
      <div style="margin-bottom:8px"><b>Enviar produtos com foto pra Nuvemshop</b></div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">
        Cria na loja os produtos ativos que já têm foto e ainda não existem lá — inclusive os com estoque 0
        (o comportamento deles na vitrine depende de uma configuração da própria loja, não deste botão).
      </div>
      <div id="ns-criar-status" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:13px;color:var(--muted)">
          <b id="ns-criar-contagem">${semCriarCount}</b> produto${semCriarCount !== 1 ? 's' : ''} pendente${semCriarCount !== 1 ? 's' : ''}
        </span>
        <button class="btn-primary btn-sm" style="margin-left:auto${semCriarCount ? '' : ';opacity:.5'}" ${semCriarCount ? '' : 'disabled'}
          onclick="nuvemshopCriarProdutos(this)">${IC_STORE} Enviar agora</button>
      </div>
    </div>

    <div class="card" style="max-width:760px">
      <div style="margin-bottom:8px"><b>Produtos sem vínculo</b>
        <span class="ciclo-badge" style="margin-left:6px">${semParCache.length}</span></div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">
        Enquanto não estiverem vinculados a uma variante da loja, o estoque destes produtos não é enviado ao site.
      </div>
      <div id="ns-sempar">${semParHTML()}</div>
    </div>`;
}

function semParHTML() {
  if (!semParCache.length) {
    return '<div style="font-size:13px;color:var(--muted)">Todos os produtos ativos estão vinculados.</div>';
  }
  // Campo de busca fica FORA de #ns-sempar-lista de propósito: ao filtrar,
  // só a lista é repintada, senão o input perderia o foco a cada tecla.
  return `
    <input type="text" id="ns-sempar-busca" class="form-control" style="margin-bottom:10px"
      placeholder="Filtrar por SKU ou nome..." value="${esc(filtroSemPar)}"
      oninput="nuvemshopFiltrarSemPar(this.value)">
    <div id="ns-sempar-lista">${listaSemParHTML()}</div>
    <div id="ns-vinculo"></div>`;
}

function semParFiltrados() {
  const f = filtroSemPar.trim().toLowerCase();
  if (!f) return semParCache;
  return semParCache.filter(i =>
    (i.sku || '').toLowerCase().includes(f) || (i.nome || '').toLowerCase().includes(f));
}

function listaSemParHTML() {
  const lista = semParFiltrados();
  if (!lista.length) {
    return `<div style="font-size:13px;color:var(--muted)">Nenhum produto sem vínculo casa com "${esc(filtroSemPar)}".</div>`;
  }
  return `<div class="pag-wrap"><table class="pag-table"><thead><tr>
      <th class="pag-th">Produto</th>
      <th class="pag-th">SKU</th>
      <th class="pag-th" style="text-align:right">Vínculo</th>
    </tr></thead><tbody>
    ${lista.slice(0, 200).map(item => `
      <tr class="ciclo-row">
        <td class="ciclo-td"><div class="ciclo-desc">${esc(item.nome)}</div></td>
        <td class="ciclo-td" style="font-size:12.5px;color:var(--muted)">${item.sku ? esc(item.sku) : '—'}</td>
        <td class="ciclo-td" style="text-align:right">
          <button class="btn-secondary btn-sm" onclick="nuvemshopAbrirVinculo('${item.tipo}','${item.id}')">${IC_LINK} Vincular</button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>
    ${lista.length > 200 ? `<div style="font-size:12px;color:var(--muted);margin-top:8px">Mostrando os 200 primeiros de ${lista.length}.</div>` : ''}`;
}

export function nuvemshopFiltrarSemPar(valor) {
  filtroSemPar = valor;
  const alvo = document.getElementById('ns-sempar-lista');
  if (alvo) alvo.innerHTML = listaSemParHTML();
}

// ── Conexão ─────────────────────────────────────────────────────────
export async function nuvemshopSalvarToken(btn) {
  const storeId = document.getElementById('ns-store')?.value.trim();
  const token = document.getElementById('ns-token')?.value.trim();
  if (!storeId) { toast('Informe o ID da loja.'); return; }
  if (!token) { toast('Cole o access token da Nuvemshop.'); return; }

  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando...'; }
  const r = await chamarFn('nuvemshop-set-token', {
    method: 'POST',
    body: JSON.stringify({ store_id: Number(storeId), access_token: token }),
  });
  if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = original; }

  if (!r.ok) { toast('Não conectou: ' + (r.error || r.status)); return; }
  toast('Loja conectada.', 'erro');
  await loadNuvemshop();
}

export function nuvemshopCopiarWebhook(btn) {
  navigator.clipboard.writeText(WEBHOOK_URL).then(() => {
    toast('URL copiada.', 'erro');
  }).catch(() => {
    toast('Não foi possível copiar — selecione e copie à mão.');
  });
  if (btn) btn.blur();
}

// ── Vínculo manual ──────────────────────────────────────────────────
export function nuvemshopAbrirVinculo(tipo, id) {
  const item = semParCache.find(i => i.tipo === tipo && String(i.id) === String(id));
  if (!item) return;
  vincAlvo = item;
  vincResultados = [];
  renderVinculo();
  document.getElementById('ns-busca')?.focus();
  // O SKU costuma ser o mesmo nos dois lados — já busca sozinho pra poupar
  // uma digitação. Sem SKU, fica esperando o texto.
  if (item.sku) nuvemshopBuscar(item.sku);
}

export function nuvemshopFecharVinculo() {
  vincAlvo = null;
  vincResultados = [];
  renderVinculo();
}

function renderVinculo() {
  const alvo = document.getElementById('ns-vinculo');
  if (!alvo) return;
  if (!vincAlvo) { alvo.innerHTML = ''; return; }

  alvo.innerHTML = `
    <div class="card" style="margin-top:14px;background:rgba(201,116,138,0.045)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <b>Vincular: ${esc(vincAlvo.nome)}</b>
        <button class="btn-secondary btn-sm" style="margin-left:auto" onclick="nuvemshopFecharVinculo()">Fechar</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="ns-busca" class="form-control" style="flex:1"
          placeholder="Buscar na loja por nome ou SKU..." value="${esc(vincAlvo.sku || '')}"
          onkeydown="if(event.key==='Enter')nuvemshopBuscar(this.value)">
        <button class="btn-primary btn-sm" onclick="nuvemshopBuscar(document.getElementById('ns-busca').value)">Buscar</button>
      </div>
      <div id="ns-resultados">${resultadosHTML()}</div>
    </div>`;
}

function resultadosHTML() {
  if (!vincResultados.length) {
    return '<div style="font-size:12.5px;color:var(--muted)">Busque o produto na loja e escolha a variante correspondente.</div>';
  }
  return vincResultados.map(p => `
    <div style="padding:10px 0;border-top:1px solid var(--border)">
      <div class="ciclo-desc">${esc(p.nome)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${(p.variantes || []).map(v => `
          <button class="btn-secondary btn-sm"
            onclick="nuvemshopVincular('${p.id}','${v.id}')"
            title="Estoque na loja hoje: ${esc(String(v.stock ?? '—'))}">
            ${esc(v.nome || 'única')}${v.sku ? ` · ${esc(v.sku)}` : ''}
          </button>`).join('')}
      </div>
    </div>`).join('');
}

export async function nuvemshopBuscar(query) {
  const q = (query || '').trim();
  if (!q) { toast('Digite algo para buscar.'); return; }
  const alvo = document.getElementById('ns-resultados');
  if (alvo) alvo.innerHTML = '<div style="font-size:12.5px;color:var(--muted)">Buscando na loja...</div>';

  const r = await chamarFn(`nuvemshop-buscar-produtos?query=${encodeURIComponent(q)}`);
  if (!r.ok) {
    vincResultados = [];
    if (alvo) alvo.innerHTML = `<div style="font-size:12.5px;color:var(--danger)">${esc(r.error || 'Falha na busca')}</div>`;
    return;
  }
  vincResultados = r.produtos || [];
  if (alvo) alvo.innerHTML = vincResultados.length
    ? resultadosHTML()
    : '<div style="font-size:12.5px;color:var(--muted)">Nada encontrado com esse texto.</div>';
}

export async function nuvemshopVincular(productId, variantId) {
  if (!vincAlvo) return;
  const tabela = vincAlvo.tipo === 'variacao' ? 'produto_variacoes' : 'produtos';
  const { error } = await sbQ(sb.from(tabela).update({
    nuvemshop_product_id: Number(productId),
    nuvemshop_variant_id: Number(variantId),
    nuvemshop_sync_status: 'pendente',
    nuvemshop_sync_erro: null,
  }).eq('id', vincAlvo.id));

  if (error) { if (await handleSupabaseError(error, 'Erro ao vincular: ' + error.message)) return; }

  // Enfileira na hora. Sem isto o produto recém-vinculado só iria pro site
  // quando o estoque dele mudasse por acaso (os triggers só olham estoque_qtd).
  const produtoId = vincAlvo.tipo === 'variacao' ? vincAlvo.produto_id : vincAlvo.id;
  const variacaoId = vincAlvo.tipo === 'variacao' ? vincAlvo.id : null;
  const { error: errFila } = await sbQ(sb.rpc('nuvemshop_enfileirar_produto', {
    p_produto_id: produtoId, p_variacao_id: variacaoId,
  }));
  if (errFila) console.error('Enfileirar vínculo:', errFila);

  toast('Produto vinculado — o estoque vai para o site na próxima sincronização.', 'erro');
  vincAlvo = null;
  await loadNuvemshop();
}

// ── Criar produtos novos na loja (em massa) ────────────────────────────
// Chama a Edge Function em lotes até zerar `restantes` — cada chamada processa
// só LOTE produtos (rate limit da Nuvemshop), então a tela dá o progresso.
// Se um lote inteiro falhar sem criar nada, para (evita loop infinito num
// produto que nunca vai passar, ex.: preço inválido).
export async function nuvemshopCriarProdutos(btn) {
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; }

  let totalCriados = 0, totalFalhas = 0;
  const errosVistos = [];
  let restantes = semCriarCount;

  while (restantes > 0) {
    if (btn) btn.textContent = `Enviando... ${totalCriados}/${totalCriados + restantes}`;
    const r = await chamarFn('nuvemshop-criar-produtos', { method: 'POST' });
    if (!r.ok) { toast('Falha ao enviar: ' + (r.error || 'erro desconhecido')); break; }

    totalCriados += r.criados || 0;
    totalFalhas += r.falhas || 0;
    if (r.erros?.length) errosVistos.push(...r.erros);
    restantes = r.restantes ?? 0;

    if (!r.criados && !r.falhas) break; // nada processado neste lote — evita loop infinito
    if (!r.criados && r.falhas) break;  // só falhas, sem progresso — para e mostra o resumo
  }

  if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = original; }

  if (totalCriados || totalFalhas) {
    toast(`${totalCriados} produto${totalCriados !== 1 ? 's' : ''} criado${totalCriados !== 1 ? 's' : ''}` +
      (totalFalhas ? `, ${totalFalhas} com erro — veja a coluna Site em Produtos` : ''), 'erro');
    if (errosVistos.length) console.warn('Criar produtos na Nuvemshop — erros:', errosVistos);
  } else {
    toast('Nada para enviar.');
  }
  await loadNuvemshop();
}
