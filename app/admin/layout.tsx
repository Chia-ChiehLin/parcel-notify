import { requirePlatformAdmin } from '@/auth/session';
import { AppShell } from '@/components/shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <AppShell
      title="平台總後台"
      userName={user.name}
      userRole="平台管理員"
      groups={[
        {
          items: [
            { href: '/admin', label: '總覽', icon: '📊', exact: true },
            { href: '/admin/communities', label: '社區客戶', icon: '🏘️' },
            { href: '/admin/orgs', label: '物業公司', icon: '🏢' },
            { href: '/admin/billing', label: '收款紀錄', icon: '💰' },
          ],
        },
        {
          title: '設定',
          items: [
            { href: '/admin/plans', label: '方案', icon: '🧾' },
            { href: '/admin/line', label: '共用 LINE 帳號', icon: '💬' },
            { href: '/admin/users', label: '使用者帳號', icon: '👤' },
            { href: '/admin/audit', label: '稽核紀錄', icon: '📜' },
          ],
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
