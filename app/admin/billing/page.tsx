import { requirePlatformAdmin } from '@/auth/session';
import Link from 'next/link';
import { listBillingRecords } from '@/domain/billing';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { formatDate } from '@/lib/time';
import { toCsv } from '@/domain/units';

export const metadata = { title: '收款紀錄' };
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  await requirePlatformAdmin();
  const rows = await listBillingRecords();
  const total = rows.reduce((s, r) => s + r.record.amount, 0);
  const csv = toCsv([
    ['收款日', '社區', '期間開始', '期間結束', '金額', '方式', '發票', '備註'],
    ...rows.map(({ record: r, communityName }) => [r.paidAt, communityName, r.periodStart, r.periodEnd, r.amount, r.method, r.invoiceNo, r.note]),
  ]);
  return (
    <>
      <PageHeader
        title="收款紀錄"
        description={`最近 ${rows.length} 筆，合計 NT$${total.toLocaleString()}。新增收款請到各社區的客戶頁面。`}
        actions={
          rows.length ? (
            <a download="收款紀錄.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold shadow-sm hover:bg-gray-50">
              匯出 CSV
            </a>
          ) : null
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="還沒有收款紀錄" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>收款日</Th>
                <Th>社區</Th>
                <Th>服務期間</Th>
                <Th className="text-right">金額</Th>
                <Th>方式</Th>
                <Th>發票</Th>
                <Th>備註</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ record: r, communityName }) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.paidAt)}</Td>
                  <Td>
                    <Link href={`/admin/communities/${r.communityId}`} className="hover:text-brand-700">
                      {communityName}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                  </Td>
                  <Td className="text-right tabular">NT${r.amount.toLocaleString()}</Td>
                  <Td>{r.method}</Td>
                  <Td>{r.invoiceNo}</Td>
                  <Td className="text-gray-500">{r.note}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
