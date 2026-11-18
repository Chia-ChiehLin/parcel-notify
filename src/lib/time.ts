export const TZ = 'Asia/Taipei';

/** 台灣時間的 YYYY-MM，用於每月用量統計 */
export function monthKey(d = new Date(), timeZone = TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

/** 台灣時間的 YYYY-MM-DD */
export function dateKey(d = new Date(), timeZone = TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** 該時區「今天 00:00」對應的 UTC 時間 */
export function startOfDay(d = new Date(), timeZone = TZ): Date {
  const key = dateKey(d, timeZone);
  // 以該日 12:00 UTC 推算時區偏移，避免日光節約邊界問題
  const probe = new Date(`${key}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(probe, timeZone);
  return new Date(Date.parse(`${key}T00:00:00Z`) - offsetMin * 60_000);
}

function tzOffsetMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** 距離某個時間還有幾天（無條件進位，最少 0） */
export function daysUntil(d: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function formatDateTime(d: Date | string | null | undefined, timeZone = TZ): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatDate(d: Date | string | null | undefined, timeZone = TZ): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d) : d;
  return new Intl.DateTimeFormat('zh-TW', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** 「3 小時前」這類相對時間 */
export function timeAgo(d: Date | string, now = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Math.max(0, now.getTime() - date.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '剛剛';
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
