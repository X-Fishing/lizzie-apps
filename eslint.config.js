import globals from 'globals';

// Foco desta config: pegar "import/funcao faltando" (no-undef) durante a Fase 3.
// Lint so do codigo da aplicacao (src/). Ambiente browser (window, document, etc.).
export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  },
];
