import Link from 'next/link';
import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import { removeResidentAction } from '@/actions/community';
import { listResidents } from '@/domain/residents';
import { ActionButton } from '@/components/action-form';
import { Badge, Card, EmptyState, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: '住戶' };

export default async function ResidentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const { q } = await searchParams;
  const ctx = await requireCommunity(slug);
  const isAdmin = hasRole(ctx.role, 'community_admin');
  const rows = await listResidents(ctx.community.id, { q });
  return (
    <>
      <PageHeader title="住戶" description={`${rows.length} 位已綁定的住戶。住戶用綁定卡上的綁定碼自行綁定，不需要手動新增。`} />
      <Card>
        <div className="border-b border-gray-100 px-5 py-3">
          <form>
            <Input name="q" defaultValue={q} placeholder="搜尋姓名、門牌、Email" className="max-w-xs" />
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="還沒有住戶" description="列印綁定卡投入信箱，住戶掃描後就會出現在這裡。" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>門牌</Th>
                <Th>住戶</Th>
                <Th>通知方式</Th>
                <Th>語言</Th>
                <Th>綁定時間</Th>
                {isAdmin ? <Th /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ resident: r, unitLabel }) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/c/${slug}/units/${r.unitId}`} className="font-semibold hover:text-brand-700">
                      {unitLabel}
                    </Link>
                  </Td>
                  <Td>
                    {r.displayName || '（未命名）'} {r.isPrimary ? <Badge tone="brand">主要</Badge> : null}
                  </Td>
                  <Td className="space-x-1">
                    {r.lineUserId ? <Badge tone={r.lineFollowing && r.notifyLine ? 'green' : 'gray'}>{r.lineFollowing ? 'LINE' : '已封鎖'}</Badge> : null}
                    {r.email ? <Badge tone={r.notifyEmail ? 'blue' : 'gray'}>Email</Badge> : null}
                  </Td>
                  <Td className="text-sm">{r.language === 'en' ? 'English' : '中文'}</Td>
                  <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(r.boundAt)}</Td>
                  {isAdmin ? (
                    <Td className="text-right">
                      <ActionButton action={removeResidentAction.bind(null, slug, r.id)} confirm={`確定移除 ${unitLabel} 的「${r.displayName || '住戶'}」？`} variant="ghost">
                        移除
                      </ActionButton>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
