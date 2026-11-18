import { z } from 'zod';

export const DEFAULT_CARRIERS = [
  '黑貓宅急便',
  '新竹物流',
  '中華郵政',
  '嘉里大榮',
  '蝦皮店到家',
  'momo 富昇物流',
  '網家速配',
  '順豐速運',
  'DHL',
  '其他',
];

export const DEFAULT_STORAGE_LOCATIONS = ['一般區', '大型區', '冷藏櫃', '冷凍櫃', '掛號信件區'];

export const communitySettingsSchema = z.object({
  /** 超過幾天未領算逾期 */
  overdueDays: z.number().int().min(1).max(60).default(3),
  /** 逾期後每隔幾天提醒一次 */
  reminderIntervalDays: z.number().int().min(1).max(30).default(2),
  /** 最多提醒幾次（0 = 不提醒） */
  maxReminders: z.number().int().min(0).max(10).default(3),
  /** 同戶所有成員都推播（關閉時只推播主要聯絡人，可省 LINE 訊息費） */
  notifyAllMembers: z.boolean().default(false),
  /** 領取完成後推播確認訊息 */
  notifyOnPickup: z.boolean().default(false),
  /** LINE 收不到時改寄 Email */
  emailFallback: z.boolean().default(true),
  /** 交付時要求簽名 */
  requireSignature: z.boolean().default(false),
  /** 包裹紀錄保留天數 */
  retentionDays: z.number().int().min(30).max(3650).default(180),
  /** 照片在領取後保留天數 */
  photoRetentionDays: z.number().int().min(1).max(365).default(30),
  carriers: z.array(z.string().trim().min(1).max(30)).max(50).default(DEFAULT_CARRIERS),
  storageLocations: z.array(z.string().trim().min(1).max(30)).max(50).default(DEFAULT_STORAGE_LOCATIONS),
  /** 管理室聯絡資訊，會出現在通知裡 */
  deskPhone: z.string().max(30).default(''),
  deskHours: z.string().max(60).default(''),
});

export type CommunitySettings = z.infer<typeof communitySettingsSchema>;

/** 解析資料庫裡的設定 JSON，缺少的欄位補預設值，格式錯誤的欄位也退回預設值 */
export function parseSettings(raw: unknown): CommunitySettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = communitySettingsSchema.safeParse(obj);
  if (result.success) return result.data;
  // 個別欄位錯誤時，只把錯的欄位拿掉
  const cleaned: Record<string, unknown> = { ...obj };
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete cleaned[key];
  }
  return communitySettingsSchema.parse(cleaned);
}

export const CATEGORY_LABELS: Record<string, string> = {
  cold: '冷藏',
  frozen: '冷凍',
  large: '大型',
  registered: '掛號',
  document: '文件',
  fragile: '易碎',
};
