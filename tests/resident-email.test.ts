import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registerParcels } from '@/domain/parcels';
import { sendReminders } from '@/domain/maintenance';
import { updateCommunitySettings } from '@/domain/communities';
import { confirmResidentEmail, requestResidentEmailVerification } from '@/domain/resident-email';
import { addEmailResident, bindByCode, removeResident, updateResidentPrefs } from '@/domain/residents';
import { residentFromToken } from '@/domain/resident-session';
import { residentToken } from '@/domain/tokens';
import { ADMIN, fakes, makeCommunity } from './helpers';

function latestCode() {
  const code = fakes.email.at(-1)?.text.match(/(?:驗證碼：|Code: )([A-Z2-9]{8})/)?.[1];
  if (!code) throw new Error('Missing verification code in fake mailbox');
  return code;
}

describe('住戶 Email 同意與驗證', () => {
  it('新、舊未驗證信箱只收到中性驗證信，確認後才收到到件及每日逾期提醒', async () => {
    const { scope, community, unit } = await makeCommunity();
    const u = unit('A-1-1');
    const r = await addEmailResident(scope, { unitId: u.id, name: 'Mock resident', email: 'TEST@example.test' });
    const target = { communityId: community.id, residentId: r.id, unitId: u.id };
    const first = await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(first.notifications[0].status).toBe('no_recipient');
    await db().update(schema.parcels).set({ receivedAt: new Date(Date.now() - 10 * 86400000) }).where(eq(schema.parcels.id, first.parcels[0].id));
    await sendReminders();
    expect(fakes.email).toHaveLength(0);
    expect(await requestResidentEmailVerification(target)).toBe('sent');
    const code = latestCode();
    const message = fakes.email[0];
    expect(message.to).toBe('test@example.test');
    for (const sensitive of [r.displayName!, u.label, community.name, first.parcels[0].pickupCode, '/r/', 'https://']) {
      expect(message.subject + message.text + message.html).not.toContain(sensitive);
    }
    expect(await confirmResidentEmail({ ...target, unitId: unit('B-1-1').id }, code, ADMIN)).toBe('invalid');
    expect(await confirmResidentEmail(target, code, ADMIN)).toBe('verified');
    expect(await confirmResidentEmail(target, code, ADMIN)).toBe('invalid');
    expect(await requestResidentEmailVerification(target)).toBe('verified');
    expect(fakes.email).toHaveLength(1);
    const result = await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(result.notifications[0]).toMatchObject({ status: 'sent', email: 1 });
    expect(fakes.email[1].text).toContain('/r/');
    await sendReminders(new Date(Date.now() + 8 * 86400000));
    expect(fakes.email).toHaveLength(3);
  });

  it('住戶更換、停用及刪除地址時撤銷舊連結及驗證碼，收件資格跟隨當前地址', async () => {
    const { scope, unit, channel } = await makeCommunity();
    const u = unit('A-1-1');
    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-change', code: u.bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    const r = bind.resident;
    const base = { communityId: scope.communityId, residentId: r.id };
    const update = (email: string | null, consent: boolean, version: number) => updateResidentPrefs(scope.communityId, r.id, {
      email, notifyEmail: consent, tokenVersion: version, language: 'en', emailFallbackOnly: true,
    });
    const initial = await update('old@example.test', true, r.tokenVersion);
    expect(initial.requestCode).toBe(true);
    const oldLink = residentToken(initial.resident);
    await requestResidentEmailVerification({ ...base, tokenVersion: initial.resident.tokenVersion });
    expect(fakes.email[0].subject).toBe('Verify your notification email address');
    const oldCode = latestCode();
    const changed = await update('new@example.test', true, initial.resident.tokenVersion);
    expect(changed).toMatchObject({ revokeLinks: true, requestCode: true, resident: { verifiedEmail: null, emailVerifiedAt: null } });
    expect(await residentFromToken(oldLink)).toBeNull();
    expect(await confirmResidentEmail(base, oldCode, ADMIN)).toBe('invalid');
    await requestResidentEmailVerification({ ...base, tokenVersion: changed.resident.tokenVersion });
    const code = latestCode();
    expect(fakes.email.at(-1)?.to).toBe('new@example.test');
    expect(await confirmResidentEmail({ ...base, tokenVersion: initial.resident.tokenVersion }, code, ADMIN)).toBe('invalid');
    expect(await confirmResidentEmail({ ...base, tokenVersion: changed.resident.tokenVersion }, code, ADMIN)).toBe('verified');
    fakes.reset();
    fakes.failLineFor.add('U-change');
    const send = () => registerParcels(scope, [{ unitId: u.id }], { notify: true });
    await send();
    expect(fakes.email.map((m) => m.to)).toEqual(['new@example.test']);
    const off = await update('new@example.test', false, changed.resident.tokenVersion);
    expect(off.resident).toMatchObject({ emailVerifiedAt: null, verifiedEmail: null, notifyEmail: false });
    expect(await requestResidentEmailVerification(base)).toBe('unavailable');
    await send();
    expect(fakes.email).toHaveLength(1);
    const empty = await update(null, false, off.resident.tokenVersion);
    expect(empty.resident.email).toBeNull();
  });

  it('只在 LINE 無法送達時寄信的偏好也遵守社區備援開關', async () => {
    const { scope, unit, channel } = await makeCommunity();
    const u = unit('A-1-1');
    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-fallback', code: u.bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    const target = { communityId: scope.communityId, residentId: bind.resident.id };
    await updateResidentPrefs(scope.communityId, bind.resident.id, { email: 'fallback@example.test', notifyEmail: true, emailFallbackOnly: true });
    await requestResidentEmailVerification(target);
    await confirmResidentEmail(target, latestCode(), ADMIN);
    fakes.reset();
    const send = () => registerParcels(scope, [{ unitId: u.id }], { notify: true });
    await send();
    expect(fakes.email).toHaveLength(0);
    fakes.failLineFor.add('U-fallback');
    await updateCommunitySettings(ADMIN, scope.communityId, { emailFallback: false });
    await send();
    expect(fakes.email).toHaveLength(0);
    await updateCommunitySettings(ADMIN, scope.communityId, { emailFallback: true });
    await send();
    expect(fakes.email).toHaveLength(1);
  });

  it('驗證碼到期、五次錯誤或移除住戶即失效', async () => {
    const { scope, unit } = await makeCommunity();
    const r = await addEmailResident(scope, { unitId: unit('A-1-1').id, name: 'Fixture', email: 'code@example.test' });
    const target = { communityId: scope.communityId, residentId: r.id };
    await requestResidentEmailVerification(target);
    const expired = latestCode();
    await db().update(schema.residentEmailChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.residentEmailChallenges.residentId, r.id));
    expect(await confirmResidentEmail(target, expired, ADMIN)).toBe('invalid');
    await requestResidentEmailVerification(target);
    const code = latestCode();
    const wrong = code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA';
    for (let i = 0; i < 5; i++) expect(await confirmResidentEmail(target, wrong, ADMIN)).toBe('invalid');
    expect(await confirmResidentEmail(target, code, ADMIN)).toBe('invalid');
    await requestResidentEmailVerification(target);
    const last = latestCode();
    await removeResident(ADMIN, scope.communityId, r.id);
    expect(await confirmResidentEmail(target, last, ADMIN)).toBe('invalid');
    expect(await requestResidentEmailVerification(target)).toBe('unavailable');
  });

  it('三封每小時配額在多戶同時重送時仍然生效，超限不會使可用的驗證碼過期', async () => {
    const { scope, unit } = await makeCommunity();
    const address = 'shared@example.test';
    const a = await addEmailResident(scope, { unitId: unit('A-1-1').id, name: 'First', email: address });
    const b = await addEmailResident(scope, { unitId: unit('B-1-1').id, name: 'Second', email: address });
    const target = (residentId: string) => ({ communityId: scope.communityId, residentId });
    await requestResidentEmailVerification(target(a.id));
    const first = latestCode();
    const sends = await Promise.all(Array.from({ length: 4 }, () => requestResidentEmailVerification(target(b.id))));
    expect(sends.filter((s) => s === 'sent')).toHaveLength(2);
    expect(sends.filter((s) => s === 'limited')).toHaveLength(2);
    expect(fakes.email).toHaveLength(3);
    expect(await confirmResidentEmail(target(a.id), first, ADMIN)).toBe('verified');
    expect(await confirmResidentEmail(target(b.id), latestCode(), ADMIN)).toBe('verified');
  });
  it('櫃台只能更正同一社區戶別的 Email 住戶，停用方案與寄件服務會停止驗證或通知', async () => {
    const { scope, community, unit, channel } = await makeCommunity();
    const u = unit('A-1-1');
    const address = 'desk@example.test';
    const r = await addEmailResident(scope, { unitId: u.id, name: 'Desk fixture', email: address });
    await expect(addEmailResident(scope, { unitId: u.id, name: 'Duplicate', email: address })).rejects.toThrow('已有此信箱');
    const prefs = { email: 'corrected@example.test', notifyEmail: true, emailOnlyUnitId: u.id, tokenVersion: r.tokenVersion, actor: ADMIN };
    await expect(updateResidentPrefs(scope.communityId, r.id, { ...prefs, emailOnlyUnitId: unit('B-2-1').id })).rejects.toThrow();
    const bind = await bindByCode({ channel: channel!, lineUserId: 'U-line', code: u.bindCode });
    if (bind.status !== 'bound') throw new Error('bind failed');
    await expect(updateResidentPrefs(scope.communityId, bind.resident.id, prefs)).rejects.toThrow();
    const changed = await updateResidentPrefs(scope.communityId, r.id, prefs);
    expect(changed).toMatchObject({ requestCode: true, revokeLinks: true });
    const target = { communityId: scope.communityId, unitId: u.id, residentId: r.id };
    fakes.emailConfigured = false;
    expect(await requestResidentEmailVerification(target)).toBe('unavailable');
    fakes.emailConfigured = true;
    expect(await requestResidentEmailVerification(target)).toBe('sent');
    expect(await confirmResidentEmail(target, latestCode(), ADMIN)).toBe('verified');
    fakes.reset();
    const [plan] = await db().select().from(schema.plans).where(eq(schema.plans.id, community.planId));
    await db().update(schema.plans).set({ features: { ...plan.features, email: false } }).where(eq(schema.plans.id, plan.id));
    const registered = await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(registered.notifications[0].email).toBe(0);
    expect(await requestResidentEmailVerification(target)).toBe('unavailable');
    expect(fakes.email).toHaveLength(0);
  });

});
