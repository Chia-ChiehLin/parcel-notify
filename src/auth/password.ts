import { hash, verify } from '@node-rs/argon2';

// OWASP 建議的 argon2id 參數
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return '密碼至少需要 8 個字元';
  if (password.length > 128) return '密碼太長';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密碼需同時包含英文字母和數字';
  return null;
}
