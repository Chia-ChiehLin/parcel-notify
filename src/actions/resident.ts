'use server';

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
    await updateResidentPrefs(r.resident.id, {
      notifyLine: r.resident.lineUserId ? bool(fd, 'notifyLine') : undefined,
      notifyEmail: bool(fd, 'notifyEmail'),
      email: str(fd, 'email'),
      language,
    });
    revalidatePath(`/r/${token}`, 'layout');
    return { ok: true, message: dict(language).saved };
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
