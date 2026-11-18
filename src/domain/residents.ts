import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { isLimited, recordAttempt } from '@/auth/rate-limit';
import { audit, type Actor } from './audit';
import { channelServesCommunity, type ChannelRow } from './line-channels';
import { DomainError, type Scope } from './types';

export type ResidentRow = typeof schema.residents.$inferSelect;

/** 綁定碼正規化：去掉空白、連字號，轉大寫 */
export function normalizeBindCode(input: string): string | null {
  const s = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/^(綁定|BIND)\s*/, '')
    .replace(/[\s\-_]/g, '');
  return /^[A-Z2-9]{8}$/.test(s) ? s : null;
}

const BIND_MAX_FAILURES = 5;
const BIND_WINDOW_MIN = 60;

export type BindResult =
  | { status: 'bound' | 'already'; resident: ResidentRow; unitLabel: string; communityName: string }
  | { status: 'bad_code' | 'wrong_channel' | 'locked' };

/** 住戶在 LINE 輸入綁定碼 */
export async function bindByCode(input: {
  channel: ChannelRow;
  lineUserId: string;
  code: string;
  displayName?: string | null;
  language?: string;
}): Promise<BindResult> {
  const key = `line:${input.channel.id}:${input.lineUserId}`;
  if (await isLimited(schema.bindAttempts, key, BIND_MAX_FAILURES, BIND_WINDOW_MIN)) return { status: 'locked' };

  const [row] = await db()
    .select({ unit: schema.units, community: schema.communities })
    .from(schema.units)
    .innerJoin(schema.communities, eq(schema.units.communityId, schema.communities.id))
    .where(eq(schema.units.bindCode, input.code))
    .limit(1);
  if (!row) {
    await recordAttempt(schema.bindAttempts, key, false);
    return { status: 'bad_code' };
  }
  if (!channelServesCommunity(input.channel, row.community)) {
    await recordAttempt(schema.bindAttempts, key, false);
    return { status: 'wrong_channel' };
  }
  await recordAttempt(schema.bindAttempts, key, true);

  const [existing] = await db()
    .select()
    .from(schema.residents)
    .where(
      and(
        eq(schema.residents.unitId, row.unit.id),
        eq(schema.residents.lineChannelId, input.channel.id),
        eq(schema.residents.lineUserId, input.lineUserId),
        eq(schema.residents.status, 'active'),
      ),
    )
    .limit(1);
  if (existing) {
    if (!existing.lineFollowing) {
      await db().update(schema.residents).set({ lineFollowing: true }).where(eq(schema.residents.id, existing.id));
    }
    return { status: 'already', resident: existing, unitLabel: row.unit.label, communityName: row.community.name };
  }

  const [primary] = await db()
    .select({ id: schema.residents.id })
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, row.unit.id), eq(schema.residents.status, 'active'), eq(schema.residents.isPrimary, true)))
    .limit(1);
  const [resident] = await db()
    .insert(schema.residents)
    .values({
      communityId: row.community.id,
      unitId: row.unit.id,
      displayName: input.displayName?.slice(0, 60) ?? '',
      lineUserId: input.lineUserId,
      lineChannelId: input.channel.id,
      isPrimary: !primary,
      language: input.language === 'en' ? 'en' : 'zh-TW',
    })
    .returning();
  if (row.unit.status === 'vacant') {
    await db().update(schema.units).set({ status: 'active' }).where(eq(schema.units.id, row.unit.id));
  }
  await audit({ type: 'line', id: input.lineUserId, name: resident.displayName || 'LINE 住戶' }, 'resident.bind', {
    communityId: row.community.id,
    entityType: 'resident',
    entityId: resident.id,
    data: { unit: row.unit.label, isPrimary: resident.isPrimary },
  });
  return { status: 'bound', resident, unitLabel: row.unit.label, communityName: row.community.name };
}

/** 一個 LINE 帳號在這個官方帳號下綁定的所有戶別（共用帳號可能跨社區） */
export async function listBindingsForLineUser(channelId: string, lineUserId: string) {
  return db()
    .select({ resident: schema.residents, unit: schema.units, community: schema.communities })
    .from(schema.residents)
    .innerJoin(schema.units, eq(schema.residents.unitId, schema.units.id))
    .innerJoin(schema.communities, eq(schema.residents.communityId, schema.communities.id))
    .where(
      and(
        eq(schema.residents.lineChannelId, channelId),
        eq(schema.residents.lineUserId, lineUserId),
        eq(schema.residents.status, 'active'),
      ),
    )
    .orderBy(asc(schema.communities.name), asc(schema.units.sortKey));
}

export async function setLineFollowing(channelId: string, lineUserId: string, following: boolean) {
  await db()
    .update(schema.residents)
    .set({ lineFollowing: following })
    .where(and(eq(schema.residents.lineChannelId, channelId), eq(schema.residents.lineUserId, lineUserId)));
}

