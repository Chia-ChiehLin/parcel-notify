import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { closeParcel, notifyPending, registerParcels, updateParcel } from '@/domain/parcels';
import { addEmailResident, bindByCode, removeResident } from '@/domain/residents';
import { confirmPickup, createProxyCode, listProxyCodes, lookupForPickup } from '@/domain/pickup';
import { pickupQrPayload } from '@/domain/tokens';
import { ADMIN, fakes, makeCommunity } from './helpers';

describe('核心流程：綁定 → 登記 → 合併通知 → 交付', () => {
  it('同一戶批次登記 3 件只發 1 則 LINE，掃 QR 後交付並留下稽核紀錄', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-2-1');

    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-resident-1', code: u.bindCode, displayName: '王小明' });
    expect(bind.status).toBe('bound');

    const result = await registerParcels(
      scope,
      [
        { unitId: u.id, carrier: '黑貓宅急便', categories: ['frozen'] },
        { unitId: u.id, carrier: '新竹物流' },
        { unitId: u.id, carrier: '中華郵政', categories: ['registered'] },
      ],
      { notify: true },
    );
    expect(result.parcels).toHaveLength(3);
    expect(new Set(result.parcels.map((p) => p.pickupCode)).size).toBe(3);
    expect(fakes.pushes()).toHaveLength(1);
    expect(fakes.pushes()[0].to).toBe('U-resident-1');
    expect(result.notifications[0].status).toBe('sent');

    const usage = await db().select().from(schema.usageCounters);
    expect(usage[0].linePush).toBe(1);
    expect(usage[0].parcels).toBe(3);

    // 住戶出示 QR
    if (bind.status !== 'bound') throw new Error('unreachable');
    const lookup = await lookupForPickup(scope.communityId, pickupQrPayload(bind.resident.id));
    expect(lookup.kind).toBe('unit');
    if (lookup.kind !== 'unit') throw new Error('unreachable');
    expect(lookup.parcels).toHaveLength(3);

    await confirmPickup(scope, { parcelIds: lookup.parcels.map((p) => p.id), method: 'qr', expectedUnitId: u.id, lookupProof: pickupQrPayload(bind.resident.id), residentId: bind.resident.id });
    const after = await db().select().from(schema.parcels).where(eq(schema.parcels.unitId, u.id));
    expect(after.every((p) => p.status === 'picked_up' && p.pickupName === '王小明')).toBe(true);

    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'parcel.pickup'));
    expect(logs).toHaveLength(3);
  });

  it('預設只通知主要聯絡人；開啟「同戶所有成員」後全部通知', async () => {
    const { scope, channel, unit, community } = await makeCommunity();
    const u = unit('B-1-2');
    await bindByCode({ channel: channel!, lineUserId: 'U-first', code: u.bindCode });
    await bindByCode({ channel: channel!, lineUserId: 'U-second', code: u.bindCode });

    await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(fakes.pushes().map((p) => p.to)).toEqual(['U-first']);

    fakes.reset();
    await db()
      .update(schema.communities)
      .set({ settings: { ...community.settings, notifyAllMembers: true } })
      .where(eq(schema.communities.id, community.id));
    await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(fakes.pushes().map((p) => p.to).sort()).toEqual(['U-first', 'U-second']);
  });

  it('LINE 失敗時改寄 Email', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-1-1');
    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-fail', code: u.bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    await db().update(schema.residents).set({ email: 'resident@example.com', notifyEmail: true, emailFallbackOnly: true, verifiedEmail: 'resident@example.com', emailVerifiedAt: new Date() }).where(eq(schema.residents.id, bind.resident.id));
    fakes.failLineFor.add('U-fail');

    const result = await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(fakes.email).toHaveLength(1);
    expect(fakes.email[0].to).toBe('resident@example.com');
    expect(result.notifications[0].status).toBe('partial');
  });

  it('代領碼只能用一次', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-3-2');
    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-proxy', code: u.bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    await registerParcels(scope, [{ unitId: u.id }, { unitId: u.id }], { notify: false });

    const proxy = await createProxyCode(bind.resident.id, { proxyName: '媽媽' });
    const lookup = await lookupForPickup(scope.communityId, proxy.code);
    if (lookup.kind !== 'unit') throw new Error('lookup failed');
    expect(lookup.via).toBe('proxy');
    await confirmPickup(scope, { parcelIds: [lookup.parcels[0].id], method: 'proxy', expectedUnitId: u.id, lookupProof: proxy.code, proxyCodeId: lookup.proxy!.id });

    const again = await lookupForPickup(scope.communityId, proxy.code);
    expect(again).toEqual({ kind: 'error', message: '這組代領碼已經使用過了' });
    const [picked] = await db()
      .select()
      .from(schema.parcels)
      .where(and(eq(schema.parcels.unitId, u.id), eq(schema.parcels.status, 'picked_up')));
    expect(picked.pickupName).toBe('媽媽（代領）');
  });

  it('同一收件請求重試及兩台平板同時完成批次時，包裹和付費 LINE 通知都只留一筆', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-1-1');
    await bindByCode({ channel: channel!, lineUserId: 'U-1', code: u.bindCode });
    const opts = { requestId: crypto.randomUUID(), notify: false };
    const [first, retry] = await Promise.all([registerParcels(scope, [{ unitId: u.id, quantity: 3 }], opts), registerParcels(scope, [{ unitId: u.id, quantity: 3 }], opts)]);
    expect(first.parcels[0].id).toBe(retry.parcels[0].id);
    const ids = [first.parcels[0].id];
    await Promise.all([notifyPending(scope, ids), notifyPending(scope, ids)]);
    const [usage] = await db().select().from(schema.usageCounters);
    expect(usage).toMatchObject({ parcels: 3, linePush: 1 });
    expect(fakes.pushes()).toHaveLength(1);
    const [p] = await db().select().from(schema.parcels);
    expect(p.notifyStatus).toBe('sent');
    const result = await confirmPickup(scope, { parcelIds: ids, expectedUnitId: u.id, method: 'code', lookupProof: p.pickupCode });
    expect(result.count).toBe(3);
  });

  it('更換門牌後會建立新的取件碼，清除舊戶通知狀態並通知新戶', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const old = unit('A-1-1');
    const corrected = unit('A-1-2');
    await bindByCode({ channel: channel!, lineUserId: 'U-correct', code: corrected.bindCode });
    const { parcels: [p] } = await registerParcels(scope, [{ unitId: old.id }], { notify: true });
    await updateParcel(scope, p.id, { unitId: corrected.id });
    const [updated] = await db().select().from(schema.parcels);
    expect(updated.pickupCode).not.toBe(p.pickupCode);
    expect(updated.notifyStatus).toBe('pending');
    await notifyPending(scope, [p.id]);
    expect(fakes.pushes().map((n) => n.to)).toEqual(['U-correct']);
  });

  it('兩個櫃台同時退件與交付時只完成一種結案', async () => {
    const { scope, unit } = await makeCommunity();
    const u = unit('A-1-1');
    const { parcels: [p] } = await registerParcels(scope, [{ unitId: u.id }], { notify: false });
    const results = await Promise.allSettled([
      closeParcel(scope, p.id, 'returned'),
      confirmPickup(scope, { parcelIds: [p.id], method: 'manual', expectedUnitId: u.id, pickupName: '領取人' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const logs = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, p.id));
    expect(logs.filter((l) => l.action === 'parcel.pickup' || l.action === 'parcel.return')).toHaveLength(1);
  });

  it('非主要聯絡人開啟 Email 時只加寄 Email，沒有寄件服務時會回報失敗', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-1-1');
    await bindByCode({ channel: channel!, lineUserId: 'U-primary', code: u.bindCode });
    const extra = await bindByCode({ channel: channel!, lineUserId: 'U-email', code: u.bindCode });
    if (extra.status !== 'bound') throw new Error('bind failed');
    await db().update(schema.residents).set({ notifyEmail: true, email: 'extra@example.com', verifiedEmail: 'extra@example.com', emailVerifiedAt: new Date() }).where(eq(schema.residents.id, extra.resident.id));
    await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(fakes.pushes().map((n) => n.to)).toEqual(['U-primary']);
    expect(fakes.email.map((n) => n.to)).toEqual(['extra@example.com']);

    const other = unit('A-1-2');
    const only = await addEmailResident(scope, { unitId: other.id, email: 'only@example.com', name: '住戶' });
    await db().update(schema.residents).set({ verifiedEmail: only.email, emailVerifiedAt: new Date() }).where(eq(schema.residents.id, only.id));
    fakes.emailConfigured = false;
    const result = await registerParcels(scope, [{ unitId: other.id }], { notify: true });
    expect(result.notifications[0]).toMatchObject({ status: 'failed', email: 0, failed: 1 });
  });

  it('代領碼核發上限在同時申請時仍然有效，移除住戶後不再顯示該住戶的有效代領碼', async () => {
    const { channel, unit } = await makeCommunity();
    const u = unit('A-1-1');
    const bound = await bindByCode({ channel: channel!, lineUserId: 'U-proxy-limit', code: u.bindCode });
    if (bound.status !== 'bound') throw new Error('bind failed');
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => createProxyCode(bound.resident.id, {})));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const active = await listProxyCodes(bound.resident.id);
    expect(active).toHaveLength(5);
    await removeResident(ADMIN, bound.resident.communityId, bound.resident.id);
    expect(await listProxyCodes(bound.resident.id)).toHaveLength(0);
  });

  it('停用的社區不能登記新包裹', async () => {
    const { scope, community, unit } = await makeCommunity();
    await db().update(schema.communities).set({ status: 'suspended' }).where(eq(schema.communities.id, community.id));
    await expect(registerParcels(scope, [{ unitId: unit('A-1-1').id }], { notify: true })).rejects.toThrow('社區服務已停用');
    void ADMIN;
  });
});
