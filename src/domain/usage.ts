import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
import { monthKey } from '@/lib/time';

type Field = 'linePush' | 'email' | 'sms' | 'parcels';

export async function bumpUsage(communityId: string, field: Field, n = 1, when = new Date(), database: Pick<DB, 'insert'> = db()) {
  if (n <= 0) return;
  const month = monthKey(when);
  const col = schema.usageCounters[field];
  await database
    .insert(schema.usageCounters)
    .values({ communityId, month, [field]: n })
    .onConflictDoUpdate({
      target: [schema.usageCounters.communityId, schema.usageCounters.month],
      set: { [field]: sql`${col} + ${n}` },
    });
}

export async function getUsage(communityId: string, month = monthKey()) {
  const [row] = await db()
    .select()
    .from(schema.usageCounters)
    .where(and(eq(schema.usageCounters.communityId, communityId), eq(schema.usageCounters.month, month)));
  return row ?? { communityId, month, linePush: 0, email: 0, sms: 0, parcels: 0 };
}

export async function listUsageForMonth(month = monthKey()) {
  return db().select().from(schema.usageCounters).where(eq(schema.usageCounters.month, month));
}
