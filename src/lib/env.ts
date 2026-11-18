import { z } from 'zod';

/**
 * 伺服器端環境變數。只在用到時才檢查，讓 build 階段不會因為缺少執行期變數而失敗。
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** 主金鑰：用來衍生簽章與加密金鑰（至少 32 字元的亂數）。build 與 migration 不需要，執行時才檢查 */
  APP_SECRET: z.string().min(32, 'APP_SECRET 至少需要 32 個字元').optional(),
  /** 對外網址，例如 https://parcel-notify.vercel.app（沒設定時用 Vercel 提供的網址） */
  APP_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),
  /** 建立第一個平台管理員用的一次性設定碼 */
  SETUP_TOKEN: z.string().optional(),
  BRAND_NAME: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`環境變數設定錯誤：${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** 測試用：清除快取，讓修改過的 process.env 生效 */
export function resetEnvCache() {
  cached = null;
}

export function appUrl(): string {
  const e = env();
  if (e.APP_URL) return e.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL && process.env.VERCEL_ENV === 'production') {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function brandName(): string {
  return process.env.BRAND_NAME || '社區包裹通';
}
