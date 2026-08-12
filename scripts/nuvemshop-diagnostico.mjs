// Confere quais permissoes (scopes) o token da loja realmente tem.
//
//   node scripts/nuvemshop-diagnostico.mjs
//
// Serve para descobrir de uma vez o que falta, em vez de ir batendo em 403
// um passo de cada vez. So faz leitura — nao altera nada na loja.
import { readFileSync } from 'node:fs';

const ARQ = 'supabase/.env.nuvemshop.loja';

let bruto;
try {
  bruto = readFileSync(ARQ, 'utf8');
} catch {
  console.error(`\nNao achei ${ARQ}. Copie o .example e preencha.\n`);
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
  console.error(`\nFalta NUVEMSHOP_STORE_ID e/ou NUVEMSHOP_ACCESS_TOKEN em ${ARQ}.\n`);
  process.exit(1);
}

const cabecalhos = {
  'Authentication': `bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Integração App Lizzie x Nuvemshop (lizziesemijoias2017@gmail.com)',
};

async function checar(rotulo, caminho, precisaPara) {
  let status;
  try {
    const r = await fetch(`https://api.nuvemshop.com.br/v1/${storeId}${caminho}`, { headers: cabecalhos });
    status = r.status;
  } catch (e) {
    console.log(`  [ERRO ] ${rotulo} — falha de rede: ${e.message}`);
    return false;
  }
  const ok = status >= 200 && status < 300;
  console.log(`  [${ok ? ' OK  ' : status === 403 ? 'FALTA' : ' ' + status + ' '}] ${rotulo}${ok ? '' : `  <- necessario para: ${precisaPara}`}`);
  return ok;
}

console.log(`\nLoja ${storeId} — conferindo permissoes do token\n`);

const r1 = await checar('ler dados da loja      ', '/store', 'validar a conexao');
const r2 = await checar('ler produtos           ', '/products?per_page=1', 'a busca da tela de vinculo');
const r3 = await checar('ler pedidos            ', '/orders?per_page=1', 'o webhook ler o pedido pago');
const r4 = await checar('ler/gravar webhooks    ', '/webhooks', 'cadastrar o order/paid');

console.log('\nObs.: gravar produtos (write_products) nao da para testar sem alterar');
console.log('      estoque de verdade, entao nao e testado aqui. Habilite junto.\n');

if (r1 && r2 && r3 && r4) {
  console.log('Tudo liberado. Pode rodar: node scripts/nuvemshop-webhook.mjs\n');
} else {
  console.log('══════════════════════════════════════════════════');
  console.log(' Falta permissao. No Portal de Parceiros, na sua');
  console.log(' aplicacao, habilite os escopos:');
  console.log('══════════════════════════════════════════════════');
  console.log('   read_products   e   write_products   (a sincronizacao de estoque)');
  console.log('   read_orders                          (o webhook ler o pedido)');
  console.log('\n IMPORTANTE: mudar escopo NAO vale para token ja emitido.');
  console.log(' Depois de salvar, autorize a aplicacao de novo e gere um');
  console.log(' token novo (node scripts/nuvemshop-token.mjs), cole na tela');
  console.log(' "Loja do site" e atualize tambem o .env.nuvemshop.loja.\n');
}
