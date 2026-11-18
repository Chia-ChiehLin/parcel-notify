import { serviceContact } from '@/lib/env';
import { emailGateway } from '@/channels/gateway';
import { requirePlatformAdmin } from '@/auth/session';
import Link from 'next/link';
import { listCommunitiesForPlatform, GRACE_DAYS } from '@/domain/communities';
import { platformStats } from '@/domain/stats';
import { listUsageForMonth } from '@/domain/usage';
import { getSharedChannel } from '@/domain/line-channels';
import { CommunityStatusBadge } from '@/components/status';
import { Alert, Card, CardHeader, LinkButton, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { addDays, dateKey, formatDate } from '@/lib/time';

export const metadata = { title: '平台總覽' };
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  await requirePlatformAdmin();
  const [stats, rows, usage, shared] = await Promise.all([platformStats(), listCommunitiesForPlatform(), listUsageForMonth(), getSharedChannel()]);
  const contact = serviceContact();
  const readiness = [
    !emailGateway().isConfigured() && '寄信服務尚未設定，請設定 Resend API 金鑰與已驗證寄件地址，並實際收取一封測試信。',
    (!contact.operator || !contact.email) && '請補齊政策頁的營運者名稱與公開客服信箱，讓社區能洽詢服務或提出個資申請。',
    process.env.SETUP_TOKEN && '平台管理員已建立。請從 Vercel 移除一次性設定碼 SETUP_TOKEN 並重新部署。',
  ].filter(Boolean);
  const usageMap = new Map(usage.map((u) => [u.communityId, u]));
  const soon = dateKey(addDays(new Date(), 14));
  const expiring = rows.filter(({ community: c }) => {
    if (c.status === 'cancelled' || c.status === 'suspended') return false;
    const end = c.paidUntil ?? (c.trialEndsAt ? dateKey(c.trialEndsAt) : null);
    return end !== null && end <= soon;
  });
  const totalPush = usage.reduce((s, u) => s + u.linePush, 0);

  return (
    <>
      <PageHeader title="平台總覽" actions={<LinkButton variant="primary" href="/admin/communities/new">＋ 開通新社區</LinkButton>} />
      {readiness.length > 0 && <Alert tone="info" title="開始收費前待辦" className="mb-6">
        <ul className="list-disc space-y-1 pl-5">{readiness.map(item => <li key={String(item)}>{item}</li>)}</ul>
      </Alert>}
      {!shared ? (
        <Alert tone="warning" title="還沒有設定共用 LINE 官方帳號" className="mb-6">
          使用「共用帳號」的社區目前無法發送 LINE 通知。<Link href="/admin/line" className="font-semibold underline">前往設定</Link>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="社區客戶" value={stats.communities} sub={`使用中 ${stats.byStatus.active ?? 0}・試用 ${stats.byStatus.trial ?? 0}・停用 ${stats.byStatus.suspended ?? 0}`} href="/admin/communities" />
        <Stat label="已綁定住戶" value={stats.residents} />
        <Stat label="近 30 天包裹" value={stats.parcels30} />
        <Stat label="本月 LINE 推播" value={totalPush} sub="所有社區合計（則）" />
      </div>

      <Card className="mt-6">
        <CardHeader title="14 天內到期" description={`付費到期後有 ${GRACE_DAYS} 天寬限期，之後系統會自動停用`} />
        {expiring.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">沒有即將到期的社區。</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>社區</Th>
                <Th>狀態</Th>
                <Th>到期日</Th>
                <Th>方案</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expiring.map(({ community: c, plan }) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>
                    <CommunityStatusBadge status={c.status} />
                  </Td>
                  <Td>{c.paidUntil ? formatDate(c.paidUntil) : `試用至 ${formatDate(c.trialEndsAt)}`}</Td>
                  <Td>{plan.name}</Td>
                  <Td className="text-right">
                    <LinkButton size="sm" href={`/admin/communities/${c.id}`}>
                      記錄收款
                    </LinkButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="本月用量" description="LINE 推播會計入各官方帳號的每月額度" />
        <Table>
          <thead>
            <tr>
              <Th>社區</Th>
              <Th className="text-right">包裹</Th>
              <Th className="text-right">LINE 推播</Th>
              <Th className="text-right">Email</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.slice(0, 20).map(({ community: c }) => {
              const u = usageMap.get(c.id);
              return (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/admin/communities/${c.id}`} className="font-medium hover:text-brand-700">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular">{u?.parcels ?? 0}</Td>
                  <Td className="text-right tabular">{u?.linePush ?? 0}</Td>
                  <Td className="text-right tabular">{u?.email ?? 0}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
