/**
 * Flat ESLint config.
 *
 * eslint-config-next v16 ships flat-config arrays directly, so they are spread
 * in rather than bridged through FlatCompat.
 */

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', '.vercel/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // The CLI helper and this config file run outside the Next.js app.
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    /*
     * Dashboard pages load their data from our own /api routes on mount.
     * `react-hooks/set-state-in-effect` flags any setState reachable from an
     * effect, without modelling `await` boundaries — but every setState in
     * these loaders runs in a microtask after the fetch resolves, not
     * synchronously during the effect, so there is no cascading render to
     * avoid. Scoped to these files only; the rule stays on everywhere else.
     */
    files: ['app/dashboard/**/*.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
];

export default eslintConfig;
