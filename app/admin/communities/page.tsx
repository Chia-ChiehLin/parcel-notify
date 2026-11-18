import Link from 'next/link';
import { listCommunitiesForPlatform } from '@/domain/communities';
import { CommunityStatusBadge } from '@/components/status';
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from '@/components/ui';
import { formatDate } from '@/lib/time';

export const metadata = { title: '社區客戶' };
export const dynamic = 'force-dynamic';

export default async function CommunitiesPage() {
  const rows = await listCommunitiesForPlatform();
  return (
    <>
      <PageHeader title="社區客戶" description={`共 ${rows.length} 個社區`} actions={<LinkButton variant="primary" href="/admin/communities/new">＋ 開通新社區</LinkButton>} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="還沒有任何社區" description="開通第一個社區客戶，系統會建立社區後台並產生管理者邀請連結。" action={<LinkButton variant="primary" href="/admin/communities/new">開通新社區</LinkButton>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>社區</Th>
                <Th>物業公司</Th>
                <Th>狀態</Th>
                <Th>方案</Th>
                <Th className="text-right">戶數</Th>
                <Th className="text-right">住戶</Th>
                <Th className="text-right">近 30 天包裹</Th>
                <Th>期限</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ community: c, plan, org, unitCount, residentCount, parcels30d }) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`/admin/communities/${c.id}`} className="font-medium text-gray-900 hover:text-brand-700">
                      {c.name}
                    </Link>
                    <div className="text-xs text-gray-500">/c/{c.slug}</div>
                  </Td>
                  <Td>{org.name}</Td>
                  <Td>
                    <CommunityStatusBadge status={c.status} />
                  </Td>
                  <Td>{plan.name}</Td>
                  <Td className="text-right tabular">
                    {unitCount}
                    <span className="text-gray-400">/{plan.maxUnits}</span>
                  </Td>
                  <Td className="text-right tabular">{residentCount}</Td>
                  <Td className="text-right tabular">{parcels30d}</Td>
                  <Td className="whitespace-nowrap text-sm">{c.paidUntil ? formatDate(c.paidUntil) : c.trialEndsAt ? `試用至 ${formatDate(c.trialEndsAt)}` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
