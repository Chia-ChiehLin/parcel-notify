import { unstable_rethrow } from 'next/navigation';
import { isDomainError } from '@/domain/types';
import type { ActionState } from '@/components/form';

/** 把 server action 的錯誤轉成可以顯示的訊息；非預期錯誤只記 log，不外洩細節 */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** 取得可以顯示的錯誤訊息（redirect / notFound 會繼續往上丟） */
export function errorMessage(e: unknown): string {
  unstable_rethrow(e);
  if (isDomainError(e)) return e.message;
  if (e instanceof Error && /^(只接受|圖片)/.test(e.message)) return e.message;
  console.error('[action] unexpected error', e);
  return '系統發生錯誤，請稍後再試。若持續發生請聯絡客服。';
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export function num(fd: FormData, key: string, fallback = 0): number {
  const v = Number(str(fd, key));
  return Number.isFinite(v) ? v : fallback;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === 'true' || v === '1';
}

export function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split(/[\n,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
