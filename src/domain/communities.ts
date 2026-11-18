import { and, asc, count, desc, eq, inArray, isNull, lt, gte, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
import type { CommunityStatus, LineMode } from '@/db/schema';
import { addDays, dateKey } from '@/lib/time';
import { audit, type Actor } from './audit';
import { communitySettingsSchema, parseSettings, type CommunitySettings } from './settings';
import { DomainError } from './types';

export const STATUS_LABELS: Record<CommunityStatus, string> = {
  trial: '試用中',
  active: '使用中',
  suspended: '已停用',
  cancelled: '已解約',
};

/** 到期後的寬限天數，超過才自動停用 */
export const GRACE_DAYS = 7;

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base;
}

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    return '網址代號只能用小寫英文、數字和連字號，長度 3–40 字元';
  }
  if (['admin', 'api', 'login', 'logout', 'setup', 'invite', 'reset', 'r', 'c', 'app'].includes(slug)) {
    return '這個網址代號是系統保留字，請換一個';
  }
  return null;
}

export async function listPlans(onlyActive = false) {
  const q = db().select().from(schema.plans);
  const rows = onlyActive ? await q.where(eq(schema.plans.isActive, true)).orderBy(asc(schema.plans.sortOrder)) : await q.orderBy(asc(schema.plans.sortOrder));
  return rows;
}

export async function getCommunityWithPlan(communityId: string, database: Pick<DB, 'select'> = db()) {
  const [row] = await database
    .select({ community: schema.communities, plan: schema.plans, org: schema.organizations })
    .from(schema.communities)
    .innerJoin(schema.plans, eq(schema.communities.planId, schema.plans.id))
    .innerJoin(schema.organizations, eq(schema.communities.orgId, schema.organizations.id))
    .where(eq(schema.communities.id, communityId))
    .limit(1);
  if (!row) throw new DomainError('找不到社區');
  return row;
}

export type CreateCommunityInput = {
  orgId?: string | null;
  orgName?: string | null;
  name: string;
  slug: string;
  address?: string | null;
  planId: string;
  trialDays: number;
  lineMode: LineMode;
};

export async function createCommunity(actor: Actor, input: CreateCommunityInput) {
  const name = input.name.trim();
  if (!name) throw new DomainError('請輸入社區名稱');
  const slug = input.slug.trim().toLowerCase();
  const slugErr = validateSlug(slug);
  if (slugErr) throw new DomainError(slugErr);
  const [taken] = await db().select({ id: schema.communities.id }).from(schema.communities).where(eq(schema.communities.slug, slug)).limit(1);
  if (taken) throw new DomainError('這個網址代號已經有人使用');

  return db().transaction(async (tx) => {
    let orgId = input.orgId || null;
    if (!orgId) {
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: input.orgName?.trim() || name })
        .returning();
      orgId = org.id;
    }
    const trialDays = Math.max(0, Math.min(90, input.trialDays));
    const [community] = await tx
      .insert(schema.communities)
      .values({
        orgId,
        name,
        slug,
        address: input.address?.trim() || null,
        planId: input.planId,
        status: trialDays > 0 ? 'trial' : 'active',
        trialEndsAt: trialDays > 0 ? addDays(new Date(), trialDays) : null,
        lineMode: input.lineMode,
        settings: communitySettingsSchema.parse({}),
      })
      .returning();
    await tx.insert(schema.auditLogs).values({
      communityId: community.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorName: actor.name ?? null,
      action: 'community.create',
      entityType: 'community',
      entityId: community.id,
      data: { name, slug, planId: input.planId, trialDays },
      ip: actor.ip ?? null,
    });
    return community;
  });
}

export async function updateCommunityProfile(
  actor: Actor,
  communityId: string,
  input: { name: string; address?: string | null; timezone?: string },
) {
  const name = input.name.trim();
  if (!name) throw new DomainError('請輸入社區名稱');
  await db()
    .update(schema.communities)
    .set({ name, address: input.address?.trim() || null, updatedAt: new Date() })
    .where(eq(schema.communities.id, communityId));
  await audit(actor, 'community.update', { communityId, entityType: 'community', entityId: communityId, data: { name } });
}

export async function updateCommunitySettings(actor: Actor, communityId: string, patch: Partial<CommunitySettings>) {
  const [c] = await db().select({ settings: schema.communities.settings }).from(schema.communities).where(eq(schema.communities.id, communityId));
  if (!c) throw new DomainError('找不到社區');
  const merged = { ...parseSettings(c.settings), ...patch };
  const parsed = communitySettingsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new DomainError(`設定格式不正確：${parsed.error.issues.map((i) => i.path.join('.')).join('、')}`);
  }
  await db()
    .update(schema.communities)
    .set({ settings: parsed.data, updatedAt: new Date() })
    .where(eq(schema.communities.id, communityId));
  await audit(actor, 'community.settings', { communityId, entityType: 'community', entityId: communityId, data: patch });
  return parsed.data;
}

export async function setLineMode(actor: Actor, communityId: string, lineMode: LineMode) {
  await db().update(schema.communities).set({ lineMode, updatedAt: new Date() }).where(eq(schema.communities.id, communityId));
  await audit(actor, 'line.configure', { communityId, entityType: 'community', entityId: communityId, data: { lineMode } });
}

