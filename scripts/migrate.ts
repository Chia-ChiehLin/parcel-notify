/**
 * 執行資料庫 migration：npm run db:migrate
 * 部署到 Vercel 時由 build 指令自動執行（見 package.json 的 vercel-build）。
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Client } from 'pg';
import { closeDb, db } from '../src/db';
import { seedDefaults } from '../src/domain/seed';
import { env, validateDeploymentSecrets } from '../src/lib/env';

async function main() {
  validateDeploymentSecrets();
  // Separate connection keeps the transaction lock across the migrator's own transactions, including on a pooled Neon URL.
  const lock = new Client({ connectionString: env().DATABASE_URL });
  await lock.connect();
  try {
    await lock.query('begin');
    await lock.query("set local lock_timeout = '90s'");
    await lock.query("select pg_advisory_xact_lock(hashtextextended('parcel-notify:app:migrations', 0))");
    await migrate(db(), { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
    await seedDefaults();
    await lock.query('commit');
  } finally {
    await lock.end();
  }
  console.log('✅ 資料庫 migration 完成');
}

main()
  .catch((err) => {
    console.error('❌ migration 失敗：', err instanceof Error && /^(Vercel 部署需要|正式環境需要)/.test(err.message) ? err.message : '請檢查資料庫連線、權限及 migration 狀態');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
