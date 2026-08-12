// Cadastra (ou confere) o webhook order/paid na Nuvemshop.
//
//   node scripts/nuvemshop-webhook.mjs          -> lista e cadastra se faltar
//   node scripts/nuvemshop-webhook.mjs --listar -> so lista, nao mexe em nada
//
// Existe porque o admin da Nuvemshop nao tem tela de webhook para a maioria
// das lojas: isso e API de aplicacao.
//
// Le supabase/.env.nuvemshop.loja (gitignored).
import { readFileSync } from 'node:fs';

const ARQ = 'supabase/.env.nuvemshop.loja';
const EVENTO = 'order/paid';
const URL_WEBHOOK = 'https://qoouzjntyfzcxnwjksiu.supabase.co/functions/v1/nuvemshop-webhook-pedido';
const SO_LISTAR = process.argv.includes('--listar');

let bruto;
try {
  bruto = readFileSync(ARQ, 'utf8');
} catch {
  console.error(`\nNao achei ${ARQ}.`);
  console.error(`Copie ${ARQ}.example para ${ARQ} e preencha os dois campos.\n`);
  process.exit(1);
}

const env = {};
for (const linha of bruto.split('\n')) {
  const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const storeId = env.NUVEMSHOP_STORE_ID;
const token = env.NUVEMSHOP_ACCESS_TOKEN;
if (!storeId || !token) {
  console.error(`\nFalta preencher NUVEMSHOP_STORE_ID e/ou NUVEMSHOP_ACCESS_TOKEN em ${ARQ}.\n`);
  process.exit(1);
}

// A Nuvemshop usa "Authentication: bearer", nao "Authorization", e exige
// um User-Agent identificando a aplicacao.
const cabecalhos = {
  'Authentication': `bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Integração App Lizzie x Nuvemshop (lizziesemijoias2017@gmail.com)',
};

const api = (caminho, init = {}) =>
  fetch(`https://api.nuvemshop.com.br/v1/${storeId}${caminho}`, { ...init, headers: cabecalhos });

// ── 1) O que ja existe ──────────────────────────────────────────────
const respLista = await api('/webhooks');
if (!respLista.ok) {
  const corpo = await respLista.text().catch(() => '');
  console.error(`\nNao consegui listar os webhooks (HTTP ${respLista.status}). ${corpo.slice(0, 300)}`);
  if (respLista.status === 401) console.error('Token invalido ou sem escopo de webhooks.\n');
  process.exit(1);
}
const existentes = await respLista.json();

console.log(`\nWebhooks cadastrados hoje: ${existentes.length}`);
for (const w of existentes) console.log(`  · ${w.event}  ->  ${w.url}`);

const jaTem = existentes.find(w => w.event === EVENTO && w.url === URL_WEBHOOK);
if (jaTem) {
  console.log(`\nOK: o webhook ${EVENTO} ja aponta para a nossa funcao (id ${jaTem.id}). Nada a fazer.\n`);
  process.exit(0);
}

// Mesmo evento apontando para outro lugar: avisa em vez de duplicar em silencio.
const conflito = existentes.find(w => w.event === EVENTO);
if (conflito) {
  console.log(`\nATENCAO: ja existe um webhook ${EVENTO} apontando para outra URL:`);
  console.log(`  ${conflito.url}  (id ${conflito.id})`);
  console.log('Os dois vao receber o evento. Se o outro nao for usado, apague-o no painel.\n');
}

if (SO_LISTAR) {
  console.log(`\nFalta o webhook ${EVENTO}. Rode sem --listar para cadastrar.\n`);
  process.exit(0);
}

// ── 2) Cadastra ─────────────────────────────────────────────────────
const respCria = await api('/webhooks', {
  method: 'POST',
  body: JSON.stringify({ event: EVENTO, url: URL_WEBHOOK }),
});
const criado = await respCria.json().catch(() => ({}));

if (!respCria.ok) {
  console.error(`\nFalhou ao cadastrar (HTTP ${respCria.status}):`);
  console.error(JSON.stringify(criado, null, 2));
  console.error('\nSe reclamou de escopo, a aplicacao precisa da permissao de webhooks');
  console.error('no Portal de Parceiros — e depois disso o token tem que ser gerado de novo.\n');
  process.exit(1);
}

console.log(`\nCadastrado: ${EVENTO} -> ${URL_WEBHOOK}`);
console.log(`id ${criado.id}\n`);
console.log('A partir de agora, venda paga no site baixa o estoque no app.\n');
