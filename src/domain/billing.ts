import { desc, eq } from 'drizzle-orm';
import { addDays, dateKey, isCalendarDate } from '@/lib/time';
import { GRACE_DAYS } from './communities';
import { db, schema } from '@/db';
import { audit, type Actor } from './audit';
import { DomainError } from './types';

/** 新增手動收款紀錄：自動把「付費到期日」延長到這筆款項的期間結束日，並恢復停用的社區 */
export async function addBillingRecord(
  actor: Actor & { id?: string | null },
  communityId: string,
  input: { amount: number; periodStart: string; periodEnd: string; paidAt: string; method?: string; invoiceNo?: string; note?: string },
) {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0 || input.amount > 2147483647) throw new DomainError('金額不正確');
  for (const d of [input.periodStart, input.periodEnd, input.paidAt]) {
    if (!isCalendarDate(d)) throw new DomainError('日期格式不正確');
  }
  if (input.periodEnd < input.periodStart) throw new DomainError('期間結束日不能早於開始日');
  return db().transaction(async (tx) => {
    const [community] = await tx.select().from(schema.communities).where(eq(schema.communities.id, communityId)).for('update');
    if (!community) throw new DomainError('找不到社區');

    await tx.insert(schema.billingRecords).values({
      communityId,
      amount: input.amount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paidAt: input.paidAt,
      method: input.method?.trim() || null,
      invoiceNo: input.invoiceNo?.trim() || null,
      note: input.note?.trim() || null,
      createdBy: actor.id ?? null,
    });
    const paidUntil = !community.paidUntil || community.paidUntil < input.periodEnd ? input.periodEnd : community.paidUntil;
    const status = community.status === 'cancelled' || paidUntil < dateKey(addDays(new Date(), -GRACE_DAYS)) ? community.status : 'active';
    await tx.update(schema.communities).set({ paidUntil, status, updatedAt: new Date() }).where(eq(schema.communities.id, communityId));
    await audit(actor, 'billing.record', {
      communityId,
      entityType: 'community',
      entityId: communityId,
      data: { amount: input.amount, periodStart: input.periodStart, periodEnd: input.periodEnd, paidUntil },
    }, tx);
    return { paidUntil };
  });
}

export async function listBillingRecords(communityId?: string) {
  const q = db()
    .select({ record: schema.billingRecords, communityName: schema.communities.name })
    .from(schema.billingRecords)
    .innerJoin(schema.communities, eq(schema.billingRecords.communityId, schema.communities.id));
  return communityId
    ? q.where(eq(schema.billingRecords.communityId, communityId)).orderBy(desc(schema.billingRecords.paidAt))
    : q.orderBy(desc(schema.billingRecords.paidAt)).limit(200);
}
