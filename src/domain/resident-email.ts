import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { emailGateway } from '@/channels/gateway';
import { hmac, randomCode, safeEqual, sha256 } from '@/lib/crypto';
import type { Actor } from './audit';
import { audit } from './audit';

export type EmailScope = { communityId: string; residentId: string; tokenVersion?: number; unitId?: string };
export type VerificationState = 'sent' | 'verified' | 'pending' | 'limited' | 'unavailable' | 'invalid';

export function verificationMessage(state: VerificationState, language = 'zh-TW') {
  const messages = {
    sent: ['驗證碼已寄出，15 分鐘內有效。', 'Verification code sent. It expires in 15 minutes.'],
    verified: ['信箱已驗證，可接收已啟用的包裹通知。', 'Address verified. Your email notification preferences are active.'],
    pending: ['信箱尚待驗證，暫停寄送包裹通知。', 'Address not verified. Parcel emails are paused.'],
    limited: ['寄送次數已達上限，每個信箱或帳戶每小時最多三封。', 'Limit reached. Each address or resident can request up to three codes per hour.'],
    unavailable: ['目前無法寄出驗證信，請聯絡管理室，或稍後再試。', 'Verification email is unavailable. Please contact the front desk or retry later.'],
    invalid: ['驗證碼無效或已過期。請使用最新一封信的驗證碼，或重新寄送。', 'Invalid or expired code. Use the most recent email or request a new code.'],
  };
  return messages[state][language === 'en' ? 1 : 0];
}

function residentMatch(scope: EmailScope) {
  return and(eq(schema.residents.communityId, scope.communityId), eq(schema.residents.id, scope.residentId),
    eq(schema.residents.status, 'active'), eq(schema.residents.notifyEmail, true),
    scope.tokenVersion !== undefined ? eq(schema.residents.tokenVersion, scope.tokenVersion) : undefined,
    scope.unitId ? eq(schema.residents.unitId, scope.unitId) : undefined);
}

function digest(id: string, email: string, code: string) {
  return hmac(JSON.stringify(['email-confirm-v1', id, email, code]));
}

export async function requestResidentEmailVerification(scope: EmailScope): Promise<VerificationState> {
  if (!emailGateway().isConfigured()) return 'unavailable';
  const prepared = await db().transaction(async (tx) => {
    const [r] = await tx.select().from(schema.residents).where(residentMatch(scope)).for('update');
    if (!r?.email) return { state: 'unavailable' } as const;
    const [service] = await tx.select({ plan: schema.plans.features, status: schema.communities.status })
      .from(schema.communities).innerJoin(schema.plans, eq(schema.plans.id, schema.communities.planId))
      .where(eq(schema.communities.id, scope.communityId));
    if (!service?.plan.email || ['suspended', 'cancelled'].includes(service.status)) return { state: 'unavailable' } as const;
    const email = r.email;
    if (r.emailVerifiedAt && r.verifiedEmail === email) return { state: 'verified' } as const;
    const since = new Date(Date.now() - 3_600_000);
    const keys = ['resident-email:address:' + sha256(email), 'resident-email:id:' + r.id];
    for (const key of keys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 9))`);
      const [attempts] = await tx.select({ n: count() }).from(schema.loginAttempts)
        .where(and(eq(schema.loginAttempts.key, key), gte(schema.loginAttempts.createdAt, since)));
      if (attempts.n >= 3) return { state: 'limited' } as const;
    }
    await tx.insert(schema.loginAttempts).values(keys.map((key) => ({ key, success: true })));
    const code = randomCode(8);
    const challenge = { email, codeHash: digest(r.id, email, code), expiresAt: new Date(Date.now() + 15 * 60_000), tries: 0 };
    await tx.insert(schema.residentEmailChallenges).values({ residentId: r.id, ...challenge })
      .onConflictDoUpdate({ target: schema.residentEmailChallenges.residentId, set: challenge });
    return { state: 'sent', code, email, language: r.language } as const;
  });
  if (prepared.state !== 'sent') return prepared.state;
  const subject = prepared.language === 'en' ? 'Verify your notification email address' : '確認通知用 Email 地址';
  const text = prepared.language === 'en'
    ? `Code: ${prepared.code}. Valid for 15 minutes. Enter it in your resident settings or show it to the front desk in person to enable email notifications. If you did not request this, ignore this email.`
    : `驗證碼：${prepared.code}。15 分鐘內有效。請在住戶設定輸入，或由本人到管理室出示，以啟用 Email 通知。如果你沒有申請，請忽略此信。`;
  try {
    await emailGateway().send({ to: prepared.email, subject, text, html: `<p>${text}</p>` });
    return 'sent';
  } catch {
    return 'unavailable';
  }
}

export async function confirmResidentEmail(scope: EmailScope, raw: string, actor: Actor): Promise<VerificationState> {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) return 'invalid';
  return db().transaction(async (tx) => {
    const [r] = await tx.select().from(schema.residents).where(residentMatch(scope)).for('update');
    if (!r?.email) return 'invalid';
    const table = schema.residentEmailChallenges;
    const [challenge] = await tx.select().from(table).where(eq(table.residentId, r.id));
    if (!challenge || challenge.email !== r.email || challenge.expiresAt.getTime() <= Date.now() || challenge.tries >= 5) return 'invalid';
    if (!safeEqual(digest(r.id, r.email, code), challenge.codeHash)) {
      await tx.update(table).set({ tries: sql`${table.tries} + 1` }).where(eq(table.residentId, r.id));
      return 'invalid';
    }
    await tx.update(schema.residents).set({ verifiedEmail: r.email, emailVerifiedAt: new Date() }).where(residentMatch(scope));
    await tx.delete(table).where(eq(table.residentId, r.id));
    await audit(actor, 'resident.email_verified', { communityId: scope.communityId, entityType: 'resident', entityId: r.id }, tx);
    return 'verified';
  });
}
