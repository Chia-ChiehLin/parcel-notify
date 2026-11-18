import { requireLocalTestDatabase } from '../tests/local-database';
import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import path from 'node:path';
import { E2E_DATABASE_URL } from '../playwright.config';

/** E2E 每次都從空資料庫開始 */
export default async function globalSetup() {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await requireLocalTestDatabase(client, 'parcel_e2e');
  await client.query('drop schema if exists app cascade; drop schema if exists drizzle cascade;');
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  await client.query(`insert into app.plans (code, name, max_units, max_staff, monthly_price, features, sort_order)
    values ('pro', '進階方案', 400, 15, 1990, '{"email":true,"photos":true,"sms":false,"ownLine":true}', 1)`);
  await client.end();
}
