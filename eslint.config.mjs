import js from '@eslint/js';
import globals from 'globals';

// Bug-finding rules only. Style is left alone: the browser scripts are classic scripts that
// share globals (see index.html), so no-undef cannot be used for them until they are modules.
const bugs = {
  'no-dupe-keys': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error',
  'no-self-assign': 'error', 'no-unsafe-negation': 'error', 'no-unsafe-finally': 'error', 'use-isnan': 'error',
  'valid-typeof': 'error', 'no-cond-assign': ['error', 'except-parens'], 'no-func-assign': 'error',
  'no-import-assign': 'error', 'no-redeclare': 'error', 'no-sparse-arrays': 'error', 'no-compare-neg-zero': 'error',
};

export default [
  {ignores: ['node_modules/**', 'public/**', 'dist/**', '.next/**', '.vinext/**', '.wrangler/**', '.venv*/**', 'build/**', 'scripts/fixtures/**', 'styles.css', '.apex-cache/**', '.fastf1-cache/**']},
  {files: ['**/*.{js,mjs}'], languageOptions: {ecmaVersion: 'latest', sourceType: 'script', globals: {...globals.browser, ...globals.node}}, rules: bugs},
  {files: ['**/*.mjs', 'car-performance.js', 'race-cornering.js', 'corner-geometry.js', 'qualifying-telemetry.js', 'speed-domain.js', 'performance-format.js', 'performance-identity.js', 'react-islands.js', 'scripts/**/*.js'], languageOptions: {sourceType: 'module'}},
];
