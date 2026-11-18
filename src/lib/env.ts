import { z } from 'zod';

/**
 * 伺服器端環境變數。只在用到時才檢查，讓 build 階段不會因為缺少執行期變數而失敗。
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** 主金鑰：用來衍生簽章與加密金鑰（至少 32 字元的亂數）。Vercel 部署會在 migration 前檢查，純本機建置可留空 */
  APP_SECRET: z.string().min(32, 'APP_SECRET 至少需要 32 個字元').optional(),
  /** 對外網址，例如 https://parcel-notify.vercel.app（沒設定時用 Vercel 提供的網址） */
  APP_URL: z.preprocess((value) => value === '' ? undefined : value, z.url({ protocol: /^https?$/ }).optional()),
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
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function brandName(): string {
  return process.env.BRAND_NAME?.trim() || '樓下有件';
}

/** 只供政策與客服頁面顯示；不使用登入帳號或平台管理員的私人資料。 */
export function serviceContact() {
  const email = z.email().safeParse(process.env.SUPPORT_EMAIL?.trim());
  return { operator: process.env.SERVICE_OPERATOR?.trim() || null, email: email.success ? email.data : null };
}
