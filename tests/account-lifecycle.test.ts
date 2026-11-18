import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { acceptInvite, createAuthToken, createFirstPlatformAdmin, createSessionRecord, findValidAuthToken, resetPassword, validateSessionToken } from '@/auth/core';
import { hashPassword } from '@/auth/password';
import { requestPasswordReset } from '@/domain/staff';
import { deleteFiles, getFile, newFileKey, putFile } from '@/storage';
import { fakes, makeCommunity } from './helpers';

describe('帳號生命週期', () => {
  it('同時完成首次設定只建立一位平台管理員', async () => {
    const results = await Promise.all(['one', 'two'].map((name) => createFirstPlatformAdmin({
      email: `${name}@example.com`, name, password: 'Example123',
    })));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isPlatformAdmin, true))).toHaveLength(1);
  });

  it('接受邀請後，相同社區的舊連結同時失效，其他社區的邀請仍可使用', async () => {
    const a = await makeCommunity({ slug: 'invite-a' });
    const b = await makeCommunity({ slug: 'invite-b' });
    const email = 'guard@example.com';
    const invite = (communityId: string) => createAuthToken({ kind: 'invite', email, ttlHours: 1, payload: { role: 'staff', communityId } });
    const [older, latest, another] = await Promise.all([invite(a.community.id), invite(a.community.id), invite(b.community.id)]);
    const credentials = { name: '警衛', password: 'Example123' };
    expect((await acceptInvite(latest, credentials)).ok).toBe(true);
    expect(await findValidAuthToken(older, 'invite')).toBeNull();
    expect((await acceptInvite(another, credentials)).ok).toBe(true);
    expect(await db().select({ id: schema.memberships.id }).from(schema.memberships)).toHaveLength(2);
  });

  it('一次重設使同帳號所有舊連結與登入階段失效', async () => {
    const [user] = await db().insert(schema.users).values({ email: 'staff@example.com', name: 'Staff', passwordHash: await hashPassword('OldCode123') }).returning();
    const session = await createSessionRecord(user, {});
    const makeToken = () => createAuthToken({ kind: 'reset', email: user.email, userId: user.id, ttlHours: 1 });
    const [first, second] = await Promise.all([makeToken(), makeToken()]);
    const results = await Promise.all([resetPassword(first, 'NewCode123'), resetPassword(second, 'NewCode456')]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await findValidAuthToken(first, 'reset')).toBeNull();
    expect(await findValidAuthToken(second, 'reset')).toBeNull();
    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it('相同帳號一小時最多寄出三封密碼重設信', async () => {
    const email = 'staff@example.com';
    await db().insert(schema.users).values({ email, name: 'Staff', passwordHash: await hashPassword('OldCode123') });
    await Promise.all(Array.from({ length: 5 }, () => requestPasswordReset(email)));
    expect(fakes.email.map((m) => m.to)).toEqual([email, email, email]);
  });
});

it('啟用 Blob 後仍可存取並依期限清除先前保存在資料庫的影像', async () => {
  const { community } = await makeCommunity();
  const key = newFileKey(community.id, 'photo', 'png');
  const image = Buffer.from('測試資料');
  await putFile(community.id, key, image, 'image/png');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'unused-test-placeholder');
  try {
    expect(await getFile(key)).toEqual({ body: image, contentType: 'image/png' });
    await deleteFiles([key]);
    expect(await db().select({ key: schema.files.key }).from(schema.files).where(eq(schema.files.key, key))).toHaveLength(0);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('平台與社區共用人員名額，重新邀請同一人只佔用一個名額', async () => {
  const { inviteStaff, inviteByPlatform } = await import('@/domain/staff');
  const { ADMIN } = await import('./helpers');
  const { scope, community } = await makeCommunity();
  const [sender] = await db().insert(schema.users).values({ email: 'operator@example.com', name: '平台' }).returning();
  await db().update(schema.plans).set({ maxStaff: 1 }).where(eq(schema.plans.id, community.planId));
  const recipient = { email: 'desk@example.com', role: 'staff' as const };
  const options = { ...scope, communityName: community.name, invitedBy: sender.id };
  const first = await inviteStaff(options, recipient);
  const latest = await inviteByPlatform({ ...ADMIN, id: sender.id }, { ...recipient, communityId: community.id, where: community.name });
  expect(await findValidAuthToken(first.url.split('/').at(-1)!, 'invite')).toBeNull();
  expect(await findValidAuthToken(latest.url.split('/').at(-1)!, 'invite')).not.toBeNull();
  await expect(inviteStaff(options, { email: 'another@example.com', role: 'staff' })).rejects.toThrow('人員帳號上限');
});
