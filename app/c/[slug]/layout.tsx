import Link from 'next/link';
import { hasRole, listAccessibleCommunities, ROLE_LABELS } from '@/auth/access';
import { logPlatformAccess, requireCommunity } from '@/auth/session';
import { AppShell, type NavGroup } from '@/components/shell';
import { CommunitySwitcher } from '@/components/switcher';
import { dateKey, daysUntil } from '@/lib/time';

export default async function CommunityLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug);
  await logPlatformAccess(ctx);
  const isAdmin = hasRole(ctx.role, 'community_admin');
  const base = `/c/${slug}`;
  const groups: NavGroup[] = [
    {
      items: [
        { href: base, label: '總覽', icon: '📊', exact: true },
        { href: `${base}/receive`, label: '收件登記', icon: '📥' },
        { href: `${base}/pickup`, label: '交付取件', icon: '📤' },
        { href: `${base}/parcels`, label: '包裹紀錄', icon: '📦' },
      ],
    },
    {
      title: '住戶',
      items: [
        { href: `${base}/units`, label: '戶別', icon: '🏠' },
        { href: `${base}/residents`, label: '住戶', icon: '👨‍👩‍👧' },
        ...(isAdmin ? [{ href: `${base}/print/cards`, label: '列印綁定卡', icon: '🖨️' }] : []),
      ],
    },
    ...(isAdmin
      ? [
          {
            title: '管理',
            items: [
              { href: `${base}/setup`, label: '開通設定', icon: '📋' },
              { href: `${base}/staff`, label: '人員帳號', icon: '👤' },
              { href: `${base}/settings`, label: '社區設定', icon: '⚙️', exact: true },
              { href: `${base}/settings/line`, label: 'LINE 官方帳號', icon: '💬' },
              { href: `${base}/audit`, label: '稽核紀錄', icon: '📜' },
            ],
          },
        ]
      : []),
  ];

  const all = await listAccessibleCommunities(ctx.user);
  const c = ctx.community;
  let banner: React.ReactNode = null;
  if (ctx.readOnly) {
    banner = (
      <div className="no-print bg-red-600 px-4 py-2 text-center text-sm font-medium text-white">
        社區服務已停用：可以查看紀錄和交付包裹，但無法登記新包裹或發送通知。請聯絡服務商續約。
      </div>
    );
  } else if (c.status === 'trial' && c.trialEndsAt) {
    const days = daysUntil(c.trialEndsAt);
    banner = <div className="no-print bg-blue-600 px-4 py-2 text-center text-sm text-white">試用中，剩下 {days} 天（至 {dateKey(c.trialEndsAt)}）</div>;
  } else if (!c.setupCompletedAt && isAdmin) {
    banner = (
      <div className="no-print bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
        社區還沒設定完成。<Link href={`${base}/setup`} className="font-semibold underline">繼續開通設定</Link>
      </div>
    );
  }

  return (
    <AppShell
      title={c.name}
      userName={ctx.user.name}
      userRole={ROLE_LABELS[ctx.role]}
      groups={groups}
      banner={banner}
      switcher={all.length > 1 || ctx.user.isPlatformAdmin ? <CommunitySwitcher current={slug} communities={all.map((x) => ({ slug: x.slug, name: x.name }))} isPlatformAdmin={ctx.user.isPlatformAdmin} /> : null}
    >
      {children}
    </AppShell>
  );
}
