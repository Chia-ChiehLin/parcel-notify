import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { cache } from 'react';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { MembershipRole } from '@/db/schema';
import type { Actor } from '@/domain/audit';
import { audit } from '@/domain/audit';
import { parseSettings } from '@/domain/settings';
import { createSessionRecord, deleteSessionToken, validateSessionToken } from './core';
import { getEffectiveRole, hasRole, type EffectiveRole } from './access';

const COOKIE = 'pn_session';

export async function requestMeta() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { ip, userAgent: h.get('user-agent') };
}

export async function startSession(userId: string) {
  const meta = await requestMeta();
  const { token, expiresAt } = await createSessionRecord(userId, meta);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await deleteSessionToken(token);
  jar.delete(COOKIE);
}

/** 目前登入的使用者（同一個 request 只查一次） */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const result = await validateSessionToken(token);
  return result?.user ?? null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) notFound();
  return user;
}

export async function actorFor(user: { id: string; name: string }): Promise<Actor> {
  const { ip } = await requestMeta();
  return { type: 'user', id: user.id, name: user.name, ip };
}

export type CommunityContext = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  community: typeof schema.communities.$inferSelect;
  role: EffectiveRole;
  settings: ReturnType<typeof parseSettings>;
  actor: Actor;
  /** 社區被停用時只能查看和交付，不能登記新包裹或發通知 */
  readOnly: boolean;
};

const loadCommunityBySlug = cache(async (slug: string) => {
  const [c] = await db().select().from(schema.communities).where(eq(schema.communities.slug, slug)).limit(1);
  return c ?? null;
});

/**
 * 社區後台的權限檢查。每個頁面和 server action 都要呼叫，
 * 回傳的 community.id 是後續所有查詢唯一可用的 tenant 範圍。
 */
export async function requireCommunity(slug: string, minRole: MembershipRole = 'staff'): Promise<CommunityContext> {
  const user = await requireUser();
  const community = await loadCommunityBySlug(slug);
  if (!community) notFound();
  const role = await getEffectiveRole(user, community);
  if (!role) notFound();
  if (!hasRole(role, minRole)) redirect(`/c/${slug}?denied=1`);
  const actor = await actorFor(user);
  return {
    user,
    community,
    role,
    settings: parseSettings(community.settings),
    actor,
    readOnly: community.status === 'suspended' || community.status === 'cancelled',
  };
}

/** 平台管理員進入客戶社區時留下稽核紀錄（同一人同一社區 12 小時內只記一次） */
export async function logPlatformAccess(ctx: CommunityContext) {
  if (ctx.role !== 'platform_admin') return;
  const since = new Date(Date.now() - 12 * 3_600_000);
  const [recent] = await db()
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.communityId, ctx.community.id),
        eq(schema.auditLogs.action, 'community.platform_access'),
        eq(schema.auditLogs.actorId, ctx.user.id),
        gt(schema.auditLogs.createdAt, since),
      ),
    )
    .limit(1);
  if (recent) return;
  await audit(ctx.actor, 'community.platform_access', {
    communityId: ctx.community.id,
    entityType: 'community',
    entityId: ctx.community.id,
  });
}
