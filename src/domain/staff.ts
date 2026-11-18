import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { MembershipRole } from '@/db/schema';
import { createAuthToken, normalizeEmail } from '@/auth/core';
import { reservePasswordReset } from '@/auth/rate-limit';
import { emailGateway } from '@/channels/gateway';
import { simpleEmail } from '@/channels/messages';
import { appUrl, brandName } from '@/lib/env';
import { audit, type Actor } from './audit';
import { assertWithinStaffLimit } from './communities';
import { DomainError, type Scope } from './types';

const INVITE_TTL_HOURS = 72;

export async function listStaff(communityId: string) {
  const members = await db()
    .select({ membership: schema.memberships, user: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.communityId, communityId))
    .orderBy(desc(schema.memberships.role), schema.users.name);
  const invites = await db()
    .select()
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.kind, 'invite'),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, new Date()),
        sql`${schema.authTokens.payload}->>'communityId' = ${communityId}`,
      ),
    )
    .orderBy(desc(schema.authTokens.createdAt));
  return { members, invites };
}

async function sendInviteEmail(email: string, url: string, where: string, roleLabel: string) {
  if (!emailGateway().isConfigured()) return false;
  try {
    await emailGateway().send({
      to: email,
      ...simpleEmail(`${brandName()} 邀請您加入「${where}」`, [`您被邀請以「${roleLabel}」身分使用${brandName()}。`, `請在 ${INVITE_TTL_HOURS} 小時內點下方按鈕設定密碼。`], {
        label: '接受邀請',
        url,
      }),
    });
    return true;
  } catch {
    console.error('[invite] email failed');
    return false;
  }
}

const ROLE_NAMES: Record<MembershipRole, string> = {
  staff: '警衛／櫃台',
  community_admin: '社區管理者',
  org_admin: '物業公司管理者',
};

/** 邀請社區人員；回傳邀請連結（沒有設定 Email 時由管理者自行轉交） */
export async function inviteStaff(
  scope: Scope & { communityName: string; invitedBy: string },
  input: { email: string; name?: string; role: 'staff' | 'community_admin' },
) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
  const token = await db().transaction(async (tx) => {
    const [community] = await tx.select({ id: schema.communities.id }).from(schema.communities)
      .where(eq(schema.communities.id, scope.communityId)).for('update');
    if (!community) throw new DomainError('找不到社區');
    const [existing] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(and(eq(schema.users.email, email), eq(schema.memberships.communityId, scope.communityId)))
      .limit(1);
    if (existing) throw new DomainError('這位人員已經在社區裡了');
    await tx.update(schema.authTokens).set({ usedAt: new Date() }).where(and(
      eq(schema.authTokens.kind, 'invite'), eq(schema.authTokens.email, email), isNull(schema.authTokens.usedAt),
      sql`${schema.authTokens.payload}->>'communityId' = ${scope.communityId}`,
    ));
    await assertWithinStaffLimit(scope.communityId, tx);
    return createAuthToken({
      kind: 'invite',
      email,
      payload: { role: input.role, communityId: scope.communityId, name: input.name?.trim() },
      createdBy: scope.invitedBy,
      ttlHours: INVITE_TTL_HOURS,
    }, tx);
  });
  const url = `${appUrl()}/invite/${token}`;
  const emailed = await sendInviteEmail(email, url, scope.communityName, ROLE_NAMES[input.role]);
  await audit(scope.actor, 'staff.invite', { communityId: scope.communityId, entityType: 'user', data: { email, role: input.role, emailed } });
  return { url, emailed };
}

