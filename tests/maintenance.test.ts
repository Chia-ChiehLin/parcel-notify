import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { addBillingRecord } from '@/domain/billing';
import { applyExpiry } from '@/domain/communities';
import { purgeExpiredData, sendReminders } from '@/domain/maintenance';
import { registerParcels } from '@/domain/parcels';
import { confirmPickup } from '@/domain/pickup';
import { bindByCode } from '@/domain/residents';
import { dashboardStats } from '@/domain/stats';
import { addDays } from '@/lib/time';
import { ADMIN, fakes, makeCommunity } from './helpers';

describe('逾期提醒', () => {
  it('超過逾期天數才提醒、同戶合併、遵守間隔與次數上限', async () => {
    const { scope, channel, unit } = await makeCommunity({ settings: { overdueDays: 3, reminderIntervalDays: 2, maxReminders: 2 } });
    const u = unit('A-1-1');
    await bindByCode({ channel: channel!, lineUserId: 'U-remind', code: u.bindCode });
    const { parcels } = await registerParcels(scope, [{ unitId: u.id }, { unitId: u.id }], { notify: false });
    const now = new Date();

    expect((await sendReminders(now)).units).toBe(0);

    await db().update(schema.parcels).set({ receivedAt: addDays(now, -4) }).where(eq(schema.parcels.unitId, u.id));
    expect(await sendReminders(now)).toEqual({ units: 1, parcels: 2 });
    expect(fakes.pushes()).toHaveLength(1);
    expect(JSON.stringify(fakes.pushes()[0].messages)).toContain('尚未領取');

    // 間隔內不重複提醒
    expect((await sendReminders(addDays(now, 1))).units).toBe(0);
    expect((await sendReminders(addDays(now, 2))).units).toBe(1);
    // 已達上限
    expect((await sendReminders(addDays(now, 5))).units).toBe(0);
    const [p] = await db().select().from(schema.parcels).where(eq(schema.parcels.id, parcels[0].id));
    expect(p.reminderCount).toBe(2);
  });
});

describe('到期與收款', () => {
  it('試用到期自動停用；記錄收款後恢復並延長期限', async () => {
    const { community } = await makeCommunity();
    await db().update(schema.communities).set({ trialEndsAt: addDays(new Date(), -1) }).where(eq(schema.communities.id, community.id));
    expect(await applyExpiry()).toEqual([community.id]);
    const [suspended] = await db().select().from(schema.communities).where(eq(schema.communities.id, community.id));
    expect(suspended.status).toBe('suspended');

    const res = await addBillingRecord(ADMIN, community.id, { amount: 11880, periodStart: '2026-11-18', periodEnd: '2027-11-17', paidAt: '2026-11-18', method: '匯款' });
    expect(res.paidUntil).toBe('2027-11-17');
    const [active] = await db().select().from(schema.communities).where(eq(schema.communities.id, community.id));
    expect(active.status).toBe('active');
    expect(await applyExpiry()).toEqual([]);
  });

  it('付費到期超過寬限期才停用', async () => {
    const { community } = await makeCommunity();
    await db().update(schema.communities).set({ status: 'active', paidUntil: '2026-01-01' }).where(eq(schema.communities.id, community.id));
    expect(await applyExpiry(new Date('2026-01-05T12:00:00+08:00'))).toEqual([]);
    expect(await applyExpiry(new Date('2026-01-10T12:00:00+08:00'))).toEqual([community.id]);
  });
});

describe('資料保留', () => {
  it('同次交付共用簽名，刪除較早收件的包裹後其他包裹仍保有簽名', async () => {
    const { scope, unit } = await makeCommunity({ settings: { retentionDays: 30, photoRetentionDays: 30 } });
    const unitId = unit('A-1-1').id;
    const { parcels } = await registerParcels(scope, [{ unitId }, { unitId }], { notify: false });
    await db().update(schema.parcels).set({ receivedAt: addDays(new Date(), -40) }).where(eq(schema.parcels.id, parcels[0].id));
    await confirmPickup(scope, {
      parcelIds: parcels.map((p) => p.id), expectedUnitId: unitId, pickupName: '住戶', method: 'manual',
      signature: { data: Buffer.from('test signature'), contentType: 'image/png', ext: 'png' },
    });
    expect((await purgeExpiredData()).records).toBe(1);
    const [recent] = await db().select().from(schema.parcels);
    const [file] = await db().select().from(schema.files);
    expect(file.key).toBe(recent.signatureKey);
  });

  it('刪除過期的照片與紀錄，待領取的包裹不刪', async () => {
    const { scope, unit } = await makeCommunity({ settings: { retentionDays: 30, photoRetentionDays: 7 } });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const { parcels } = await registerParcels(
      scope,
      [
        { unitId: unit('A-1-1').id, photo: { data: jpeg, contentType: 'image/jpeg', ext: 'jpg' } },
        { unitId: unit('A-1-2').id },
        { unitId: unit('A-2-1').id },
      ],
      { notify: false },
    );
    expect(await db().select().from(schema.files)).toHaveLength(1);
    const now = new Date();
    // 第 1 件：10 天前已領取（照片該刪、紀錄保留）
    await db().update(schema.parcels).set({ status: 'picked_up', pickedUpAt: addDays(now, -10), receivedAt: addDays(now, -11) }).where(eq(schema.parcels.id, parcels[0].id));
    // 第 2 件：40 天前已領取（整筆刪除）
    await db().update(schema.parcels).set({ status: 'picked_up', pickedUpAt: addDays(now, -39), receivedAt: addDays(now, -40) }).where(eq(schema.parcels.id, parcels[1].id));
    // 第 3 件：40 天前到件但還沒領（不刪）
    await db().update(schema.parcels).set({ receivedAt: addDays(now, -40) }).where(eq(schema.parcels.id, parcels[2].id));

    const res = await purgeExpiredData(now);
    expect(res).toEqual({ photos: 1, records: 1 });
    const left = await db().select().from(schema.parcels);
    expect(left.map((p) => p.id).sort()).toEqual([parcels[0].id, parcels[2].id].sort());
    expect(left.find((p) => p.id === parcels[0].id)!.photoKey).toBeNull();
    expect(await db().select().from(schema.files)).toHaveLength(0);
  });
});

describe('儀表板統計', () => {
  it('今日收件、待領、逾期', async () => {
    const { scope, unit, community } = await makeCommunity({ settings: { overdueDays: 2 } });
    const { parcels } = await registerParcels(scope, [{ unitId: unit('A-1-1').id, quantity: 3, carrier: '新竹物流' }, { unitId: unit('B-1-1').id }], { notify: false });
    await db().update(schema.parcels).set({ receivedAt: addDays(new Date(), -3) }).where(eq(schema.parcels.id, parcels[1].id));
    const s = await dashboardStats(community);
    expect(s.receivedToday).toBe(3);
    expect(s.waiting).toBe(4);
    expect(s.waitingUnits).toBe(2);
    expect(s.overdue).toBe(1);
    expect(s.days).toHaveLength(14);
    expect(s.byCarrier.find((c) => c.carrier === '新竹物流')?.n).toBe(3);
  });
});
