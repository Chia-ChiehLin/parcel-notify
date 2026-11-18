/** Drizzle 會把 pg 的錯誤包在 cause 裡，這裡兩層都檢查 */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const candidates = [e, (e as { cause?: unknown })?.cause];
  return candidates.some((c) => {
    if (!c || typeof c !== 'object') return false;
    const err = c as { code?: string; constraint?: string; message?: string };
    if (err.code !== '23505') return false;
    return !constraint || err.constraint === constraint || !!err.message?.includes(constraint);
  });
}
