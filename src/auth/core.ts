/**
 * 不依賴 Next.js request 的帳號邏輯（方便單元測試）。
 */
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
import type { AuthTokenPayload } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { DomainError } from '@/domain/types';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password';
import { isLimited } from './rate-limit';

export const SESSION_DAYS = 30;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MIN = 15;

export type SessionUser = typeof schema.users.$inferSelect;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function createSessionRecord(user: Pick<SessionUser, 'id' | 'passwordHash'>, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db().transaction(async (tx) => {
    const [current] = await tx.select({ hash: schema.users.passwordHash, status: schema.users.status }).from(schema.users)
      .where(eq(schema.users.id, user.id)).for('share');
    if (!user.passwordHash || current?.status !== 'active' || current.hash !== user.passwordHash) {
      throw new DomainError('帳號狀態已變更，請重新登入');
    }
    await tx.insert(schema.sessions)
      .values({ id: sha256(token), userId: user.id, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  });
  return { token, expiresAt };
}

/** 驗證 session token；伺服器和瀏覽器使用同一個到期時間 */
export async function validateSessionToken(token: string) {
  const id = sha256(token);
  const rows = await db()
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now() || row.user.status !== 'active') {
    await db().delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }
  return { user: row.user, expiresAt: row.session.expiresAt };
}

export async function deleteSessionToken(token: string) {
  await db().delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}

export async function deleteUserSessions(userId: string) {
  await db().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string };

export async function authenticate(emailRaw: string, password: string, ip: string | null): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  if (email.length > 254 || password.length > 128) return { ok: false, error: 'Email 或密碼不正確' };
  const keys = [`email:${email}`, ...(ip ? [`ip:${ip}`] : [])];
  // 先預留本次嘗試，避免同時送出的請求一起通過上限；密碼驗證不占用交易。
  const reservation = await db().transaction(async (tx) => {
    for (const key of keys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 4))`);
      if (await isLimited(schema.loginAttempts, key, key.startsWith('ip:') ? 20 : LOGIN_MAX_FAILURES, LOGIN_WINDOW_MIN, tx)) return [];
    }
    return tx.insert(schema.loginAttempts).values(keys.map((key) => ({ key, success: false })))
      .returning({ id: schema.loginAttempts.id });
  });
  if (!reservation.length) return { ok: false, error: `登入失敗次數過多，請 ${LOGIN_WINDOW_MIN} 分鐘後再試` };
  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user?.passwordHash || user.status !== 'active' || !(await verifyPassword(user.passwordHash, password))) {
    return { ok: false, error: 'Email 或密碼不正確' };
  }
  await db().update(schema.loginAttempts).set({ success: true }).where(inArray(schema.loginAttempts.id, reservation.map((r) => r.id)));
  await db().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  return { ok: true, user };
}

// ───────────────────────────── 邀請與重設密碼 ─────────────────────────────

export async function createAuthToken(opts: {
  kind: 'invite' | 'reset';
  email: string;
  userId?: string | null;
  payload?: AuthTokenPayload;
  createdBy?: string | null;
  ttlHours: number;
}, database: Pick<DB, 'insert'> = db()) {
  const token = randomToken(32);
  await database
    .insert(schema.authTokens)
    .values({
      kind: opts.kind,
      tokenHash: sha256(token),
      email: normalizeEmail(opts.email),
      userId: opts.userId ?? null,
      payload: opts.payload ?? {},
      createdBy: opts.createdBy ?? null,
      expiresAt: new Date(Date.now() + opts.ttlHours * 3_600_000),
    });
  return token;
}

export async function findValidAuthToken(token: string, kind: 'invite' | 'reset') {
  const [row] = await db()
    .select()
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.tokenHash, sha256(token)),
        eq(schema.authTokens.kind, kind),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 接受邀請：建立或啟用帳號、設定密碼、加入社區或公司 */
export async function acceptInvite(token: string, input: { name: string; password: string }, ip: string | null = null) {
  const invalid = { ok: false as const, error: '邀請連結無效或已過期，請聯絡管理者重新邀請' };
  const invite = await findValidAuthToken(token, 'invite');
  if (!invite) return invalid;
  const { role, communityId, orgId } = invite.payload;
  const orgInvite = role === 'org_admin';
  if (!role || !['staff', 'community_admin', 'org_admin'].includes(role)) return invalid;
  if (orgInvite && (!orgId || communityId)) return invalid;
  if (!orgInvite && (!communityId || orgId)) return invalid;

  const [existing] = await db().select().from(schema.users).where(eq(schema.users.email, invite.email)).limit(1);
  if (existing && existing.status !== 'active') return { ok: false as const, error: '帳號已停用，請聯絡服務商' };
  let newHash: string | null = null;
  if (existing?.passwordHash) {
    const login = await authenticate(invite.email, input.password, ip);
    if (!login.ok) return login;
  } else {
    const passwordError = validatePasswordStrength(input.password);
    if (passwordError) return { ok: false as const, error: passwordError };
    newHash = await hashPassword(input.password);
  }

  return db().transaction(async (tx) => {
    if (communityId) {
      const [community] = await tx.select({ id: schema.communities.id }).from(schema.communities)
        .where(eq(schema.communities.id, communityId)).for('update');
      if (!community) return invalid;
    }
    // 序列化同一 Email 的邀請，即使第一次接受邀請時帳號還不存在。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invite.email}, 1))`);
    const [current] = await tx.select().from(schema.users).where(eq(schema.users.email, invite.email)).for('update');
    if (current?.id !== existing?.id || current?.passwordHash !== existing?.passwordHash || (current && current.status !== 'active')) {
      return { ok: false as const, error: '帳號狀態已變更，請重新整理後再試' };
    }
    const [claimed] = await tx.update(schema.authTokens).set({ usedAt: new Date() })
      .where(and(eq(schema.authTokens.id, invite.id), isNull(schema.authTokens.usedAt), gt(schema.authTokens.expiresAt, new Date())))
      .returning({ id: schema.authTokens.id });
    if (!claimed) return invalid;

    let user = current;
    const name = input.name.trim() || invite.payload.name || invite.email;
    if (!user) {
      [user] = await tx.insert(schema.users).values({ email: invite.email, name, passwordHash: newHash }).returning();
    } else if (!user.passwordHash) {
      [user] = await tx.update(schema.users).set({ name, passwordHash: newHash }).where(eq(schema.users.id, user.id)).returning();
    }

    const scope = orgInvite ? eq(schema.memberships.orgId, orgId!) : eq(schema.memberships.communityId, communityId!);
    const [member] = await tx.select({ id: schema.memberships.id }).from(schema.memberships)
      .where(and(eq(schema.memberships.userId, user.id), scope)).limit(1);
    if (!member) {
      await tx.insert(schema.memberships).values({ userId: user.id, role, orgId: orgId ?? null, communityId: communityId ?? null });
    }
    const scopeKey = orgInvite ? 'orgId' : 'communityId';
    await tx.update(schema.authTokens).set({ usedAt: new Date() }).where(and(
      eq(schema.authTokens.email, invite.email), eq(schema.authTokens.kind, 'invite'), isNull(schema.authTokens.usedAt),
      sql`${schema.authTokens.payload}->>${scopeKey} = ${orgId ?? communityId}`,
    ));
    return { ok: true as const, user };
  });
}

