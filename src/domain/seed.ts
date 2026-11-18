import { db, schema } from '@/db';

/** 預設方案（只在資料庫沒有任何方案時建立，之後可在平台後台修改） */
export const DEFAULT_PLANS = [
  {
    code: 'basic',
    name: '基本方案',
    maxUnits: 150,
    maxStaff: 5,
    monthlyPrice: 990,
    features: { email: true, photos: false, sms: false, ownLine: false },
    sortOrder: 1,
  },
  {
    code: 'pro',
    name: '進階方案',
    maxUnits: 400,
    maxStaff: 15,
    monthlyPrice: 1990,
    features: { email: true, photos: true, sms: false, ownLine: true },
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    name: '企業方案',
    maxUnits: 2000,
    maxStaff: 50,
    monthlyPrice: 3990,
    features: { email: true, photos: true, sms: false, ownLine: true },
    sortOrder: 3,
  },
];

export async function seedDefaults() {
  const existing = await db().select({ id: schema.plans.id }).from(schema.plans).limit(1);
  if (existing.length === 0) {
    await db().insert(schema.plans).values(DEFAULT_PLANS).onConflictDoNothing();
  }
}
