import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '@/lib/env';

export type DB = NodePgDatabase<typeof schema>;

type Holder = { pool?: Pool; db?: DB; url?: string };
// 開發時熱重載會重新執行模組，用 globalThis 保存同一個連線池
const holder = ((globalThis as unknown as { __pnDb?: Holder }).__pnDb ??= {});

export function getPool(): Pool {
  const url = env().DATABASE_URL;
  if (!holder.pool || holder.url !== url) {
    void holder.pool?.end().catch(() => {});
    holder.pool = new Pool({
      connectionString: url,
      // Serverless 每個執行個體只需要少量連線；Neon 的 pooler 會再集中管理
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
    });
    holder.url = url;
    holder.db = drizzle(holder.pool, { schema });
  }
  return holder.pool;
}

export function db(): DB {
  getPool();
  return holder.db!;
}

export async function closeDb() {
  await holder.pool?.end();
  holder.pool = undefined;
  holder.db = undefined;
  holder.url = undefined;
}

export { schema };
