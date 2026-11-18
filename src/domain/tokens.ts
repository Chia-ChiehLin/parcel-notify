import { appUrl } from '@/lib/env';
import { signPayload, verifyPayload } from '@/lib/crypto';

/**
 * 住戶網頁連結：不需要登入，靠簽章保護。
 * 住戶被移除或遷出時 tokenVersion 會加一，舊連結立即失效。
 */
export function residentToken(r: { id: string; tokenVersion: number }) {
  return signPayload(`r|${r.id}|${r.tokenVersion}`);
}

export function parseResidentToken(token: string): { residentId: string; version: number } | null {
  const payload = verifyPayload(token);
  if (!payload) return null;
  const [kind, id, v] = payload.split('|');
  if (kind !== 'r' || !id || !v) return null;
  return { residentId: id, version: Number(v) };
}

export function residentUrl(r: { id: string; tokenVersion: number }, path = '') {
  return `${appUrl()}/r/${residentToken(r)}${path}`;
}

/** 取件 QR code 內容：10 分鐘有效，避免截圖外流後被冒領 */
export const PICKUP_QR_TTL_SEC = 10 * 60;
export const PICKUP_QR_PREFIX = 'PNQR:';

export function pickupQrPayload(residentId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + PICKUP_QR_TTL_SEC;
  return PICKUP_QR_PREFIX + signPayload(`p|${residentId}|${exp}`);
}

export function parsePickupQr(raw: string, now = Date.now()): { residentId: string } | { error: 'expired' | 'invalid' } {
  const text = raw.trim();
  if (!text.startsWith(PICKUP_QR_PREFIX)) return { error: 'invalid' };
  const payload = verifyPayload(text.slice(PICKUP_QR_PREFIX.length));
  if (!payload) return { error: 'invalid' };
  const [kind, id, exp] = payload.split('|');
  if (kind !== 'p' || !id || !exp) return { error: 'invalid' };
  if (Number(exp) * 1000 < now) return { error: 'expired' };
  return { residentId: id };
}
