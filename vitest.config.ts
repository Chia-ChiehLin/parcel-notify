import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src'), 'server-only': path.resolve(import.meta.dirname, 'tests/server-only-stub.ts') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // 所有測試共用同一個測試資料庫，依序執行避免互相干擾
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
