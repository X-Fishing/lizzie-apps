// Procura o padrão que já deixou 12 telas presas em "Carregando..." para sempre.
//
// O DEFEITO: `handleSupabaseError` (e `surfarErro`) devolvem TRUE para
// QUALQUER erro. Então isto:
//
//     panel().innerHTML = '<div class="loading">…Carregando…</div>';
//     const { data, error } = await sbQ(...);
//     if (await handleSupabaseError(error, '...')) return;   // ← sempre sai aqui
//     panel().innerHTML = render(data);                      // ← nunca roda
//
// deixa o spinner girando para sempre. E não é caso raro: `sbQ` estoura por
// timeout em 12s, o que acontece com sinal ruim de celular — não só com o
// servidor fora do ar.
//
// A FORMA CERTA em loader (função que escreve spinner antes de buscar):
//
//     if (error) {
//       await handleSupabaseError(error, '...');   // toast / sessão expirada
//       panel().innerHTML = '<div class="empty-state">…não foi possível…</div>';
//       return;
//     }
//
// Em HANDLER DE AÇÃO (salvar/excluir/resgatar) o `if (...) return;` está
// CERTO: não há spinner, o toast é o feedback. Por isso este script só acusa
// quando a mesma função escreve um spinner antes.
//
// COMO RODAR:  node scripts/check-spinner-eterno.mjs
// Sai com código 1 se achar algo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(RAIZ, 'src');

const RE_SPINNER = /class="loading"|class="spinner"|Carregando/i;
const RE_BAILOUT = /if\s*\(\s*await\s+(handleSupabaseError|surfarErro)\s*\(/;

const achados = [];
for (const arq of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
  const linhas = fs.readFileSync(path.join(SRC, arq), 'utf8').split('\n');

  // Fatia por função de topo (export function / function / const x = async).
  let iniFn = 0;
  const limites = [];
  linhas.forEach((l, i) => {
    if (/^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(l)) {
      if (i > iniFn) limites.push([iniFn, i]);
      iniFn = i;
    }
  });
  limites.push([iniFn, linhas.length]);

  for (const [ini, fim] of limites) {
    const corpo = linhas.slice(ini, fim);
    const iSpinner = corpo.findIndex(l => RE_SPINNER.test(l) && /innerHTML/.test(l));
    if (iSpinner < 0) continue;
    corpo.forEach((l, i) => {
      // Ignora comentário: o texto do padrão errado aparece de propósito nos
      // avisos que explicam por que ele não pode ser usado.
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (i > iSpinner && RE_BAILOUT.test(l)) {
        achados.push({
          arquivo: arq,
          linha: ini + i + 1,
          fn: (corpo[0] || '').trim().slice(0, 70),
          trecho: l.trim().slice(0, 90),
        });
      }
    });
  }
}

if (!achados.length) {
  console.log('OK — nenhum loader sai pelo retorno de handleSupabaseError/surfarErro.');
  process.exit(0);
}
console.log(`${achados.length} possível(is) spinner(s) eterno(s):\n`);
for (const a of achados) {
  console.log(`  ${a.arquivo}:${a.linha}`);
  console.log(`    em: ${a.fn}`);
  console.log(`    ${a.trecho}\n`);
}
console.log('Em loader, troque por: await handleSupabaseError(...); <renderiza estado>; return;');
console.log('Se for handler de acao (sem spinner), o script errou — ajuste a heuristica.');
process.exit(1);
