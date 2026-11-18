import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:55432/parcel_e2e?sslmode=disable';
export const E2E_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123456789';
export const E2E_SETUP_TOKEN = 'e2e-setup-token-0123456789';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: `node --import ./e2e/provider-fixtures.mjs ./node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_SECRET: E2E_SECRET,
      APP_URL: `http://127.0.0.1:${PORT}`,
      SETUP_TOKEN: E2E_SETUP_TOKEN,
      CRON_SECRET: 'e2e-cron',
      PG_POOL_MAX: '5',
      BLOB_READ_WRITE_TOKEN: '',
      RESEND_API_KEY: 'playwright-fixture',
      EMAIL_FROM: 'sender@example.test',
    },
  },
});
