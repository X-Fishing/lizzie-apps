// Smoke test das telas de cliente, com o Supabase mockado — roda sem login e
// sem tocar no banco de verdade.
//
// POR QUE EXISTE: `npm run build` e `npm run lint` passam verdes com a tela
// quebrada. Um erro bobo (usar o retorno de fetchPaginado como se fosse array)
// deixa a tela presa em "Carregando..." para sempre e nada acusa.
//
// ELE FALHA DE VERDADE: cada checagem é um assert; no primeiro erro o processo
// sai com código 1. Um script que só imprime `console.log` dá falsa sensação
// de segurança e é pior do que não ter teste nenhum.
//
// O mock APLICA os filtros da query (eq / in / not.is / order / offset /
// limit). Sem isso ele seria incapaz de detectar vazamento de escopo — que é
// justamente o que mais importa aqui.
//
// COMO RODAR:
//   npx vite --port 5199 --strictPort        (noutro terminal)
//   node scripts/smoke-clientes.mjs revendedora
//   node scripts/smoke-clientes.mjs admin
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'http://localhost:5199';
const PAPEL = process.argv[2] || 'revendedora';
const EH_STAFF = PAPEL !== 'revendedora';
const UID = EH_STAFF ? 'aaaaaaaa-0000-4000-8000-000000000001' : 'bbbbbbbb-0000-4000-8000-000000000002';
const OUTRA = 'dddddddd-0000-4000-8000-000000000004';
const CLI = 'cccccccc-0000-4000-8000-000000000003';
const CLI_ALHEIA = 'eeeeeeee-0000-4000-8000-000000000005';

// Payloads de ataque: um para contexto HTML, outro para string JS dentro de
// atributo (esc() sozinho NÃO protege o segundo — a entidade &#39; é
// decodificada antes de o JS rodar).
const XSS_HTML = '<img src=x onerror="window.__xss=1">';
const XSS_ATTR = `${CLI}');window.__pwn=1;('`;

