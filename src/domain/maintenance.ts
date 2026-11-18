import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { purgeExpiredAuthData } from '@/auth/core';
import { purgeOldAttempts } from '@/auth/rate-limit';
import { addDays } from '@/lib/time';
import { deleteFiles } from '@/storage';
import { audit, SYSTEM_ACTOR } from './audit';
import { applyExpiry } from './communities';
import { notifyUnitParcels } from './notify';
import { removePhotos } from './parcels';
import { parseSettings } from './settings';

/** 逾期未領提醒：每戶合併成一則 */
export async function sendReminders(now = new Date()) {
  const communities = await db()
    .select()
    .from(schema.communities)
    .where(inArray(schema.communities.status, ['trial', 'active']));
  let units = 0;
  let parcels = 0;
  for (const community of communities) {
    const s = parseSettings(community.settings);
    if (s.maxReminders <= 0) continue;
    const overdueBefore = addDays(now, -s.overdueDays);
    const remindBefore = addDays(now, -s.reminderIntervalDays);
    const due = await db()
      .select({ id: schema.parcels.id, unitId: schema.parcels.unitId })
      .from(schema.parcels)
      .where(
        and(
          eq(schema.parcels.communityId, community.id),
          eq(schema.parcels.status, 'waiting'),
          lte(schema.parcels.receivedAt, overdueBefore),
          lt(schema.parcels.reminderCount, s.maxReminders),
          or(isNull(schema.parcels.lastRemindedAt), lte(schema.parcels.lastRemindedAt, remindBefore)),
        ),
      );
    const byUnit = new Map<string, string[]>();
    for (const p of due) byUnit.set(p.unitId, [...(byUnit.get(p.unitId) ?? []), p.id]);
    for (const [unitId, ids] of byUnit) {
      const result = await notifyUnitParcels(community, unitId, ids, 'reminder');
      await db()
        .update(schema.parcels)
        .set({ reminderCount: sql`${schema.parcels.reminderCount} + 1`, lastRemindedAt: now })
        .where(inArray(schema.parcels.id, ids));
      await audit(SYSTEM_ACTOR, 'parcel.remind', {
        communityId: community.id,
        entityType: 'unit',
        entityId: unitId,
        data: { parcelIds: ids, status: result.status },
      });
      units++;
      parcels += ids.length;
    }
  }
  return { units, parcels };
}

/** 依各社區的保留期限清除照片與舊紀錄（個資最小化） */
export async function purgeExpiredData(now = new Date()) {
  const communities = await db().select().from(schema.communities);
  let photos = 0;
  let records = 0;
  for (const community of communities) {
    const s = parseSettings(community.settings);
    // 已結案的包裹：照片保留 photoRetentionDays 天
    const photoCutoff = addDays(now, -s.photoRetentionDays);
    const withPhotos = await db()
      .select({ id: schema.parcels.id })
      .from(schema.parcels)
      .where(
        and(
          eq(schema.parcels.communityId, community.id),
          inArray(schema.parcels.status, ['picked_up', 'returned', 'cancelled']),
          or(isNotNull(schema.parcels.photoKey), isNotNull(schema.parcels.signatureKey)),
          or(lte(schema.parcels.pickedUpAt, photoCutoff), lte(schema.parcels.closedAt, photoCutoff)),
        ),
      );
    photos += await removePhotos(withPhotos.map((p) => p.id));

    // 包裹紀錄保留 retentionDays 天（待領取的不刪）
    const recordCutoff = addDays(now, -s.retentionDays);
    const old = await db()
      .select({ id: schema.parcels.id, photoKey: schema.parcels.photoKey, signatureKey: schema.parcels.signatureKey })
      .from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, community.id), sql`${schema.parcels.status} <> 'waiting'`, lte(schema.parcels.receivedAt, recordCutoff)));
    if (old.length) {
      await deleteFiles(old.flatMap((p) => [p.photoKey, p.signatureKey].filter((k): k is string => !!k)));
      const ids = old.map((p) => p.id);
      for (let i = 0; i < ids.length; i += 500) {
        await db().delete(schema.parcels).where(inArray(schema.parcels.id, ids.slice(i, i + 500)));
      }
      records += ids.length;
    }
    await db()
      .delete(schema.notifications)
      .where(and(eq(schema.notifications.communityId, community.id), lte(schema.notifications.createdAt, recordCutoff)));
    await db()
      .delete(schema.proxyCodes)
      .where(and(eq(schema.proxyCodes.communityId, community.id), lte(schema.proxyCodes.expiresAt, addDays(now, -30))));
    // 稽核紀錄保留較久（至少一年），方便處理爭議
    await db()
      .delete(schema.auditLogs)
      .where(and(eq(schema.auditLogs.communityId, community.id), lte(schema.auditLogs.createdAt, addDays(now, -Math.max(365, s.retentionDays)))));
  }
  if (photos || records) {
    await audit(SYSTEM_ACTOR, 'retention.purge', { data: { photos, records } });
  }
  return { photos, records };
}

/** 每天執行一次（Vercel Cron） */
export async function runDaily(now = new Date()) {
  const suspended = await applyExpiry(now);
  const reminders = await sendReminders(now);
  const purged = await purgeExpiredData(now);
  await purgeExpiredAuthData();
  await purgeOldAttempts();
  return { suspended: suspended.length, reminders, purged };
}
