import { hasRole } from '@/auth/access';
import Link from 'next/link';
import { requireCommunity } from '@/auth/session';
import { listParcels } from '@/domain/parcels';
import type { ParcelStatus } from '@/db/schema';
import { CategoryBadges, NotifyBadge, ParcelStatusBadge } from '@/components/status';
import { Card, EmptyState, Input, LinkButton, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';
import { addDays, formatDateTime, isCalendarDate } from '@/lib/time';

export const metadata = { title: '包裹紀錄' };

const TABS: [string, string][] = [
  ['waiting', '待領取'],
  ['overdue', '逾期'],
  ['picked_up', '已領取'],
  ['returned', '退件'],
  ['cancelled', '已取消'],
  ['all', '全部'],
];

export default async function ParcelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string; from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireCommunity(slug);
  const status = (TABS.some(([v]) => v === sp.status) ? sp.status : 'waiting') as ParcelStatus | 'overdue' | 'all';
  const from = sp.from && isCalendarDate(sp.from) ? new Date(`${sp.from}T00:00:00+08:00`) : undefined;
  const to = sp.to && isCalendarDate(sp.to) ? new Date(`${sp.to}T23:59:59.999+08:00`) : undefined;
  const requestedPage = Number(sp.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10_000_000 ? requestedPage : 1;
  const { rows, total, pageSize, overdueDays } = await listParcels(ctx.community.id, { status, q: sp.q, from, to, page });
  const overdueBefore = addDays(new Date(), -overdueDays);
  const base = `/c/${slug}/parcels`;
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, q: sp.q, from: sp.from, to: sp.to, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '') p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="包裹紀錄"
        description={`${total} 件`}
        actions={
          <>
            {status === 'waiting' || status === 'overdue' ? <LinkButton href={`/c/${slug}/print/slips?unbound=1`}>列印未綁定戶通知單</LinkButton> : null}
            {hasRole(ctx.role, 'community_admin') ? <a href={`${base}/export${qs({ page: undefined })}`} className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold shadow-sm hover:bg-gray-50">
              匯出 CSV
            </a> : null}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap gap-1 text-sm">
            {TABS.map(([v, label]) => (
              <Link key={v} href={`${base}${qs({ status: v, page: undefined })}`} className={`rounded-md px-3 py-1.5 ${status === v ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-600 hover:bg-gray-100'}`}>
                {label}
              </Link>
            ))}
          </div>
          <form className="flex flex-wrap gap-2">
            <input type="hidden" name="status" value={status} />
            <Input type="date" name="from" defaultValue={sp.from} className="w-36" aria-label="從" />
            <Input type="date" name="to" defaultValue={sp.to} className="w-36" aria-label="到" />
            <Input name="q" defaultValue={sp.q} placeholder="門牌、單號、取件碼" className="w-48" />
            <button className="h-10 rounded-lg bg-gray-800 px-3 text-sm font-medium text-white">搜尋</button>
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="沒有符合的包裹" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>門牌</Th>
                <Th>到件</Th>
                <Th>物流／類別</Th>
                <Th>位置</Th>
                <Th>取件碼</Th>
                <Th>狀態</Th>
                <Th>通知</Th>
                <Th>經手</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ parcel: p, unitLabel, receiverName, handlerName }) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`${base}/${p.id}`} className="font-semibold text-gray-900 hover:text-brand-700">
                      {unitLabel}
                    </Link>
                    {p.quantity > 1 ? <span className="ml-1 text-xs text-gray-500">×{p.quantity}</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-sm">{formatDateTime(p.receivedAt)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{p.carrier ?? '—'}</span>
                      <CategoryBadges categories={p.categories} />
                    </div>
                    {p.trackingNo ? <div className="text-xs text-gray-500">{p.trackingNo}</div> : null}
                  </Td>
                  <Td className="text-sm">{p.storageLocation ?? '—'}</Td>
                  <Td className="font-mono text-sm">{p.pickupCode}</Td>
                  <Td>
                    <ParcelStatusBadge status={p.status} overdue={p.status === 'waiting' && p.receivedAt < overdueBefore} />
                  </Td>
                  <Td>
                    <NotifyBadge status={p.notifyStatus} />
                  </Td>
                  <Td className="text-xs text-gray-500">
                    {receiverName ? <div>收：{receiverName}</div> : null}
                    {handlerName ? <div>交：{handlerName}</div> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `${base}${qs({ page: p })}`} />
      </Card>
    </>
  );
}
