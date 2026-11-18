import { and, count, eq, gte, lt } from 'drizzle-orm';
import { db, schema } from '@/db';

type Table = typeof schema.loginAttempts | typeof schema.bindAttempts;

/** 在時間窗內失敗次數是否已達上限 */
export async function isLimited(table: Table, key: string, maxFailures: number, windowMinutes: number) {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const [row] = await db()
    .select({ n: count() })
    .from(table)
    .where(and(eq(table.key, key), eq(table.success, false), gte(table.createdAt, since)));
  return (row?.n ?? 0) >= maxFailures;
}

export async function recordAttempt(table: Table, key: string, success: boolean) {
  await db().insert(table).values({ key, success });
}

export async function purgeOldAttempts(olderThanDays = 7) {
  const before = new Date(Date.now() - olderThanDays * 86_400_000);
  await db().delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, before));
  await db().delete(schema.bindAttempts).where(lt(schema.bindAttempts.createdAt, before));
}
