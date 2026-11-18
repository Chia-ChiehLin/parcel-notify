/**
 * 權限與 tenant 隔離規則（不依賴 Next.js，方便測試）。
 *
 * - 平台管理員：所有社區都有完整權限
 * - 物業公司管理者（org_admin）：旗下所有社區都有社區管理者權限
 * - 社區管理者（community_admin）：只限自己的社區
 * - 警衛／櫃台（staff）：只限自己的社區，只能做收發相關操作
 */
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { MembershipRole } from '@/db/schema';

export type EffectiveRole = MembershipRole | 'platform_admin';

export const ROLE_RANK: Record<EffectiveRole, number> = {
  staff: 1,
  community_admin: 2,
  org_admin: 3,
  platform_admin: 4,
};

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  staff: '警衛／櫃台',
  community_admin: '社區管理者',
  org_admin: '物業公司管理者',
  platform_admin: '平台管理員',
};

export function hasRole(role: EffectiveRole | null | undefined, min: MembershipRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

type UserLike = { id: string; isPlatformAdmin: boolean };
type CommunityLike = { id: string; orgId: string };

export async function getEffectiveRole(user: UserLike, community: CommunityLike): Promise<EffectiveRole | null> {
  if (user.isPlatformAdmin) return 'platform_admin';
  const rows = await db()
    .select({ role: schema.memberships.role, orgId: schema.memberships.orgId, communityId: schema.memberships.communityId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        or(eq(schema.memberships.communityId, community.id), eq(schema.memberships.orgId, community.orgId)),
      ),
    );
  let best: EffectiveRole | null = null;
  for (const r of rows) {
    const role: EffectiveRole = r.orgId ? 'org_admin' : r.role;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

/** 使用者可以進入的社區清單（平台管理員回傳全部） */
export async function listAccessibleCommunities(user: UserLike) {
  const cols = {
    id: schema.communities.id,
    name: schema.communities.name,
    slug: schema.communities.slug,
    orgId: schema.communities.orgId,
    status: schema.communities.status,
  };
  if (user.isPlatformAdmin) {
    return db().select(cols).from(schema.communities).orderBy(asc(schema.communities.name));
  }
  const mems = await db().select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
  const communityIds = mems.filter((m) => m.communityId).map((m) => m.communityId!);
  const orgIds = mems.filter((m) => m.orgId).map((m) => m.orgId!);
  if (!communityIds.length && !orgIds.length) return [];
  const conds = [];
  if (communityIds.length) conds.push(inArray(schema.communities.id, communityIds));
  if (orgIds.length) conds.push(inArray(schema.communities.orgId, orgIds));
  return db()
    .select(cols)
    .from(schema.communities)
    .where(or(...conds))
    .orderBy(asc(schema.communities.name));
}

export async function listOrgAdminOrgIds(userId: string) {
  const rows = await db()
    .select({ orgId: schema.memberships.orgId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), isNotNull(schema.memberships.orgId)));
  return rows.map((r) => r.orgId!);
}
