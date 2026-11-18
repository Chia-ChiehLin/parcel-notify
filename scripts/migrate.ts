/**
 * 執行資料庫 migration：npm run db:migrate
 * 部署到 Vercel 時由 build 指令自動執行（見 package.json 的 vercel-build）。
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { closeDb, db } from '../src/db';
import { seedDefaults } from '../src/domain/seed';

async function main() {
  await migrate(db(), { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  await seedDefaults();
  console.log('✅ 資料庫 migration 完成');
}

main()
  .catch((err) => {
    console.error('❌ migration 失敗：', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
