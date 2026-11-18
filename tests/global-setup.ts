import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import path from 'node:path';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/parcel_test?sslmode=disable';

/** 每次跑測試前重建資料庫結構 */
export default async function setup() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('drop schema if exists app cascade; drop schema if exists drizzle cascade;');
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  await client.end();
}
