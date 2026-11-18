'use server';

import { redirect } from 'next/navigation';
import { residentToken } from '@/domain/tokens';
import { confirmResidentEmail, requestResidentEmailVerification, verificationMessage } from '@/domain/resident-email';
import { revalidatePath } from 'next/cache';
import { createProxyCode } from '@/domain/pickup';
import { residentFromToken } from '@/domain/resident-session';
import { selfUnbind, updateResidentPrefs } from '@/domain/residents';
import { DomainError } from '@/domain/types';
import { dict } from '@/i18n/resident';
import type { ActionState } from '@/components/form';
import { bool, run, str } from './util';

async function resident(token: string) {
  const r = await residentFromToken(token);
  if (!r) throw new DomainError('連結已失效');
  return r;
}

export async function updatePrefsAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await resident(token);
    const language = str(fd, 'language') || r.resident.language;
    const result = await updateResidentPrefs(r.community.id, r.resident.id, {
      actor: { type: 'resident', id: r.resident.id }, tokenVersion: r.resident.tokenVersion, emailFallbackOnly: bool(fd, 'emailFallbackOnly'),
      notifyLine: r.resident.lineUserId ? bool(fd, 'notifyLine') : undefined,
      notifyEmail: bool(fd, 'notifyEmail'),
      email: str(fd, 'email'),
      language,
    });
    const state = result.requestCode ? await requestResidentEmailVerification({
      communityId: r.community.id, residentId: r.resident.id, tokenVersion: result.resident.tokenVersion,
    }) : null;
    revalidatePath(`/r/${token}`, 'layout');
    if (result.revokeLinks) redirect(`/r/${residentToken(result.resident)}/settings${state ? '?email=' + state : ''}`);
    return { ok: true, message: state ? verificationMessage(state, language) : dict(language).saved };
  });
}

export async function createProxyAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await resident(token);
    const row = await createProxyCode(r.resident.id, { proxyName: str(fd, 'proxyName'), hours: 24 });
    revalidatePath(`/r/${token}`);
    return { ok: true, data: { code: row.code, expiresAt: row.expiresAt.toISOString() } };
  });
}

export async function unbindAction(token: string): Promise<ActionState> {
  return run(async () => {
    const r = await resident(token);
    await selfUnbind(r.resident.id);
    return { ok: true, message: dict(r.resident.language).unbound };
  });
}

export async function verifyOwnEmailAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { resident: r } = await resident(token);
    const scope = { residentId: r.id, communityId: r.communityId, tokenVersion: r.tokenVersion };
    const state = str(fd, 'operation') === 'resend'
      ? await requestResidentEmailVerification(scope)
      : await confirmResidentEmail(scope, str(fd, 'code'), { type: 'resident', id: r.id });
    revalidatePath(`/r/${token}/settings`);
    const message = verificationMessage(state, r.language);
    return state === 'sent' || state === 'verified' ? { ok: true, message } : { error: message };
  });
}
