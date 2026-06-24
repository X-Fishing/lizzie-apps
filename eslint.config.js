import fs from 'node:fs';
import globals from 'globals';

// Auto-deriva os nomes expostos no window (Object.assign do main.js). Chamadas
// cross-module acontecem via window (funcao de um modulo usada em outro), entao
// esses nomes precisam ser globais conhecidos para o no-undef nao dar falso
// positivo. Como a lista vem do PROPRIO Object.assign, no-undef continua pegando
// import esquecido / nome digitado errado (qualquer ref que nao seja local,
// importada, builtin do browser, nem realmente exposta no window).
let windowFns = {};
try {
  const main = fs.readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  const m = main.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\)/);
  if (m) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) windowFns[name] = 'readonly';
    }
  }
} catch { /* sem main.js ainda */ }

export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...windowFns },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  },
];