export async function markSetupCompleted(communityId: string) {
  await db().update(schema.communities).set({ setupCompletedAt: new Date() }).where(eq(schema.communities.id, communityId));
}

export async function setCommunityStatus(actor: Actor, communityId: string, status: CommunityStatus, reason?: string) {
  await db().update(schema.communities).set({ status, updatedAt: new Date() }).where(eq(schema.communities.id, communityId));
  await audit(actor, 'community.status', { communityId, entityType: 'community', entityId: communityId, data: { status, reason } });
}

export async function updateCommunityPlan(
  actor: Actor,
  communityId: string,
  input: { planId: string; trialEndsAt?: Date | null; paidUntil?: string | null; orgId?: string },
) {
  await db()
    .update(schema.communities)
    .set({
      planId: input.planId,
      trialEndsAt: input.trialEndsAt ?? null,
      paidUntil: input.paidUntil ?? null,
      ...(input.orgId ? { orgId: input.orgId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.communities.id, communityId));
  await audit(actor, 'community.update', {
    communityId,
    entityType: 'community',
    entityId: communityId,
    data: { planId: input.planId, trialEndsAt: input.trialEndsAt?.toISOString() ?? null, paidUntil: input.paidUntil ?? null },
  });
}

/** 目前方案的上限檢查 */
export async function assertWithinStaffLimit(communityId: string, database: Pick<DB, 'select'> = db()) {
  const { plan } = await getCommunityWithPlan(communityId, database);
  const [row] = await database
    .select({ n: count() })
    .from(schema.memberships)
    .where(eq(schema.memberships.communityId, communityId));
  const [pending] = await database
    .select({ n: count() })
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.kind, 'invite'),
        sql`${schema.authTokens.payload}->>'communityId' = ${communityId}`,
        sql`${schema.authTokens.usedAt} is null and ${schema.authTokens.expiresAt} > now()`,
      ),
    );
  if ((row?.n ?? 0) + (pending?.n ?? 0) >= plan.maxStaff) {
    throw new DomainError(`超過「${plan.name}」的人員帳號上限（${plan.maxStaff} 人），請升級方案`);
  }
}

/** 試用到期、付費到期加寬限期 → 自動停用；回傳被停用的社區 */
export async function applyExpiry(now = new Date()) {
  const c = schema.communities;
  return db().transaction(async (tx) => {
    const changes = [
      { status: 'suspended', reason: '試用到期', where: and(eq(c.status, 'trial'), isNull(c.paidUntil), lt(c.trialEndsAt, now)) },
      { status: 'suspended', reason: '付費到期', where: and(inArray(c.status, ['active', 'trial']), lt(c.paidUntil, dateKey(addDays(now, -GRACE_DAYS)))) },
      { status: 'active', reason: '已付款', where: and(eq(c.status, 'trial'), gte(c.paidUntil, dateKey(now))) },
    ] as const;
    const suspended: string[] = [];
    for (const change of changes) {
      const affected = await tx.update(c).set({ status: change.status, updatedAt: now }).where(change.where).returning({ id: c.id });
      for (const { id } of affected) {
        await audit({ type: 'system', name: '系統' }, 'community.status', {
          communityId: id, entityType: 'community', entityId: id, data: { status: change.status, reason: change.reason },
        }, tx);
        if (change.status === 'suspended') suspended.push(id);
      }
    }
    return suspended;
  });
}

/** 平台後台的客戶列表 */
export async function listCommunitiesForPlatform() {
  const rows = await db()
    .select({
      community: schema.communities,
      plan: { id: schema.plans.id, name: schema.plans.name, maxUnits: schema.plans.maxUnits },
      org: { id: schema.organizations.id, name: schema.organizations.name },
      unitCount: sql<number>`(select count(*)::int from app.units u where u.community_id = ${schema.communities.id})`,
      residentCount: sql<number>`(select count(*)::int from app.residents r where r.community_id = ${schema.communities.id} and r.status = 'active')`,
      parcels30d: sql<number>`(select count(*)::int from app.parcels p where p.community_id = ${schema.communities.id} and p.received_at > now() - interval '30 days')`,
    })
    .from(schema.communities)
    .innerJoin(schema.plans, eq(schema.communities.planId, schema.plans.id))
    .innerJoin(schema.organizations, eq(schema.communities.orgId, schema.organizations.id))
    .orderBy(desc(schema.communities.createdAt));
  return rows;
}

export async function listOrganizations() {
  return db().select().from(schema.organizations).orderBy(asc(schema.organizations.name));
}

export async function createOrganization(input: { name: string; contactName?: string; contactEmail?: string; contactPhone?: string; note?: string }) {
  const name = input.name.trim();
  if (!name) throw new DomainError('請輸入公司名稱');
  const [org] = await db()
    .insert(schema.organizations)
    .values({
      name,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      note: input.note?.trim() || null,
    })
    .returning();
  return org;
}

export async function updateOrganization(
  orgId: string,
  input: { name: string; contactName?: string; contactEmail?: string; contactPhone?: string; note?: string },
) {
  const name = input.name.trim();
  if (!name) throw new DomainError('請輸入公司名稱');
  await db()
    .update(schema.organizations)
    .set({
      name,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      note: input.note?.trim() || null,
    })
    .where(eq(schema.organizations.id, orgId));
}
