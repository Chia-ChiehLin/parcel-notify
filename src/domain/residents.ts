import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
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
  return db().transaction(async (tx): Promise<BindResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 3))`);
    if (await isLimited(schema.bindAttempts, key, BIND_MAX_FAILURES, BIND_WINDOW_MIN, tx)) return { status: 'locked' };

    const [unit] = await tx.select().from(schema.units).where(eq(schema.units.bindCode, input.code)).for('update');
    if (!unit) {
      await recordAttempt(schema.bindAttempts, key, false, tx);
      return { status: 'bad_code' };
    }
    const [community] = await tx.select().from(schema.communities).where(eq(schema.communities.id, unit.communityId));
    if (!channelServesCommunity(input.channel, community)) {
      await recordAttempt(schema.bindAttempts, key, false, tx);
      return { status: 'wrong_channel' };
    }
    await recordAttempt(schema.bindAttempts, key, true, tx);

    const [existing] = await tx
      .select()
      .from(schema.residents)
      .where(
        and(
          eq(schema.residents.unitId, unit.id),
          eq(schema.residents.lineChannelId, input.channel.id),
          eq(schema.residents.lineUserId, input.lineUserId),
          eq(schema.residents.status, 'active'),
        ),
      )
      .limit(1);
    if (existing) {
      if (!existing.lineFollowing) {
        await tx.update(schema.residents).set({ lineFollowing: true }).where(eq(schema.residents.id, existing.id));
      }
      return { status: 'already', resident: existing, unitLabel: unit.label, communityName: community.name };
    }

    const [primary] = await tx
      .select({ id: schema.residents.id })
      .from(schema.residents)
      .where(and(eq(schema.residents.unitId, unit.id), eq(schema.residents.status, 'active'), eq(schema.residents.isPrimary, true)))
      .limit(1);
    const [resident] = await tx
      .insert(schema.residents)
      .values({
        communityId: community.id,
        unitId: unit.id,
        displayName: input.displayName?.slice(0, 60) ?? '',
        lineUserId: input.lineUserId,
        lineChannelId: input.channel.id,
        isPrimary: !primary,
        language: input.language === 'en' ? 'en' : 'zh-TW',
      })
      .returning();
    if (unit.status === 'vacant') {
      await tx.update(schema.units).set({ status: 'active' }).where(eq(schema.units.id, unit.id));
    }
    await audit({ type: 'line', id: input.lineUserId, name: resident.displayName || 'LINE 住戶' }, 'resident.bind', {
      communityId: community.id,
      entityType: 'resident',
      entityId: resident.id,
      data: { unit: unit.label, isPrimary: resident.isPrimary },
    }, tx);
    return { status: 'bound', resident, unitLabel: unit.label, communityName: community.name };
  });
}

/** 一個 LINE 帳號在這個官方帳號下綁定的所有戶別（共用帳號可能跨社區） */
export async function listBindingsForLineUser(channelId: string, lineUserId: string) {
  return db()
    .select({ resident: schema.residents, unit: schema.units, community: schema.communities })
    .from(schema.residents)
    .innerJoin(schema.units, and(eq(schema.residents.unitId, schema.units.id), eq(schema.residents.communityId, schema.units.communityId)))
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
    .select({ resident: schema.residents, unit: schema.units, community: schema.communities, features: schema.plans.features })
    .from(schema.residents)
    .innerJoin(schema.units, and(eq(schema.residents.unitId, schema.units.id), eq(schema.residents.communityId, schema.units.communityId)))
    .innerJoin(schema.communities, eq(schema.residents.communityId, schema.communities.id))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.communities.planId))
    .where(eq(schema.residents.id, residentId))
    .limit(1);
  return row ?? null;
}

export async function listUnitMembers(communityId: string, unitId: string) {
  return db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.communityId, communityId), eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
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
    .innerJoin(schema.units, and(eq(schema.residents.unitId, schema.units.id), eq(schema.residents.communityId, schema.units.communityId)))
    .where(and(...conds))
    .orderBy(asc(schema.units.sortKey), desc(schema.residents.isPrimary), asc(schema.residents.boundAt));
}

async function lockResident(database: Pick<DB, 'select'>, communityId: string, residentId: string) {
  const target = database.select({ id: schema.residents.unitId }).from(schema.residents)
    .where(and(eq(schema.residents.id, residentId), eq(schema.residents.communityId, communityId)));
  const [unit] = await database.select({ id: schema.units.id }).from(schema.units)
    .where(and(eq(schema.units.id, target), eq(schema.units.communityId, communityId))).for('update');
  if (!unit) throw new DomainError('找不到這位住戶');
  // 取得戶別鎖後重新讀取，避免等待其他交易期間已遷出或更換主要聯絡人。
  const [fresh] = await database.select().from(schema.residents)
    .where(and(eq(schema.residents.id, residentId), eq(schema.residents.communityId, communityId), eq(schema.residents.status, 'active')));
  if (!fresh) throw new DomainError('找不到這位住戶');
  return fresh;
}

/** 移除住戶並撤銷其連結與代領碼；若為主要聯絡人則指派下一位。 */
export async function removeResident(actor: Actor, communityId: string, residentId: string) {
  await db().transaction(async (tx) => {
    const r = await lockResident(tx, communityId, residentId);
    const now = new Date();
    await tx.update(schema.residents)
      .set({ status: 'removed', removedAt: now, isPrimary: false, tokenVersion: sql`${schema.residents.tokenVersion} + 1` })
      .where(and(eq(schema.residents.id, residentId), eq(schema.residents.communityId, communityId)));
    await tx.delete(schema.residentEmailChallenges).where(eq(schema.residentEmailChallenges.residentId, residentId));
    await tx.update(schema.proxyCodes).set({ expiresAt: now })
      .where(and(eq(schema.proxyCodes.communityId, communityId), eq(schema.proxyCodes.residentId, residentId),
        isNull(schema.proxyCodes.usedAt), gt(schema.proxyCodes.expiresAt, now)));
    if (r.isPrimary) {
      const [next] = await tx.select({ id: schema.residents.id }).from(schema.residents)
        .where(and(eq(schema.residents.communityId, communityId), eq(schema.residents.unitId, r.unitId), eq(schema.residents.status, 'active')))
        .orderBy(asc(schema.residents.boundAt), asc(schema.residents.id)).limit(1);
      if (next) await tx.update(schema.residents).set({ isPrimary: true }).where(eq(schema.residents.id, next.id));
    }
    await audit(actor, 'resident.remove', { communityId, entityType: 'resident', entityId: residentId, data: { name: r.displayName } }, tx);
  });
}

export async function setPrimary(scope: Scope, residentId: string) {
  await db().transaction(async (tx) => {
    const r = await lockResident(tx, scope.communityId, residentId);
    await tx.update(schema.residents).set({ isPrimary: sql`${schema.residents.id} = ${residentId}` })
      .where(and(eq(schema.residents.communityId, scope.communityId), eq(schema.residents.unitId, r.unitId), eq(schema.residents.status, 'active')));
    await audit(scope.actor, 'resident.set_primary', { communityId: scope.communityId, entityType: 'resident', entityId: residentId }, tx);
  });
}

/** 管理者手動新增「只收 Email」的住戶（沒有 LINE 的長輩等） */
export async function addEmailResident(scope: Scope, input: { unitId: string; name: string; email: string }) {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email 格式不正確');
  return db().transaction(async (tx) => {
    const [unit] = await tx
      .select()
      .from(schema.units)
      .where(and(eq(schema.units.id, input.unitId), eq(schema.units.communityId, scope.communityId)))
      .limit(1).for('update');
    if (!unit) throw new DomainError('找不到這個戶別');
    const [duplicate] = await tx.select({ id: schema.residents.id }).from(schema.residents)
      .where(and(eq(schema.residents.unitId, unit.id), eq(schema.residents.status, 'active'), eq(schema.residents.email, email))).limit(1);
    if (duplicate) throw new DomainError('這個戶別已有此信箱，請在住戶名單確認或重送驗證碼');
    const [primary] = await tx
      .select({ id: schema.residents.id })
      .from(schema.residents)
      .where(and(eq(schema.residents.unitId, unit.id), eq(schema.residents.status, 'active'), eq(schema.residents.isPrimary, true)))
      .limit(1);
    const [resident] = await tx
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
    if (unit.status === 'vacant') await tx.update(schema.units).set({ status: 'active' }).where(eq(schema.units.id, unit.id));
    await audit(scope.actor, 'resident.bind', {
      communityId: scope.communityId,
      entityType: 'resident',
      entityId: resident.id,
      data: { unit: unit.label, email: true },
    }, tx);
    return resident;
  });
}

export async function updateResidentPrefs(
  communityId: string,
  residentId: string,
  input: { notifyLine?: boolean; notifyEmail?: boolean; emailFallbackOnly?: boolean; email?: string | null; language?: string; tokenVersion?: number; emailOnlyUnitId?: string; actor?: Actor },
) {
  return db().transaction(async (tx) => {
    const [current] = await tx.select().from(schema.residents)
      .where(and(eq(schema.residents.communityId, communityId), eq(schema.residents.id, residentId), eq(schema.residents.status, 'active'),
        input.emailOnlyUnitId ? and(eq(schema.residents.unitId, input.emailOnlyUnitId), isNull(schema.residents.lineUserId)) : undefined,
        input.tokenVersion === undefined ? undefined : eq(schema.residents.tokenVersion, input.tokenVersion))).for('update');
    if (!current) throw new DomainError('住戶連結已失效 / This resident link has expired');
    const email = input.email === undefined ? current.email : input.email?.trim().toLowerCase() || null;
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw new DomainError('Email 格式不正確 / Invalid email address');
    if (input.notifyEmail && !email) throw new DomainError('請填寫 Email / Enter an email address');
    const notifyEmail = !!email && (input.notifyEmail ?? current.notifyEmail);
    const changed = email !== current.email;
    const withdrawn = !notifyEmail && current.notifyEmail;
    const reset = changed || withdrawn;
    const revokeLinks = !!current.email && reset;
    const [resident] = await tx.update(schema.residents).set({
      email, notifyEmail,
      notifyLine: input.notifyLine ?? current.notifyLine,
      emailFallbackOnly: !!current.lineUserId && notifyEmail && (input.emailFallbackOnly ?? current.emailFallbackOnly),
      language: input.language === undefined ? current.language : input.language === 'en' ? 'en' : 'zh-TW',
      ...(reset ? { verifiedEmail: null, emailVerifiedAt: null } : {}),
      ...(revokeLinks ? { tokenVersion: sql`${schema.residents.tokenVersion} + 1` } : {}),
    }).where(eq(schema.residents.id, current.id)).returning();
    if (reset) await tx.delete(schema.residentEmailChallenges).where(eq(schema.residentEmailChallenges.residentId, current.id));
    if (input.actor && (reset || notifyEmail !== current.notifyEmail)) {
      await audit(input.actor, 'resident.update_email', { communityId, entityType: 'resident', entityId: residentId, data: { enabled: notifyEmail } }, tx);
    }
    return { resident, requestCode: notifyEmail && (changed || !current.notifyEmail), revokeLinks };
  });
}

/** 住戶自己在網頁解除綁定 */
export async function selfUnbind(residentId: string) {
  const r = await getResident(residentId);
  if (!r) return;
  await removeResident({ type: 'resident', id: residentId, name: r.resident.displayName || '住戶' }, r.community.id, residentId);
}