export async function getResident(residentId: string) {
  const [row] = await db()
    .select({ resident: schema.residents, unit: schema.units, community: schema.communities })
    .from(schema.residents)
    .innerJoin(schema.units, eq(schema.residents.unitId, schema.units.id))
    .innerJoin(schema.communities, eq(schema.residents.communityId, schema.communities.id))
    .where(eq(schema.residents.id, residentId))
    .limit(1);
  return row ?? null;
}

export async function listUnitMembers(unitId: string) {
  return db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(desc(schema.residents.isPrimary), asc(schema.residents.boundAt));
}

export async function listResidents(communityId: string, opts: { unitId?: string; q?: string } = {}) {
  const conds = [eq(schema.residents.communityId, communityId), eq(schema.residents.status, 'active')];
  if (opts.unitId) conds.push(eq(schema.residents.unitId, opts.unitId));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    conds.push(sql`(${schema.residents.displayName} ilike ${q} or ${schema.units.label} ilike ${q} or ${schema.residents.email} ilike ${q})`);
  }
  return db()
    .select({ resident: schema.residents, unitLabel: schema.units.label, unitSort: schema.units.sortKey })
    .from(schema.residents)
    .innerJoin(schema.units, eq(schema.residents.unitId, schema.units.id))
    .where(and(...conds))
    .orderBy(asc(schema.units.sortKey), desc(schema.residents.isPrimary), asc(schema.residents.boundAt));
}

async function getResidentInCommunity(communityId: string, residentId: string) {
  const [r] = await db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.id, residentId), eq(schema.residents.communityId, communityId)))
    .limit(1);
  if (!r) throw new DomainError('找不到這位住戶');
  return r;
}

/** 移除住戶：連結立即失效，不再收到通知；如果是主要聯絡人，自動指定下一位 */
export async function removeResident(actor: Actor, communityId: string, residentId: string) {
  const r = await getResidentInCommunity(communityId, residentId);
  await db()
    .update(schema.residents)
    .set({ status: 'removed', removedAt: new Date(), isPrimary: false, tokenVersion: sql`${schema.residents.tokenVersion} + 1` })
    .where(eq(schema.residents.id, residentId));
  if (r.isPrimary) await promoteNextPrimary(r.unitId);
  await audit(actor, 'resident.remove', { communityId, entityType: 'resident', entityId: residentId, data: { name: r.displayName } });
}

async function promoteNextPrimary(unitId: string) {
  const [next] = await db()
    .select({ id: schema.residents.id })
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(asc(schema.residents.boundAt))
    .limit(1);
  if (next) await db().update(schema.residents).set({ isPrimary: true }).where(eq(schema.residents.id, next.id));
}

export async function setPrimary(scope: Scope, residentId: string) {
  const r = await getResidentInCommunity(scope.communityId, residentId);
  await db().update(schema.residents).set({ isPrimary: false }).where(eq(schema.residents.unitId, r.unitId));
  await db().update(schema.residents).set({ isPrimary: true }).where(eq(schema.residents.id, residentId));
  await audit(scope.actor, 'resident.set_primary', { communityId: scope.communityId, entityType: 'resident', entityId: residentId });
}

/** 管理者手動新增「只收 Email」的住戶（沒有 LINE 的長輩等） */
export async function addEmailResident(scope: Scope, input: { unitId: string; name: string; email: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
  const [unit] = await db()
    .select()
    .from(schema.units)
    .where(and(eq(schema.units.id, input.unitId), eq(schema.units.communityId, scope.communityId)))
    .limit(1);
  if (!unit) throw new DomainError('找不到這個戶別');
  const [primary] = await db()
    .select({ id: schema.residents.id })
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, unit.id), eq(schema.residents.status, 'active'), eq(schema.residents.isPrimary, true)))
    .limit(1);
  const [resident] = await db()
    .insert(schema.residents)
    .values({
      communityId: scope.communityId,
      unitId: unit.id,
      displayName: input.name.trim().slice(0, 60),
      email,
      notifyLine: false,
      notifyEmail: true,
      isPrimary: !primary,
    })
    .returning();
  await audit(scope.actor, 'resident.bind', {
    communityId: scope.communityId,
    entityType: 'resident',
    entityId: resident.id,
    data: { unit: unit.label, email: true },
  });
  return resident;
}

export async function updateResidentPrefs(
  residentId: string,
  input: { notifyLine?: boolean; notifyEmail?: boolean; email?: string | null; language?: string },
) {
  const patch: Partial<ResidentRow> = {};
  if (input.notifyLine !== undefined) patch.notifyLine = input.notifyLine;
  if (input.notifyEmail !== undefined) patch.notifyEmail = input.notifyEmail;
  if (input.language) patch.language = input.language === 'en' ? 'en' : 'zh-TW';
  if (input.email !== undefined) {
    const email = input.email?.trim().toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
    patch.email = email;
    if (!email) patch.notifyEmail = false;
  }
  await db().update(schema.residents).set(patch).where(eq(schema.residents.id, residentId));
}

/** 住戶自己在網頁解除綁定 */
export async function selfUnbind(residentId: string) {
  const r = await getResident(residentId);
  if (!r) return;
  await removeResident({ type: 'resident', id: residentId, name: r.resident.displayName || '住戶' }, r.community.id, residentId);
}
