import { afterAll, beforeEach } from 'vitest';
import { TEST_DATABASE_URL } from './global-setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.APP_URL = 'https://test.example.com';
process.env.CRON_SECRET = 'cron-test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.RESEND_API_KEY;

const { resetEnvCache } = await import('@/lib/env');
const { resetKeyCache } = await import('@/lib/crypto');
resetEnvCache();
resetKeyCache();

const { getPool, closeDb } = await import('@/db');
const { seedDefaults } = await import('@/domain/seed');
const { fakes } = await import('./helpers');

beforeEach(async () => {
  const pool = getPool();
  const { rows } = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'app'");
  if (rows.length) {
    await pool.query(`truncate ${rows.map((r) => `app."${r.tablename}"`).join(', ')} restart identity cascade`);
  }
  await seedDefaults();
  fakes.reset();
});

afterAll(async () => {
  await closeDb();
});
