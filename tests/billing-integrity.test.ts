import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { addBillingRecord } from '@/domain/billing';
import { ADMIN, makeCommunity } from './helpers';

it('同時登記收款保留最長付費期限，保留每筆收款與稽核', async () => {
  const { community } = await makeCommunity();
  const payment = { amount: 990, periodStart: '2030-01-01', paidAt: '2030-01-01' };
  await Promise.all(['2030-02-28', '2030-01-31'].map(periodEnd =>
    addBillingRecord(ADMIN, community.id, { ...payment, periodEnd })));
  const [stored] = await db().select().from(schema.communities).where(eq(schema.communities.id, community.id));
  expect(stored.paidUntil).toBe('2030-02-28');
  expect(await db().select().from(schema.billingRecords)).toHaveLength(2);
  expect(await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'billing.record'))).toHaveLength(2);
});

it('錯誤的日曆日期不產生帳款', async () => {
  const { community } = await makeCommunity();
  await expect(addBillingRecord(ADMIN, community.id, { amount: 990, paidAt: '2026-02-29', periodStart: '2026-02-01', periodEnd: '2026-02-28' })).rejects.toThrow('日期格式不正確');
  expect(await db().select().from(schema.billingRecords)).toHaveLength(0);
});
