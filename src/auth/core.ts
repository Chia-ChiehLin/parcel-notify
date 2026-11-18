/**
 * 不依賴 Next.js request 的帳號邏輯（方便單元測試）。
 */
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { AuthTokenPayload, MembershipRole } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password';
import { isLimited, recordAttempt } from './rate-limit';

export const SESSION_DAYS = 30;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MIN = 15;

export type SessionUser = typeof schema.users.$inferSelect;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function createSessionRecord(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db()
    .insert(schema.sessions)
    .values({ id: sha256(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

/** 驗證 session token；剩不到一半效期時自動延長 */
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
  let expiresAt = row.session.expiresAt;
  if (expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
    expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await db().update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, id));
  }
  return { user: row.user, expiresAt, renewed: expiresAt !== row.session.expiresAt };
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
  const keys = [`email:${email}`, ...(ip ? [`ip:${ip}`] : [])];
  for (const key of keys) {
    if (await isLimited(schema.loginAttempts, key, key.startsWith('ip:') ? 20 : LOGIN_MAX_FAILURES, LOGIN_WINDOW_MIN)) {
      return { ok: false, error: `登入失敗次數過多，請 ${LOGIN_WINDOW_MIN} 分鐘後再試` };
    }
  }
  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const valid = !!user?.passwordHash && user.status === 'active' && (await verifyPassword(user.passwordHash, password));
  for (const key of keys) await recordAttempt(schema.loginAttempts, key, valid);
  if (!valid || !user) return { ok: false, error: 'Email 或密碼不正確' };
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
}) {
  const token = randomToken(32);
  await db()
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
export async function acceptInvite(token: string, input: { name: string; password: string }) {
  const invite = await findValidAuthToken(token, 'invite');
  if (!invite) return { ok: false as const, error: '邀請連結無效或已過期，請聯絡管理者重新邀請' };
  const [existingUser] = await db().select().from(schema.users).where(eq(schema.users.email, invite.email)).limit(1);
  if (existingUser?.passwordHash) {
    // 已經有帳號的人：輸入原本的密碼確認身分即可加入
    if (!(await verifyPassword(existingUser.passwordHash, input.password))) {
      return { ok: false as const, error: '這個 Email 已經有帳號，請輸入原本的密碼' };
    }
  } else {
    const pwError = validatePasswordStrength(input.password);
    if (pwError) return { ok: false as const, error: pwError };
  }
  const name = input.name.trim() || invite.payload.name || invite.email;
  const passwordHash = existingUser?.passwordHash ?? (await hashPassword(input.password));

  const user = await db().transaction(async (tx) => {
    let u = existingUser;
    if (u) {
      [u] = await tx
        .update(schema.users)
        .set({ name: u.passwordHash ? u.name : name, passwordHash, status: 'active' })
        .where(eq(schema.users.id, u.id))
        .returning();
    } else {
      [u] = await tx.insert(schema.users).values({ email: invite.email, name, passwordHash }).returning();
    }
    const role = invite.payload.role as MembershipRole | undefined;
    if (role) {
      await tx
        .insert(schema.memberships)
        .values({
          userId: u.id,
          role,
          orgId: role === 'org_admin' ? invite.payload.orgId ?? null : null,
          communityId: role === 'org_admin' ? null : invite.payload.communityId ?? null,
        })
        .onConflictDoNothing();
    }
    await tx.update(schema.authTokens).set({ usedAt: new Date() }).where(eq(schema.authTokens.id, invite.id));
    return u;
  });
  return { ok: true as const, user };
}

export async function resetPassword(token: string, password: string) {
  const row = await findValidAuthToken(token, 'reset');
  if (!row || !row.userId) return { ok: false as const, error: '重設連結無效或已過期' };
  const pwError = validatePasswordStrength(password);
  if (pwError) return { ok: false as const, error: pwError };
  await db()
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.users.id, row.userId));
  await db().update(schema.authTokens).set({ usedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
  await deleteUserSessions(row.userId);
  return { ok: true as const, userId: row.userId };
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
  const [anyAdmin] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.isPlatformAdmin, true))
    .limit(1);
  if (anyAdmin) return { ok: false as const, error: '平台管理員已經建立過了' };
  const pwError = validatePasswordStrength(input.password);
  if (pwError) return { ok: false as const, error: pwError };
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, error: 'Email 格式不正確' };
  const [user] = await db()
    .insert(schema.users)
    .values({ email, name: input.name.trim() || email, passwordHash: await hashPassword(input.password), isPlatformAdmin: true })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { isPlatformAdmin: true, passwordHash: await hashPassword(input.password) },
    })
    .returning();
  return { ok: true as const, user };
}
