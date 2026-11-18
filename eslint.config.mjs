import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'src/db/migrations/**', 'playwright-report/**', 'test-results/**', 'data/**'],
  },
];

export default config;