export async function resetPassword(token: string, password: string) {
  const invalid = { ok: false as const, error: '重設連結無效或已過期' };
  const row = await findValidAuthToken(token, 'reset');
  const userId = row?.userId;
  if (!row || !userId) return invalid;
  const pwError = validatePasswordStrength(password);
  if (pwError) return { ok: false as const, error: pwError };
  const passwordHash = await hashPassword(password);
  return db().transaction(async (tx) => {
    const [user] = await tx.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, userId)).for('update');
    if (user?.status !== 'active') return invalid;
    const now = new Date();
    const [claimed] = await tx.update(schema.authTokens).set({ usedAt: now })
      .where(and(eq(schema.authTokens.id, row.id), isNull(schema.authTokens.usedAt), gt(schema.authTokens.expiresAt, now)))
      .returning({ id: schema.authTokens.id });
    if (!claimed) return invalid;
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
    await tx.update(schema.authTokens).set({ usedAt: now }).where(and(
      eq(schema.authTokens.userId, userId), eq(schema.authTokens.kind, 'reset'), isNull(schema.authTokens.usedAt),
    ));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    return { ok: true as const, userId, passwordHash };
  });
}

export async function purgeExpiredAuthData() {
  const now = new Date();
  await db().delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
  await db()
    .delete(schema.authTokens)
    .where(lt(schema.authTokens.expiresAt, new Date(now.getTime() - 7 * 86_400_000)));
}

/** 建立第一個平台管理員（只有在完全沒有平台管理員時可用） */
export async function createFirstPlatformAdmin(input: { email: string; name: string; password: string }) {
  const pwError = validatePasswordStrength(input.password);
  if (pwError) return { ok: false as const, error: pwError };
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, error: 'Email 格式不正確' };
  const passwordHash = await hashPassword(input.password);
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('parcel-notify:bootstrap-admin', 0))`);
    const [admin] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isPlatformAdmin, true)).limit(1);
    if (admin) return { ok: false as const, error: '平台管理員已經建立過了' };
    const [user] = await tx.insert(schema.users)
      .values({ email, name: input.name.trim() || email, passwordHash, isPlatformAdmin: true })
      .onConflictDoNothing({ target: schema.users.email }).returning();
    if (!user) return { ok: false as const, error: '此 Email 已有帳號，請使用專屬的管理員 Email' };
    return { ok: true as const, user };
  });
}
