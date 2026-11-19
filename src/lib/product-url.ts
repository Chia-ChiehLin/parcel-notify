import { isStaging } from './env';

/** 只有正式服務的品牌頁可收錄。 */
export function publicProductUrl(): URL | undefined {
  if (process.env.VERCEL_ENV !== 'production' || isStaging()) return undefined;
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (!base) return undefined;
  const url = new URL('/product', base);
  return url.protocol === 'https:' ? url : undefined;
}
