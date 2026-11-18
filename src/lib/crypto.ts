import crypto from 'node:crypto';
import { env } from './env';

/** 由 APP_SECRET 衍生出用途不同的金鑰，避免同一把金鑰重複使用 */
function deriveKey(purpose: string): Buffer {
  const secret = env().APP_SECRET;
  if (!secret) throw new Error('尚未設定 APP_SECRET 環境變數（至少 32 字元的亂數），請到 Vercel → Settings → Environment Variables 新增');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'parcel-notify', purpose, 32));
}

let hmacKey: Buffer | null = null;
let encKey: Buffer | null = null;
const getHmacKey = () => (hmacKey ??= deriveKey('hmac-v1'));
const getEncKey = () => (encKey ??= deriveKey('enc-v1'));

/** 測試用：APP_SECRET 改變後重新衍生 */
export function resetKeyCache() {
  hmacKey = null;
  encKey = null;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.randomBytes(bytes));
}

/** 不含容易混淆的字元（0/O、1/I/L） */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number, alphabet = CODE_ALPHABET): string {
  let out = '';
  // 用拒絕取樣避免取模偏差
  const max = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const b of bytes) {
      if (b < max) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function randomDigits(length: number): string {
  return randomCode(length, '0123456789');
}

export function hmac(data: string): string {
  return b64url(crypto.createHmac('sha256', getHmacKey()).update(data).digest());
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** 產生 `payload.signature` 格式的簽章字串（payload 為 base64url） */
export function signPayload(payload: string): string {
  const body = b64url(Buffer.from(payload, 'utf8'));
  return `${body}.${hmac(body)}`;
}

export function verifyPayload(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmac(body))) return null;
  try {
    return Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** AES-256-GCM 加密，用來保存社區自己的 LINE 金鑰 */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(enc)}`;
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('無法解密：格式不正確');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
