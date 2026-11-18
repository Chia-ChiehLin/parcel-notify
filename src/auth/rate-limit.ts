import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
import { sha256 } from '@/lib/crypto';

type Table = typeof schema.loginAttempts | typeof schema.bindAttempts;

/** 在時間窗內失敗次數是否已達上限 */
export async function isLimited(table: Table, key: string, maxFailures: number, windowMinutes: number, database: Pick<DB, 'select'> = db()) {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const [row] = await database
    .select({ n: count() })
    .from(table)
    .where(and(eq(table.key, key), eq(table.success, false), gte(table.createdAt, since)));
  return (row?.n ?? 0) >= maxFailures;
}

export async function recordAttempt(table: Table, key: string, success: boolean, database: Pick<DB, 'insert'> = db()) {
  await database.insert(table).values({ key, success });
}

export async function purgeOldAttempts(olderThanDays = 7) {
  const before = new Date(Date.now() - olderThanDays * 86_400_000);
  await db().delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, before));
  await db().delete(schema.bindAttempts).where(lt(schema.bindAttempts.createdAt, before));
}

/** 重設密碼寄送上限：每個 Email 每小時 3 封，同一來源 20 封。 */
export async function reservePasswordReset(email: string, ip: string | null) {
  const limits = [{ key: `reset:email:${sha256(email)}`, limit: 3 }];
  if (ip) limits.push({ key: `reset:ip:${sha256(ip)}`, limit: 20 });
  return db().transaction(async (tx) => {
    const since = new Date(Date.now() - 3_600_000);
    for (const { key, limit } of limits) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 2))`);
      const [row] = await tx.select({ n: count() }).from(schema.loginAttempts)
        .where(and(eq(schema.loginAttempts.key, key), gte(schema.loginAttempts.createdAt, since)));
      if (row.n >= limit) return false;
    }
    await tx.insert(schema.loginAttempts).values(limits.map(({ key }) => ({ key, success: true })));
    return true;
  });
}