let falhas = 0;
function check(nome, ok, detalhe = '') {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${ok || !detalhe ? '' : ' → ' + detalhe}`);
  if (!ok) falhas++;
}

const perfis = [
  { id: UID, nome: 'Fulana Teste', telefone: '11999998888', role: EH_STAFF ? PAPEL : 'revendedora',
    aprovada: true, is_revendedora: !EH_STAFF, teste: false, pode_completar_vendas: false },
  { id: OUTRA, nome: `Rev ${XSS_HTML} Dois`, telefone: '11988887777', role: 'revendedora',
    aprovada: true, is_revendedora: true, teste: false },
];
const clientes = [
  { id: CLI, nome: `Ana ${XSS_HTML} Souza`, celular: '11991234567', email: 'ana@ex.com', cidade: 'Sao Paulo',
    observacao: 'gosta de dourado', aniversario_dia: 29, aniversario_mes: 2, telefone_invalido: false,
    created_at: '2025-03-10T12:00:00Z', criado_por: UID },
  { id: CLI_ALHEIA, nome: 'Vitoria SEGREDO', celular: '21987654321', email: 'vi@secreto.com',
    cidade: 'PetropolisSECRETA', observacao: 'nao pode vazar', aniversario_dia: 7, aniversario_mes: 3,
    telefone_invalido: false, created_at: '2025-01-01T00:00:00Z', criado_por: OUTRA },
];
const vendas = [
  { id: 'v0000001-0000-4000-8000-000000000001', revendedora_id: UID, cliente_id: CLI, nome_cliente: 'Ana',
    data_venda: '2026-01-20', forma_pagamento: 'Pix', valor_total: 300, valor_pago: 300, status: 'quitado', maleta_id: 'm1' },
  { id: 'v0000002-0000-4000-8000-000000000002', revendedora_id: OUTRA, cliente_id: CLI, nome_cliente: 'Ana',
    data_venda: '2026-02-02', forma_pagamento: 'Fiado', valor_total: 200, valor_pago: 0, status: 'pendente', maleta_id: 'm2' },
  { id: 'v0000003-0000-4000-8000-000000000003', revendedora_id: OUTRA, cliente_id: CLI_ALHEIA, nome_cliente: 'Vitoria',
    data_venda: '2026-02-10', forma_pagamento: 'Pix', valor_total: 999, valor_pago: 999, status: 'quitado', maleta_id: 'm2' },
];
const itens = [{ id: 'i1', venda_id: 'v0000001-0000-4000-8000-000000000001', descricao: 'Colar Gota',
  quantidade: 2, preco_unit: 150, created_at: '2026-01-20' }];

const TABELAS = { profiles: perfis, clientes, vendas, venda_itens: itens,
  fidelidade_cartelas: [{ cliente_id: CLI, selos: 4 }],
  fidelidade_premios: [{ cliente_id: CLI, id: XSS_ATTR, valor: 300, status: 'pendente' }],
  maletas: [{ id: 'm1', numero_interno: 7, status: 'ativa', revendedora_id: UID }] };

// Mini-PostgREST: aplica de verdade os filtros da query string.
function consultar(tabela, u) {
  let linhas = (TABELAS[tabela] || []).slice();
  for (const [col, expr] of u.searchParams.entries()) {
    if (['select', 'order', 'offset', 'limit'].includes(col)) continue;
    const [op, ...resto] = expr.split('.');
    const val = resto.join('.');
    if (op === 'eq') linhas = linhas.filter(r => String(r[col]) === val);
    else if (op === 'in') {
      const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')));
      linhas = linhas.filter(r => set.has(String(r[col])));
    } else if (op === 'not' && resto.join('.') === 'is.null') linhas = linhas.filter(r => r[col] != null);
    else if (op === 'is' && val === 'null') linhas = linhas.filter(r => r[col] == null);
  }
  const range = u.searchParams.get('offset');
  if (range != null) {
    const off = Number(range), lim = Number(u.searchParams.get('limit') || 1000);
    linhas = linhas.slice(off, off + lim);
  }
  return linhas;
}

const RPCS = {
  fn_minhas_permissoes: [{ chave_menu: 'cad_clientes' }, { chave_menu: 'marketing_fidelidade' }],
  fn_vincular_funcionario: null,
  fidelidade_status: { cliente_id: CLI, cartela: { id: 'c1', selos: 4 },
    premios_pendentes: [{ id: XSS_ATTR, valor: 300, criado_em: '2026-01-05' }], cartelas_completas: 1,
    extrato: [{ venda_id: 'v1', quantidade: 2, valor_venda: 300, em: '2026-01-20T10:00:00Z', ajuste_manual: false }] },
  fidelidade_ciclo_cliente: { tem_ciclo: true, acumulado: 75, selos_do_ciclo: 0, falta_para_selo: 75 },
};

const browser = await chromium.launch();
const page = await browser.newPage();
const erros = [];
page.on('pageerror', e => erros.push(e.message));

let falharQuery = null;   // nome de tabela que deve responder 500
await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ access_token: 'f', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
    user: { id: UID, email: 't@t.com' } }) }));
await page.route('**/rest/v1/**', r => {
  const u = new URL(r.request().url());
  const nome = u.pathname.split('/rest/v1/')[1].split('?')[0];
  if (nome === falharQuery) { r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }); return; }
  let b = nome.startsWith('rpc/') ? (RPCS[nome.slice(4)] ?? {}) : consultar(nome, u);
  const acc = r.request().headers()['accept'] || '';
  if (acc.includes('pgrst.object') && Array.isArray(b)) b = b[0] ?? null;
  r.fulfill({ status: 200, contentType: acc.includes('pgrst.object') ? 'application/vnd.pgrst.object+json' : 'application/json',
    body: JSON.stringify(b) });
});
await page.route('**/storage/v1/**', r => r.fulfill({ status: 200, body: '{}' }));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const chave = await page.evaluate(() => window.sb?.storageKey);
if (!chave) { console.error('NAO DESCOBRI A CHAVE DE SESSAO'); await browser.close(); process.exit(1); }
await page.evaluate(([k, uid]) => localStorage.setItem(k, JSON.stringify({ access_token: 'f', token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, refresh_token: 'r',
  user: { id: uid, email: 't@t.com', aud: 'authenticated' } })), [chave, UID]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// goto() para a MESMA url (mesmo hash) é no-op no browser: a página não
// recarrega e a tela anterior fica na frente. Sem o reload explícito, checagens
// que dependem de recarregar (ex.: repetir a rota já com a query falhando)
// passariam olhando o DOM velho.
let ultimoHash = null;
const ir = async (hash, ms = 1100) => {
  if (ultimoHash === hash) await page.reload({ waitUntil: 'networkidle' });
  else await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' });
  ultimoHash = hash;
  await page.waitForTimeout(ms);
};
const visiveis = () => page.$$eval('[id^="panel-"]', e =>
  e.filter(x => getComputedStyle(x).display !== 'none').map(x => x.id));
const texto = sel => page.evaluate(s => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') || '', sel);

console.log(`\n=== SMOKE (${PAPEL}) ===`);

// 1) Tela da cliente
await ir(`#/cliente/${CLI}`);
check('tela da cliente abre', (await visiveis()).includes('panel-cliente-compras'), JSON.stringify(await visiveis()));
const kpis = await page.$$eval('#panel-cliente-compras .kpi-card', e => e.map(x => x.innerText.replace(/\s+/g, ' ')));
const esperadoCompras = EH_STAFF ? 'COMPRAS 2' : 'COMPRAS 1';
check(`escopo por papel (${esperadoCompras})`, kpis[0] === esperadoCompras, JSON.stringify(kpis));
check('bloco de cadastro (e-mail/observacao)', (await texto('#panel-cliente-compras')).includes('ana@ex.com'));
check('cartela de fidelidade', (await texto('#cc-fidelidade')).includes('4/10 selos'));
check('saldo do ciclo', (await texto('#cc-fidelidade')).includes('faltam'));
const podeAjustar = (await texto('#cc-fidelidade')).includes('1 selo');
check(`ajuste +-1 so para admin (papel=${PAPEL})`, podeAjustar === (PAPEL === 'admin'));

// 2) XSS: nem HTML nem quebra de string JS em atributo
await page.$$eval('#panel-cliente-compras button', b => b.filter(x => /Registrar resgate/.test(x.textContent)).forEach(x => x.click()));
await page.waitForTimeout(300);
check('XSS em contexto HTML neutralizado', await page.evaluate(() => !window.__xss));
check('XSS em string JS dentro de atributo neutralizado', await page.evaluate(() => !window.__pwn));
// O clique acima abre a confirmação do resgate (gestor); ela bloqueia os
// cliques seguintes se ficar aberta.
await page.evaluate(() => document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show')));
await page.waitForTimeout(200);

// 3) Vazamento: cliente de outra revendedora
if (!EH_STAFF) {
  await ir(`#/cliente/${CLI_ALHEIA}`);
  const html = await page.evaluate(() => document.getElementById('panel-cliente-compras').innerHTML);
  const vazou = ['SEGREDO', 'SECRETA', '21987654321', 'vi@secreto.com', '999'].filter(t => html.includes(t));
  check('nao vaza dado de cliente alheia', vazou.length === 0, vazou.join(', '));
}

// 4) Voltar não pode deixar tela em branco (cenário: primeira página da aba)
await page.goto(BASE + `/#/cliente/${CLI}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.click('#panel-cliente-compras button:has-text("Voltar")');
await page.waitForTimeout(700);
const depois = await visiveis();
check('Voltar (link direto) nao deixa tela em branco', depois.length === 1, JSON.stringify(depois));

// 5) Lista do papel
const listaHash = EH_STAFF ? '#/clientes' : '#/minhas-clientes';
const listaPanel = EH_STAFF ? 'panel-clientes' : 'panel-minhas-clientes';
await ir(listaHash);
check('lista do papel abre', (await visiveis()).includes(listaPanel));
check('lista nao fica em Carregando', !(await texto('#' + listaPanel)).includes('Carregando'));

// 6) O ponto que build/lint nunca pegam: erro de rede não pode travar no
//    spinner. A asserção é POSITIVA de propósito — exigir a mensagem de erro
//    na tela. Checar só "não contém Carregando" passaria à toa enquanto o
//    painel ainda estivesse vazio, que foi exatamente como esta verificação
//    nasceu quebrada.
const ERRO_NA_TELA = 'Não foi possível';
falharQuery = EH_STAFF ? 'clientes' : 'vendas';
await ir(listaHash, 2500);
let t = await texto('#' + listaPanel);
check(`erro em /${falharQuery} mostra estado de erro na lista`,
  t.includes(ERRO_NA_TELA) && !t.includes('Carregando'), JSON.stringify(t.slice(0, 120)));

falharQuery = 'vendas';
await ir(`#/cliente/${CLI}`, 2500);
t = await texto('#panel-cliente-compras');
check('erro em /vendas mostra estado de erro na tela da cliente',
  t.includes(ERRO_NA_TELA) && !t.includes('Carregando'), JSON.stringify(t.slice(0, 120)));

// A Fidelidade tem DUAS queries que podem falhar (a de vendas só existe para a
// revendedora; a de clientes, para os dois papéis). Foi o ponto cego que
// deixou o bug do spinner passar aqui.
for (const alvo of (EH_STAFF ? ['clientes'] : ['vendas', 'clientes'])) {
  falharQuery = alvo;
  await ir('#/fidelidade', 2500);
  t = await texto('#panel-fidelidade');
  check(`erro em /${alvo} mostra estado de erro na Fidelidade`,
    t.includes(ERRO_NA_TELA) && !t.includes('Carregando'), JSON.stringify(t.slice(0, 120)));
}
falharQuery = null;

// Fidelidade saudável tem de listar a cliente e navegar ao clicar.
await ir('#/fidelidade');
check('Fidelidade lista a cliente', (await texto('#panel-fidelidade')).includes('Ana'));

check('nenhum erro de pagina', erros.length === 0, erros.slice(0, 3).join(' | '));

await browser.close();
console.log(falhas ? `\n${falhas} FALHA(S)\n` : '\nTUDO OK\n');
process.exit(falhas ? 1 : 0);
