import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { workspaceBoundariesRule } from './tools/eslint-rules/workspace-boundaries.mjs';

export default [
  {
    ignores: [
      '**/dist/**', '**/out/**', '**/node_modules/**', '**/.turbo/**', '**/.wrangler/**',
      '**/coverage/**', '**/test-results/**', '**/playwright-report/**', 'meshy_output/**',
    ],
  },
  {
    files: ['apps/**/*.{js,jsx,mjs,mts,cjs,cts,ts,tsx}', 'packages/**/*.{js,jsx,mjs,mts,cjs,cts,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      voltmarch: { rules: { 'workspace-boundaries': workspaceBoundariesRule } },
    },
    rules: {
      'voltmarch/workspace-boundaries': 'error',
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
];