/** 平台管理員邀請物業公司管理者或社區管理者 */
export async function inviteByPlatform(
  actor: Actor & { id: string },
  input: { email: string; name?: string; role: MembershipRole; orgId?: string; communityId?: string; where: string },
) {
  if (input.role !== 'org_admin') {
    if (!input.communityId) throw new DomainError('請選擇社區');
    return inviteStaff({ actor, invitedBy: actor.id, communityName: input.where, communityId: input.communityId },
      { email: input.email, name: input.name, role: input.role });
  }
  if (!input.orgId || input.communityId) throw new DomainError('請選擇物業公司');
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
  const token = await createAuthToken({
    kind: 'invite',
    email,
    payload: { role: input.role, orgId: input.orgId, communityId: input.communityId, name: input.name?.trim() },
    createdBy: actor.id,
    ttlHours: INVITE_TTL_HOURS,
  });
  const url = `${appUrl()}/invite/${token}`;
  const emailed = await sendInviteEmail(email, url, input.where, ROLE_NAMES[input.role]);
  await audit(actor, 'staff.invite', { communityId: input.communityId ?? null, entityType: 'user', data: { email, role: input.role, orgId: input.orgId, emailed } });
  return { url, emailed };
}

export async function revokeInvite(scope: Scope, inviteId: string) {
  await db()
    .update(schema.authTokens)
    .set({ expiresAt: new Date() })
    .where(and(eq(schema.authTokens.id, inviteId), sql`${schema.authTokens.payload}->>'communityId' = ${scope.communityId}`));
}

export async function removeStaff(scope: Scope & { selfUserId: string }, membershipId: string) {
  const [m] = await db()
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.communityId, scope.communityId)));
  if (!m) throw new DomainError('找不到這位人員');
  if (m.userId === scope.selfUserId) throw new DomainError('不能移除自己');
  await db().delete(schema.memberships).where(eq(schema.memberships.id, membershipId));
  await audit(scope.actor, 'staff.remove', { communityId: scope.communityId, entityType: 'user', entityId: m.userId });
}

export async function changeStaffRole(scope: Scope & { selfUserId: string }, membershipId: string, role: 'staff' | 'community_admin') {
  if (role !== 'staff' && role !== 'community_admin') throw new DomainError('角色不正確');
  const [m] = await db()
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.communityId, scope.communityId)));
  if (!m) throw new DomainError('找不到這位人員');
  if (m.userId === scope.selfUserId) throw new DomainError('不能變更自己的角色');
  await db().update(schema.memberships).set({ role }).where(eq(schema.memberships.id, membershipId));
  await audit(scope.actor, 'staff.role', { communityId: scope.communityId, entityType: 'user', entityId: m.userId, data: { role } });
}

/** 忘記密碼：不論帳號是否存在都回傳成功，避免被用來探測帳號 */
export async function requestPasswordReset(emailRaw: string, ip: string | null = null) {
  const email = normalizeEmail(emailRaw);
  if (!emailGateway().isConfigured()) throw new DomainError('目前未開通重設密碼信，請聯絡服務商協助重設。');
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
  if (!(await reservePasswordReset(email, ip))) return { emailed: false };
  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user || user.status !== 'active' || !user.passwordHash) return { emailed: false };
  const token = await createAuthToken({ kind: 'reset', email, userId: user.id, ttlHours: 2 });
  const url = `${appUrl()}/reset/${token}`;
  try {
    await emailGateway().send({
      to: email,
      ...simpleEmail(`重設您的${brandName()}密碼`, ['我們收到重設密碼的要求。如果不是您本人操作，請忽略這封信。', '連結 2 小時內有效。'], { label: '重設密碼', url }),
    });
  } catch {
    console.error('[reset] 重設密碼信寄送失敗');
    return { emailed: false };
  }
  return { emailed: true };
}

/** 平台管理員協助產生重設密碼連結（客戶沒收到信時） */
export async function createResetLinkForUser(actor: Actor, userId: string) {
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new DomainError('找不到使用者');
  const token = await createAuthToken({ kind: 'reset', email: user.email, userId: user.id, ttlHours: 24 });
  await audit(actor, 'user.password_reset', { entityType: 'user', entityId: userId });
  return `${appUrl()}/reset/${token}`;
}
