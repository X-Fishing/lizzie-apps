// Observa o estoque de uma variante na loja e avisa quando muda.
// Serve para validar a sincronizacao sem ficar recarregando o site na mao.
//
//   node scripts/nuvemshop-observar.mjs <variant_id> [segundos]
//
// Imprime uma linha na primeira leitura e depois SO quando o valor muda.
import { readFileSync } from 'node:fs';

const ARQ = 'supabase/.env.nuvemshop.loja';
const variantAlvo = String(process.argv[2] || '');
const intervalo = Number(process.argv[3] || 20) * 1000;

if (!variantAlvo) {
  console.error('uso: node scripts/nuvemshop-observar.mjs <variant_id> [segundos]');
  process.exitCode = 1;
} else {
  const env = {};
  for (const l of readFileSync(ARQ, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }

  const cabecalhos = {
    'Authentication': `bearer ${env.NUVEMSHOP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Integração App Lizzie x Nuvemshop (lizziesemijoias2017@gmail.com)',
  };
  const base = `https://api.nuvemshop.com.br/v1/${env.NUVEMSHOP_STORE_ID}`;

  const hora = () => new Date().toLocaleTimeString('pt-BR');

  async function ler() {
    const r = await fetch(`${base}/products?per_page=50`, { headers: cabecalhos });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    for (const p of await r.json()) {
      for (const v of (p.variants || [])) {
        if (String(v.id) === variantAlvo) {
          const nome = typeof p.name === 'string' ? p.name : (p.name?.pt || '');
          return { stock: v.stock, nome };
        }
      }
    }
    return { erro: 'variante nao encontrada' };
  }

  let anterior;
  for (;;) {
    const atual = await ler();
    if (atual.erro) {
      console.log(`[${hora()}] erro ao ler: ${atual.erro}`);
    } else if (anterior === undefined) {
      console.log(`[${hora()}] ${atual.nome} — estoque no site agora: ${atual.stock === null ? 'sem controle' : atual.stock}`);
      anterior = atual.stock;
    } else if (atual.stock !== anterior) {
      console.log(`[${hora()}] MUDOU: ${anterior === null ? 'sem controle' : anterior} -> ${atual.stock === null ? 'sem controle' : atual.stock}`);
      anterior = atual.stock;
    }
    await new Promise(r => setTimeout(r, intervalo));
  }
}
