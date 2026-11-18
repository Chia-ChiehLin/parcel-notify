'use server';

import { redirect } from 'next/navigation';
import { acceptInvite, authenticate, createFirstPlatformAdmin, resetPassword } from '@/auth/core';
import { endSession, requestMeta, startSession } from '@/auth/session';
import { audit } from '@/domain/audit';
import { requestPasswordReset } from '@/domain/staff';
import { safeEqual } from '@/lib/crypto';
import type { ActionState } from '@/components/form';
import { run, str } from './util';

function safeNext(next: string) {
  if (!next.startsWith('/')) return '/';
  try {
    const origin = 'https://parcel.invalid';
    const url = new URL(next, origin);
    if (url.origin === origin && !url.pathname.startsWith('//')) return url.pathname + url.search + url.hash;
  } catch {
    // 無效網址回到首頁
  }
  return '/';
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let next = '/';
  const result = await run(async () => {
    const { ip } = await requestMeta();
    const res = await authenticate(str(fd, 'email'), str(fd, 'password'), ip);
    if (!res.ok) return { error: res.error };
    await startSession(res.user);
    await audit({ type: 'user', id: res.user.id, name: res.user.name, ip }, 'user.login', { entityType: 'user', entityId: res.user.id });
    next = safeNext(str(fd, 'next') || '/');
    return { ok: true };
  });
  if (result?.ok) redirect(next);
  return result;
}

export async function logoutAction() {
  await endSession();
  redirect('/login');
}

export async function forgotAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const email = str(fd, 'email');
    if (!email) return { error: '請輸入 Email' };
    const { ip } = await requestMeta();
    await requestPasswordReset(email, ip);
    return { ok: true, message: '請查看此 Email 的收件匣與垃圾信件匣，重設連結有效 2 小時。若未收到，請聯絡服務商。' };
  });
}

export async function resetAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    if (str(fd, 'password') !== str(fd, 'confirm')) return { error: '兩次輸入的密碼不一樣' };
    const res = await resetPassword(token, str(fd, 'password'));
    if (!res.ok) return { error: res.error };
    await startSession({ id: res.userId, passwordHash: res.passwordHash });
    return { ok: true };
  });
  if (result?.ok) redirect('/');
  return result;
}

export async function acceptInviteAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const { ip } = await requestMeta();
    const res = await acceptInvite(token, { name: str(fd, 'name'), password: str(fd, 'password') }, ip);
    if (!res.ok) return { error: res.error };
    await startSession(res.user);
    return { ok: true };
  });
  if (result?.ok) redirect('/');
  return result;
}

export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected || expected.length < 16) return { error: '尚未設定 SETUP_TOKEN 環境變數（至少 16 字元），無法建立平台管理員' };
    if (!safeEqual(str(fd, 'token'), expected)) return { error: '設定碼不正確' };
    if (str(fd, 'password') !== str(fd, 'confirm')) return { error: '兩次輸入的密碼不一樣' };
    const res = await createFirstPlatformAdmin({ email: str(fd, 'email'), name: str(fd, 'name'), password: str(fd, 'password') });
    if (!res.ok) return { error: res.error };
    await startSession(res.user);
    return { ok: true };
  });
  if (result?.ok) redirect('/admin');
  return result;
}
