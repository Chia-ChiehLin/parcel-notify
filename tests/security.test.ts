import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getEffectiveRole, listAccessibleCommunities } from '@/auth/access';
import { authenticate } from '@/auth/core';
import { hashPassword } from '@/auth/password';
import { decrypt, encrypt } from '@/lib/crypto';
import { getParcel, registerParcels } from '@/domain/parcels';
import { confirmPickup, lookupForPickup } from '@/domain/pickup';
import { bindByCode, normalizeBindCode } from '@/domain/residents';
import { parsePickupQr, parseResidentToken, pickupQrPayload, residentToken } from '@/domain/tokens';
import { getUnit, updateUnit } from '@/domain/units';
import { configureChannel } from '@/domain/line-channels';
import { ADMIN, makeCommunity, TEST_SECRET, TEST_TOKEN } from './helpers';

describe('tenant 隔離', () => {
  it('A 社區的範圍讀不到、改不到 B 社區的資料', async () => {
    const a = await makeCommunity({ slug: 'comm-a' });
    const b = await makeCommunity({ slug: 'comm-b' });
    const bUnit = b.unit('A-1-1');
    const { parcels } = await registerParcels(b.scope, [{ unitId: bUnit.id }], { notify: false });

    await expect(getUnit(a.community.id, bUnit.id)).rejects.toThrow('找不到這個戶別');
    await expect(updateUnit(a.scope, bUnit.id, { label: 'HACK', status: 'active' })).rejects.toThrow();
    await expect(getParcel(a.community.id, parcels[0].id)).rejects.toThrow('找不到這件包裹');
    await expect(confirmPickup(a.scope, { parcelIds: [parcels[0].id], expectedUnitId: bUnit.id, method: 'manual', pickupName: 'x' })).rejects.toThrow('有包裹不存在');
    await expect(registerParcels(a.scope, [{ unitId: bUnit.id }], { notify: false })).rejects.toThrow('戶別不存在');

    // 取件碼只在自己的社區查得到
    const lookup = await lookupForPickup(a.community.id, parcels[0].pickupCode);
    expect(lookup.kind).not.toBe('unit');
    const [still] = await db().select().from(schema.units).where(eq(schema.units.id, bUnit.id));
    expect(still.label).toBe('A-1-1');
  });

  it('B 社區住戶的取件 QR 在 A 社區無效', async () => {
    const a = await makeCommunity({ slug: 'comm-a' });
    const b = await makeCommunity({ slug: 'comm-b' });
    const bind = await bindByCode({ channel: b.channel!, lineUserId: 'U-b', code: b.unit('A-1-1').bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    const res = await lookupForPickup(a.community.id, pickupQrPayload(bind.resident.id));
    expect(res).toEqual({ kind: 'error', message: '這個 QR code 不屬於本社區，或住戶已被移除' });
  });

  it('角色：社區人員只能進自己的社區；物業公司管理者可以進旗下所有社區', async () => {
    const a = await makeCommunity({ slug: 'comm-a' });
    const b = await makeCommunity({ slug: 'comm-b' });
    const [guard] = await db().insert(schema.users).values({ email: 'guard@x.com', name: '警衛' }).returning();
    await db().insert(schema.memberships).values({ userId: guard.id, communityId: a.community.id, role: 'staff' });
    expect(await getEffectiveRole(guard, a.community)).toBe('staff');
    expect(await getEffectiveRole(guard, b.community)).toBeNull();
    expect((await listAccessibleCommunities(guard)).map((c) => c.slug)).toEqual(['comm-a']);

    const [boss] = await db().insert(schema.users).values({ email: 'boss@x.com', name: '經理' }).returning();
    await db().insert(schema.memberships).values({ userId: boss.id, orgId: a.community.orgId, role: 'org_admin' });
    expect(await getEffectiveRole(boss, a.community)).toBe('org_admin');
    expect(await getEffectiveRole(boss, b.community)).toBeNull();
  });
});

describe('綁定安全', () => {
  it('綁定碼正規化', () => {
    expect(normalizeBindCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeBindCode('綁定 ABCDEFGH')).toBe('ABCDEFGH');
    expect(normalizeBindCode('我的包裹')).toBeNull();
    expect(normalizeBindCode('ABCDEFG')).toBeNull();
    expect(normalizeBindCode('ABCDEFG0')).toBeNull(); // 0 不在字母表中
  });

  it('連續輸錯 5 次會被鎖住，正確的碼也不能用', async () => {
    const { channel, unit } = await makeCommunity();
    for (let i = 0; i < 5; i++) {
      expect((await bindByCode({ channel: channel!, lineUserId: 'U-brute', code: 'ZZZZZZZZ' })).status).toBe('bad_code');
    }
    expect((await bindByCode({ channel: channel!, lineUserId: 'U-brute', code: unit('A-1-1').bindCode })).status).toBe('locked');
    // 其他人不受影響
    expect((await bindByCode({ channel: channel!, lineUserId: 'U-other', code: unit('A-1-1').bindCode })).status).toBe('bound');
  });

  it('自有官方帳號的社區，綁定碼不能在共用帳號使用', async () => {
    const { community, channel: shared, unit, scope } = await makeCommunity();
    const own = await configureChannel(ADMIN, { communityId: community.id, name: '自有', channelSecret: TEST_SECRET.replace('0', 'f'), accessToken: TEST_TOKEN + 'own', setupWebhook: true });
    await db().update(schema.communities).set({ lineMode: 'own' }).where(eq(schema.communities.id, community.id));
    expect((await bindByCode({ channel: shared!, lineUserId: 'U-x', code: unit('A-1-1').bindCode })).status).toBe('wrong_channel');
    expect((await bindByCode({ channel: own.channel, lineUserId: 'U-x', code: unit('A-1-1').bindCode })).status).toBe('bound');
    void scope;
  });
});

describe('簽章與加密', () => {
  it('住戶連結被竄改或版本過期就失效', async () => {
    const token = residentToken({ id: '11111111-1111-1111-1111-111111111111', tokenVersion: 2 });
    expect(parseResidentToken(token)).toEqual({ residentId: '11111111-1111-1111-1111-111111111111', version: 2 });
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect(parseResidentToken(tampered)).toBeNull();
    expect(parseResidentToken('garbage')).toBeNull();
  });

  it('取件 QR 10 分鐘後過期', () => {
    const now = Date.now();
    const qr = pickupQrPayload('r1', now);
    expect(parsePickupQr(qr, now + 60_000)).toEqual({ residentId: 'r1' });
    expect(parsePickupQr(qr, now + 11 * 60_000)).toEqual({ error: 'expired' });
    expect(parsePickupQr(qr.replace('PNQR:', 'PNQR:x'), now)).toEqual({ error: 'invalid' });
  });

  it('LINE 金鑰加密後可以解回來，密文每次不同', () => {
    const a = encrypt('secret-token');
    const b = encrypt('secret-token');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('secret-token');
    expect(() => decrypt(a.slice(0, -4) + 'AAAA')).toThrow();
  });
});

describe('登入', () => {
  it('密碼錯誤 5 次後鎖定 15 分鐘', async () => {
    await db().insert(schema.users).values({ email: 'staff@x.com', name: 'S', passwordHash: await hashPassword('Correct123') });
    for (let i = 0; i < 5; i++) expect((await authenticate('staff@x.com', 'wrong', '1.1.1.1')).ok).toBe(false);
    const locked = await authenticate('staff@x.com', 'Correct123', '1.1.1.1');
    expect(locked).toEqual({ ok: false, error: '登入失敗次數過多，請 15 分鐘後再試' });
  });

  it('Email 不分大小寫、停用的帳號不能登入', async () => {
    const [u] = await db().insert(schema.users).values({ email: 'a@x.com', name: 'A', passwordHash: await hashPassword('Correct123') }).returning();
    expect((await authenticate('  A@X.com ', 'Correct123', null)).ok).toBe(true);
    await db().update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.id, u.id));
    expect((await authenticate('a@x.com', 'Correct123', null)).ok).toBe(false);
  });
});
