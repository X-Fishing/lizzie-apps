// Smoke test das telas de cliente, com o Supabase INTEIRAMENTE mockado — roda
// sem login e sem tocar no banco de verdade.
//
// POR QUE EXISTE: `npm run build` e `npm run lint` passam verdes com a tela
// quebrada. Um erro bobo (usar o retorno de fetchPaginado como se fosse array)
// deixa a tela presa em "Carregando..." para sempre e nada acusa. Este script
// abre as telas de verdade no Chromium e falha alto.
//
// COMO RODAR:
//   npx vite --port 5199 --strictPort      (noutro terminal)
//   node scripts/smoke-clientes.mjs revendedora
//   node scripts/smoke-clientes.mjs admin
//
// O que ele confere: escopo por papel (a revendedora só vê as compras dela),
// bloco de cadastro, cartela + saldo do ciclo, travas de admin/gestor, expandir
// itens da compra, e o botão Voltar cair na tela de origem.
import { chromium } from 'playwright';
const BASE = process.env.SMOKE_URL || 'http://localhost:5199';
const PAPEL = process.argv[2] || 'revendedora';
const UID = PAPEL === 'admin' ? 'aaaaaaaa-0000-4000-8000-000000000001' : 'bbbbbbbb-0000-4000-8000-000000000002';
const CLI = 'cccccccc-0000-4000-8000-000000000003';
const perfil = { id: UID, nome: 'Fulana Teste', telefone: '11999998888',
  role: PAPEL === 'admin' ? 'admin' : 'revendedora', aprovada: true,
  is_revendedora: PAPEL !== 'admin', teste: false, pode_completar_vendas: false };
const clientes = [{ id: CLI, nome: 'Ana Souza', celular: '11991234567', email: 'ana@ex.com',
  cidade: 'Sao Paulo', observacao: 'gosta de dourado', aniversario_dia: 29, aniversario_mes: 2,
  telefone_invalido: false, created_at: '2025-03-10T12:00:00Z', criado_por: UID }];
const vendas = [
  { id: 'v1', revendedora_id: UID, cliente_id: CLI, nome_cliente: 'Ana', data_venda: '2026-01-20',
    forma_pagamento: 'Pix', valor_total: 300, valor_pago: 300, status: 'quitado', maleta_id: 'm1' },
  { id: 'v2', revendedora_id: 'outra', cliente_id: CLI, nome_cliente: 'Ana', data_venda: '2026-02-02',
    forma_pagamento: 'Fiado', valor_total: 200, valor_pago: 0, status: 'pendente', maleta_id: 'm2' }];

function body(url) {
  const p = new URL(url).pathname;
  if (p.includes('/rpc/fn_minhas_permissoes')) return [{ chave_menu: 'cad_clientes' }, { chave_menu: 'marketing_fidelidade' }];
  if (p.includes('/rpc/fidelidade_status')) return { cliente_id: CLI, cartela: { id: 'c1', selos: 4 },
    premios_pendentes: [{ id: 'p1', valor: 300, criado_em: '2026-01-05' }], cartelas_completas: 1,
    extrato: [{ venda_id: 'v1', quantidade: 2, valor_venda: 300, em: '2026-01-20T10:00:00Z', ajuste_manual: false }] };
  if (p.includes('/rpc/fidelidade_ciclo_cliente')) return { tem_ciclo: true, acumulado: 75, selos_do_ciclo: 0, falta_para_selo: 75 };
  if (p.includes('/rpc/')) return {};
  if (p.includes('/profiles')) return [perfil];
  if (p.includes('/clientes')) return clientes;
  if (p.includes('/vendas')) return PAPEL === 'admin' ? vendas : vendas.filter(v => v.revendedora_id === UID);
  if (p.includes('/venda_itens')) return [{ id: 'i1', venda_id: 'v1', descricao: 'Colar Gota', quantidade: 2, preco_unit: 150, created_at: '2026-01-20' }];
  if (p.includes('/fidelidade_cartelas')) return [{ cliente_id: CLI, selos: 4 }];
  if (p.includes('/fidelidade_premios')) return [{ cliente_id: CLI }];
  if (p.includes('/maletas')) return [{ id: 'm1', numero_interno: 7, status: 'ativa', revendedora_id: UID }];
  return [];
}

const browser = await chromium.launch();
const page = await browser.newPage();
const erros = [];
page.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ access_token: 'f', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: UID, email: 't@t.com' } }) }));
await page.route('**/rest/v1/**', r => {
  let b = body(r.request().url());
  const acc = r.request().headers()['accept'] || '';
  if (acc.includes('pgrst.object') && Array.isArray(b)) b = b[0] ?? null;
  r.fulfill({ status: 200, contentType: acc.includes('pgrst.object') ? 'application/vnd.pgrst.object+json' : 'application/json', body: JSON.stringify(b) });
});
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const chave = await page.evaluate(() => window.sb?.storageKey);
await page.evaluate(([k, uid]) => localStorage.setItem(k, JSON.stringify({ access_token: 'f', token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, refresh_token: 'r',
  user: { id: uid, email: 't@t.com', aud: 'authenticated' } })), [chave, UID]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Entra pela Fidelidade (para exercitar o "Voltar" com origem conhecida)
await page.goto(BASE + '/#/fidelidade', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.click(PAPEL === 'admin' ? '#panel-fidelidade tr.pag-row' : '#panel-fidelidade .fid-card');
await page.waitForTimeout(1200);

console.log(`=== DETALHE (${PAPEL}) ===`);
console.log('hash:', await page.evaluate(() => location.hash));
console.log('KPIs:', JSON.stringify(await page.$$eval('#panel-cliente-compras .kpi-card', e => e.map(x => x.innerText.replace(/\s+/g, ' ')))));
console.log('cadastro:', await page.evaluate(() => [...document.querySelectorAll('#panel-cliente-compras > div')].map(d => d.innerText.replace(/\s+/g, ' ')).find(t => t.includes('E-MAIL')) || '(sem bloco de cadastro)'));
console.log('fidelidade:', await page.evaluate(() => document.querySelector('#cc-fidelidade')?.innerText.replace(/\s+/g, ' ').slice(0, 260) || '(vazio)'));
console.log('compras:', JSON.stringify(await page.$$eval('#cc-compras .hist-card', e => e.map(x => x.innerText.replace(/\s+/g, ' ')))));
await page.click('#cc-compras .hist-card');
await page.waitForTimeout(400);
console.log('itens expandidos:', await page.evaluate(() => document.querySelector('#cc-compras .hist-detalhe')?.innerText.replace(/\s+/g, ' ') || '(nao expandiu)'));
await page.click('#panel-cliente-compras button:has-text("Voltar")');
await page.waitForTimeout(700);
console.log('apos Voltar → hash:', await page.evaluate(() => location.hash),
  '| paineis:', JSON.stringify(await page.$$eval('[id^="panel-"]', e => e.filter(x => getComputedStyle(x).display !== 'none').map(x => x.id))));
console.log('erros:', erros.length ? erros.join(' | ') : '(nenhum)');
await browser.close();
