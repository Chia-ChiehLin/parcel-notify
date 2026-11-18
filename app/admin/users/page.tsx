import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { ROLE_LABELS } from '@/auth/access';
import { requirePlatformAdmin } from '@/auth/session';
import { createResetLinkAction, toggleUserStatusAction } from '@/actions/platform';
import { ActionButton } from '@/components/action-form';
import { StateButton } from '@/components/state-button';
import { Badge, Card, PageHeader, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: '使用者帳號' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requirePlatformAdmin();
  const users = await db().select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(500);
  const mems = await db()
    .select({ userId: schema.memberships.userId, role: schema.memberships.role, community: schema.communities.name, org: schema.organizations.name })
    .from(schema.memberships)
    .leftJoin(schema.communities, eq(schema.memberships.communityId, schema.communities.id))
    .leftJoin(schema.organizations, eq(schema.memberships.orgId, schema.organizations.id));
  return (
    <>
      <PageHeader title="使用者帳號" description="客戶忘記密碼又收不到信時，可以在這裡產生重設連結交給對方。" />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>使用者</Th>
              <Th>所屬</Th>
              <Th>最後登入</Th>
              <Th>狀態</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </Td>
                <Td className="text-sm">
                  {u.isPlatformAdmin ? <Badge tone="brand">平台管理員</Badge> : null}
                  {mems
                    .filter((m) => m.userId === u.id)
                    .map((m, i) => (
                      <div key={i} className="text-xs text-gray-600">
                        {m.org ?? m.community}・{ROLE_LABELS[m.role]}
                      </div>
                    ))}
                </Td>
                <Td className="whitespace-nowrap text-sm">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</Td>
                <Td>{u.status === 'active' ? <Badge tone="green">啟用</Badge> : <Badge tone="red">停用</Badge>}</Td>
                <Td className="space-y-2 text-right">
                  {u.id !== me.id ? (
                    <div className="flex flex-col items-end gap-2">
                      <StateButton action={createResetLinkAction.bind(null, u.id)}>產生重設密碼連結</StateButton>
                      <ActionButton action={toggleUserStatusAction.bind(null, u.id)} confirm={u.status === 'active' ? '停用後此帳號會立即被登出，確定？' : undefined} variant={u.status === 'active' ? 'danger' : 'secondary'}>
                        {u.status === 'active' ? '停用帳號' : '重新啟用'}
                      </ActionButton>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">（你）</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
