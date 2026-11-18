import { ROLE_LABELS } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import { changeStaffRoleAction, inviteStaffAction, removeStaffAction, revokeInviteAction } from '@/actions/community';
import { getCommunityWithPlan } from '@/domain/communities';
import { listStaff } from '@/domain/staff';
import { ActionButton, ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: '人員帳號' };

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const [{ members, invites }, { plan }] = await Promise.all([listStaff(ctx.community.id), getCommunityWithPlan(ctx.community.id)]);
  return (
    <>
      <PageHeader title="人員帳號" description={`${members.length} 位人員，${invites.length} 個邀請待接受（方案上限 ${plan.maxStaff} 人）。每位警衛建議用自己的帳號，紀錄才查得到是誰處理的。`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <Th>人員</Th>
                <Th>角色</Th>
                <Th>最後登入</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map(({ membership: m, user: u }) => (
                <tr key={m.id}>
                  <Td>
                    <div className="font-medium">
                      {u.name} {u.id === ctx.user.id ? <span className="text-xs text-gray-400">（你）</span> : null}
                    </div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </Td>
                  <Td>
                    <Badge tone={m.role === 'community_admin' ? 'brand' : 'gray'}>{ROLE_LABELS[m.role]}</Badge>
                  </Td>
                  <Td className="text-sm text-gray-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '尚未登入'}</Td>
                  <Td className="text-right">
                    {u.id !== ctx.user.id ? (
                      <div className="flex justify-end gap-2">
                        <ActionButton action={changeStaffRoleAction.bind(null, slug, m.id, m.role === 'staff' ? 'community_admin' : 'staff')} variant="ghost">
                          {m.role === 'staff' ? '改為管理者' : '改為警衛'}
                        </ActionButton>
                        <ActionButton action={removeStaffAction.bind(null, slug, m.id)} confirm={`確定移除 ${u.name}？`} variant="ghost">
                          移除
                        </ActionButton>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
              {invites.map((inv) => (
                <tr key={inv.id} className="bg-amber-50/40">
                  <Td>
                    <div className="font-medium text-gray-600">{inv.payload.name || inv.email}</div>
                    <div className="text-xs text-gray-500">{inv.email}</div>
                  </Td>
                  <Td>
                    <Badge tone="yellow">邀請中・{inv.payload.role ? ROLE_LABELS[inv.payload.role] : ''}</Badge>
                  </Td>
                  <Td className="text-sm text-gray-500">到期 {formatDateTime(inv.expiresAt)}</Td>
                  <Td className="text-right">
                    <ActionButton action={revokeInviteAction.bind(null, slug, inv.id)} variant="ghost">
                      取消邀請
                    </ActionButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card className="h-fit">
          <CardHeader title="邀請人員" description="對方會收到連結，自行設定密碼" />
          <CardBody>
            <ActionForm action={inviteStaffAction.bind(null, slug)} submitLabel="送出邀請" resetOnSuccess>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="姓名">
                <Input name="name" />
              </Field>
              <Field label="角色" hint="警衛只能收發包裹；管理者可以設定戶別、人員與社區設定">
                <Select name="role" defaultValue="staff">
                  <option value="staff">警衛／櫃台</option>
                  <option value="community_admin">社區管理者</option>
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
