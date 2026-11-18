import Link from 'next/link';
import { and, asc, eq, lte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import { notifyAllPendingAction } from '@/actions/parcels';
import { resolveCommunityChannel } from '@/domain/line-channels';
import { dashboardStats } from '@/domain/stats';
import { DailyColumns, RankedBars } from '@/components/charts';
import { StateButton } from '@/components/state-button';
import { CategoryBadges } from '@/components/status';
import { Alert, Card, CardBody, CardHeader, LinkButton, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { addDays, timeAgo } from '@/lib/time';

export const metadata = { title: '總覽' };

export default async function Dashboard({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ denied?: string }> }) {
  const { slug } = await params;
  const { denied } = await searchParams;
  const ctx = await requireCommunity(slug);
  const c = ctx.community;
  const isAdmin = hasRole(ctx.role, 'community_admin');
  const [stats, resolved, pendingNotify, overdueList] = await Promise.all([
    dashboardStats(c),
    resolveCommunityChannel(c),
    db()
      .select({ id: schema.parcels.id })
      .from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, c.id), eq(schema.parcels.status, 'waiting'), eq(schema.parcels.notifyStatus, 'pending'))),
    db()
      .select({ parcel: schema.parcels, unitLabel: schema.units.label })
      .from(schema.parcels)
      .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
      .where(and(eq(schema.parcels.communityId, c.id), eq(schema.parcels.status, 'waiting'), lte(schema.parcels.receivedAt, addDays(new Date(), -ctx.settings.overdueDays))))
      .orderBy(asc(schema.parcels.receivedAt))
      .limit(8),
  ]);
  const base = `/c/${slug}`;

  return (
    <>
      <PageHeader
        title="總覽"
        description={c.name}
        actions={
          <>
            <LinkButton href={`${base}/receive`} variant="primary" size="lg">
              📥 收件登記
            </LinkButton>
            <LinkButton href={`${base}/pickup`} size="lg">
              📤 交付取件
            </LinkButton>
          </>
        }
      />
      {denied ? <Alert tone="warning" className="mb-4">你的帳號沒有權限使用那個功能，請聯絡社區管理者。</Alert> : null}
      {!resolved && !ctx.readOnly ? (
        <Alert tone="warning" className="mb-4" title="LINE 官方帳號尚未設定">
          目前住戶收不到 LINE 通知。{isAdmin ? <Link href={`${base}/settings/line`} className="font-semibold underline">前往設定</Link> : '請聯絡社區管理者。'}
        </Alert>
      ) : null}
      {pendingNotify.length ? (
        <Alert tone="warning" className="mb-4" title={`有 ${pendingNotify.length} 件包裹已登記但還沒發通知`}>
          <div className="mt-2">
            <StateButton action={notifyAllPendingAction.bind(null, slug)} variant="primary">
              全部發送通知
            </StateButton>
          </div>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="今日收件" value={stats.receivedToday} sub="件" />
        <Stat label="今日交付" value={stats.pickedToday} sub="件" />
        <Stat label="待領取" value={stats.waiting} sub={`${stats.waitingUnits} 戶`} tone="brand" href={`${base}/parcels?status=waiting`} />
        <Stat label="逾期未領" value={stats.overdue} sub={`超過 ${stats.overdueDays} 天`} tone={stats.overdue ? 'red' : 'gray'} href={`${base}/parcels?status=overdue`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="近 14 天收件量" description="件數，以到件日計算" />
          <CardBody className="pl-12">
            <DailyColumns data={stats.days} label="近 14 天每日收件量" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="物流商（近 30 天）" />
          <CardBody>
            <RankedBars data={stats.byCarrier.map((x) => ({ name: x.carrier, n: x.n }))} label="近 30 天各物流商件數" />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="逾期未領" description={`超過 ${stats.overdueDays} 天，系統會依設定自動提醒住戶`} actions={stats.overdue ? <LinkButton size="sm" href={`${base}/parcels?status=overdue`}>查看全部</LinkButton> : null} />
          {overdueList.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">沒有逾期的包裹 👍</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>門牌</Th>
                  <Th>物流／類別</Th>
                  <Th>位置</Th>
                  <Th>到件</Th>
                  <Th>已提醒</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overdueList.map(({ parcel: p, unitLabel }) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <Td>
                      <Link href={`${base}/parcels/${p.id}`} className="font-semibold hover:text-brand-700">
                        {unitLabel}
                      </Link>
                    </Td>
                    <Td>
                      {p.carrier ?? '—'} <CategoryBadges categories={p.categories} />
                    </Td>
                    <Td>{p.storageLocation ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-red-600">{timeAgo(p.receivedAt)}</Td>
                    <Td className="tabular">{p.reminderCount} 次</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="住戶綁定" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">已綁定住戶</span>
              <span className="font-semibold tabular">{stats.residents} 人</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">尚未綁定的戶別</span>
              <span className="font-semibold tabular">
                {stats.unboundUnits} / {stats.units} 戶
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">平均領取時間（30 天）</span>
              <span className="font-semibold tabular">{stats.avgPickupHours === null ? '—' : `${stats.avgPickupHours} 小時`}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3">
              <span className="text-gray-500">本月 LINE 推播</span>
              <span className="font-semibold tabular">{stats.usage.linePush} 則</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">本月 Email</span>
              <span className="font-semibold tabular">{stats.usage.email} 封</span>
            </div>
            {isAdmin && stats.unboundUnits ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <LinkButton size="sm" href={`${base}/print/cards?unbound=1`}>
                  列印未綁定戶的綁定卡
                </LinkButton>
                <LinkButton size="sm" href={`${base}/print/slips?unbound=1`}>
                  列印未綁定戶的通知單
                </LinkButton>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
