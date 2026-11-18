import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { addDays, startOfDay } from '@/lib/time';
import { parseSettings } from './settings';
import { getUsage } from './usage';

export async function dashboardStats(community: typeof schema.communities.$inferSelect, now = new Date()) {
  const settings = parseSettings(community.settings);
  const cid = community.id;
  const today = startOfDay(now, community.timezone);
  const since30 = addDays(now, -30);
  const overdueBefore = addDays(now, -settings.overdueDays);

  const [[receivedToday], [pickedToday], [waiting], [overdue], [avgPickup], byCarrier, daily, [residents], [units], [unbound], usage] =
    await Promise.all([
      db()
        .select({ n: sql<number>`coalesce(sum(${schema.parcels.quantity}),0)::int` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), gte(schema.parcels.receivedAt, today))),
      db()
        .select({ n: sql<number>`coalesce(sum(${schema.parcels.quantity}),0)::int` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), gte(schema.parcels.pickedUpAt, today))),
      db()
        .select({ n: sql<number>`coalesce(sum(${schema.parcels.quantity}),0)::int`, units: sql<number>`count(distinct ${schema.parcels.unitId})::int` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), eq(schema.parcels.status, 'waiting'))),
      db()
        .select({ n: sql<number>`coalesce(sum(${schema.parcels.quantity}),0)::int` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), eq(schema.parcels.status, 'waiting'), lte(schema.parcels.receivedAt, overdueBefore))),
      db()
        .select({ hours: sql<number | null>`round(avg(extract(epoch from (${schema.parcels.pickedUpAt} - ${schema.parcels.receivedAt})) / 3600)::numeric, 1)::float` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), eq(schema.parcels.status, 'picked_up'), gte(schema.parcels.pickedUpAt, since30))),
      db()
        .select({ carrier: sql<string>`coalesce(${schema.parcels.carrier}, '未填')`, n: sql<number>`sum(${schema.parcels.quantity})::int` })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), gte(schema.parcels.receivedAt, since30)))
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`)
        .limit(8),
      db()
        .select({
          day: sql<string>`to_char(${schema.parcels.receivedAt} at time zone ${community.timezone}, 'YYYY-MM-DD')`,
          n: sql<number>`sum(${schema.parcels.quantity})::int`,
        })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, cid), gte(schema.parcels.receivedAt, addDays(today, -13))))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db()
        .select({ n: count() })
        .from(schema.residents)
        .where(and(eq(schema.residents.communityId, cid), eq(schema.residents.status, 'active'))),
      db().select({ n: count() }).from(schema.units).where(and(eq(schema.units.communityId, cid), eq(schema.units.status, 'active'))),
      db()
        .select({ n: count() })
        .from(schema.units)
        .where(
          and(
            eq(schema.units.communityId, cid),
            eq(schema.units.status, 'active'),
            sql`not exists (select 1 from app.residents r where r.unit_id = ${schema.units.id} and r.status = 'active')`,
          ),
        ),
      getUsage(cid),
    ]);

  // 補齊沒有包裹的日子
  const dailyMap = new Map(daily.map((d) => [d.day, d.n]));
  const days: { day: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: community.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    days.push({ day: key, n: dailyMap.get(key) ?? 0 });
  }

  return {
    receivedToday: receivedToday?.n ?? 0,
    pickedToday: pickedToday?.n ?? 0,
    waiting: waiting?.n ?? 0,
    waitingUnits: waiting?.units ?? 0,
    overdue: overdue?.n ?? 0,
    avgPickupHours: avgPickup?.hours ?? null,
    byCarrier,
    days,
    residents: residents?.n ?? 0,
    units: units?.n ?? 0,
    unboundUnits: unbound?.n ?? 0,
    usage,
    overdueDays: settings.overdueDays,
  };
}

/** 平台總覽 */
export async function platformStats() {
  const [[communities], [parcels30], [residents], statusRows] = await Promise.all([
    db().select({ n: count() }).from(schema.communities),
    db()
      .select({ n: count() })
      .from(schema.parcels)
      .where(gte(schema.parcels.receivedAt, addDays(new Date(), -30))),
    db().select({ n: count() }).from(schema.residents).where(eq(schema.residents.status, 'active')),
    db()
      .select({ status: schema.communities.status, n: count() })
      .from(schema.communities)
      .groupBy(schema.communities.status),
  ]);
  return {
    communities: communities?.n ?? 0,
    parcels30: parcels30?.n ?? 0,
    residents: residents?.n ?? 0,
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.n])) as Record<string, number>,
  };
}
