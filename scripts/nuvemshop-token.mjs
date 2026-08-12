// Troca o "code" da instalacao da aplicacao pelos valores finais que a tela
// "Loja do site" pede: access_token e store_id.
//
//   node scripts/nuvemshop-token.mjs
//
// Le supabase/.env.nuvemshop.oauth (gitignored). Nada e gravado em disco:
// os valores sao so impressos para voce colar na tela do app.
import { readFileSync } from 'node:fs';

const ARQ = 'supabase/.env.nuvemshop.oauth';

function lerEnv(caminho) {
  const bruto = readFileSync(caminho, 'utf8');
  const env = {};
  for (const linha of bruto.split('\n')) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// Tudo dentro de main() para que cada saida seja um `return` — assim o
// processo termina sozinho, sem process.exit() (que no Windows dispara um
// "Assertion failed" do libuv quando ha fetch pendente).
async function main() {
  let env;
  try {
    env = lerEnv(ARQ);
  } catch {
    console.error(`\nNao achei ${ARQ}.`);
    console.error(`Copie ${ARQ}.example para ${ARQ} e preencha os campos.\n`);
    return 1;
  }

  if (!env.NUVEMSHOP_CLIENT_ID) {
    console.error(`\nFalta preencher NUVEMSHOP_CLIENT_ID em ${ARQ}.`);
    console.error('Pegue o App ID no Portal de Parceiros, na sua aplicacao.\n');
    return 1;
  }

  const linkAutorizar = `https://www.nuvemshop.com.br/apps/${env.NUVEMSHOP_CLIENT_ID}/authorize`;

  // Sem o code, o que a pessoa precisa e do link — nao de uma mensagem de erro.
  if (!env.NUVEMSHOP_CODE) {
    console.log('\n══════════════════════════════════════════════════');
    console.log(' ANTES: confira se os escopos read_products,');
    console.log(' write_products e read_orders ja estao habilitados');
    console.log(' no Portal de Parceiros. Token novo com escopo velho');
    console.log(' nao adianta nada.');
    console.log('══════════════════════════════════════════════════\n');
    console.log(' 1) Abra este link logado na sua loja e autorize:\n');
    console.log(`    ${linkAutorizar}\n`);
    console.log(' 2) Ele redireciona para uma URL terminada em ?code=XXXXX');
    console.log(' 3) Copie o valor do code para NUVEMSHOP_CODE em');
    console.log(`    ${ARQ}`);
    console.log(' 4) Rode este script de novo, logo em seguida.\n');
    console.log(' O code vale UMA vez so e expira em poucos minutos.\n');
    return 0;
  }

  if (!env.NUVEMSHOP_CLIENT_SECRET) {
    console.error(`\nFalta preencher NUVEMSHOP_CLIENT_SECRET em ${ARQ}.\n`);
    return 1;
  }

  const resp = await fetch('https://www.nuvemshop.com.br/apps/authorize/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.NUVEMSHOP_CLIENT_ID,
      client_secret: env.NUVEMSHOP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: env.NUVEMSHOP_CODE,
    }),
  });

  const dados = await resp.json().catch(() => ({}));

  // A Nuvemshop devolve erro de OAuth com HTTP 200 — nao da para confiar so
  // no status; tem que olhar o corpo.
  if (!resp.ok || dados.error || !dados.access_token) {
    const detalhe = dados.error_description || dados.error || 'sem detalhe';
    console.error(`\nA Nuvemshop recusou: ${detalhe}`);
    console.error('\nO code ja foi usado ou expirou (ele vale uma vez so).');
    console.error('Limpe NUVEMSHOP_CODE, rode este script para pegar o link,');
    console.error('autorize de novo e cole o code novo NA HORA:\n');
    console.error(`  ${linkAutorizar}\n`);
    return 1;
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(' Cole estes dois valores na tela "Loja do site":');
  console.log('══════════════════════════════════════════════════\n');
  console.log(`  ID da loja (store_id) : ${dados.user_id}`);
  console.log(`  Access token          : ${dados.access_token}\n`);
  if (dados.scope) console.log(`  Escopos deste token   : ${dados.scope}\n`);
  console.log('Atualize tambem supabase/.env.nuvemshop.loja com esses valores,');
  console.log('e depois apague supabase/.env.nuvemshop.oauth.\n');
  return 0;
}

process.exitCode = await main();
