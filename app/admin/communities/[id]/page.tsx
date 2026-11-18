import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { ROLE_LABELS } from '@/auth/access';
import { addBillingAction, inviteCommunityAdminAction, setCommunityStatusAction, updateCommunityPlanAction } from '@/actions/platform';
import { listBillingRecords } from '@/domain/billing';
import { getCommunityWithPlan, listOrganizations, listPlans } from '@/domain/communities';
import { getUsage } from '@/domain/usage';
import { ActionButton, ActionForm } from '@/components/action-form';
import { CommunityStatusBadge } from '@/components/status';
import { Card, CardBody, CardHeader, Field, Input, LinkButton, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { addDays, dateKey, formatDate, formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function CommunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getCommunityWithPlan(id).catch(() => null);
  if (!data) notFound();
  const { community: c, plan, org } = data;
  const [plans, orgs, records, usage, staff] = await Promise.all([
    listPlans(),
    listOrganizations(),
    listBillingRecords(id),
    getUsage(id),
    db()
      .select({ m: schema.memberships, u: schema.users })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.communityId, id)),
  ]);
  const nextStart = c.paidUntil ? dateKey(addDays(new Date(`${c.paidUntil}T12:00:00+08:00`), 1)) : dateKey();
  const nextEnd = dateKey(addDays(new Date(`${nextStart}T12:00:00+08:00`), 364));

  return (
    <>
      <PageHeader
        title={c.name}
        back={{ href: '/admin/communities', label: '社區客戶' }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CommunityStatusBadge status={c.status} /> {org.name}・/c/{c.slug}・建立於 {formatDate(c.createdAt)}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/c/${c.slug}`} variant="primary">
              進入社區後台
            </LinkButton>
            {c.status === 'suspended' || c.status === 'cancelled' ? (
              <ActionButton action={setCommunityStatusAction.bind(null, c.id, 'active')} variant="secondary" size="md">
                恢復服務
              </ActionButton>
            ) : (
              <ActionButton action={setCommunityStatusAction.bind(null, c.id, 'suspended')} confirm="停用後社區無法登記包裹、也不會發送通知，確定停用？" variant="danger" size="md">
                停用
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="方案與期限" />
          <CardBody>
            <ActionForm action={updateCommunityPlanAction.bind(null, c.id)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="方案">
                  <Select name="planId" defaultValue={plan.id}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.maxUnits} 戶、{p.maxStaff} 人）
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="物業公司">
                  <Select name="orgId" defaultValue={org.id}>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="試用到期日" hint="留白表示沒有試用期">
                  <Input name="trialEndsAt" type="date" defaultValue={c.trialEndsAt ? dateKey(c.trialEndsAt) : ''} />
                </Field>
                <Field label="付費到期日" hint="記錄收款時會自動延長">
                  <Input name="paidUntil" type="date" defaultValue={c.paidUntil ?? ''} />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="本月用量" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">包裹</span>
              <span className="font-semibold tabular">{usage.parcels}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">LINE 推播</span>
              <span className="font-semibold tabular">{usage.linePush}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="font-semibold tabular">{usage.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">LINE 模式</span>
              <span>{c.lineMode === 'shared' ? '共用帳號' : c.lineMode === 'own' ? '自有帳號' : '未設定'}</span>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="收款紀錄" description="新增後會自動延長付費到期日，停用中的社區也會恢復" />
          <CardBody>
            <ActionForm action={addBillingAction.bind(null, c.id)} submitLabel="新增收款" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="金額（NT$）">
                  <Input name="amount" type="number" min={0} required defaultValue={plan.monthlyPrice * 12} />
                </Field>
                <Field label="服務期間開始">
                  <Input name="periodStart" type="date" required defaultValue={nextStart} />
                </Field>
                <Field label="服務期間結束">
                  <Input name="periodEnd" type="date" required defaultValue={nextEnd} />
                </Field>
                <Field label="收款日">
                  <Input name="paidAt" type="date" required defaultValue={dateKey()} />
                </Field>
                <Field label="付款方式">
                  <Select name="method" defaultValue="匯款">
                    <option>匯款</option>
                    <option>現金</option>
                    <option>支票</option>
                    <option>信用卡</option>
                    <option>其他</option>
                  </Select>
                </Field>
                <Field label="發票號碼">
                  <Input name="invoiceNo" />
                </Field>
              </div>
              <Field label="備註">
                <Input name="note" />
              </Field>
            </ActionForm>
          </CardBody>
          {records.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>收款日</Th>
                  <Th>期間</Th>
                  <Th className="text-right">金額</Th>
                  <Th>方式</Th>
                  <Th>發票</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(({ record: r }) => (
                  <tr key={r.id}>
                    <Td>{formatDate(r.paidAt)}</Td>
                    <Td>
                      {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                    </Td>
                    <Td className="text-right tabular">NT${r.amount.toLocaleString()}</Td>
                    <Td>{r.method}</Td>
                    <Td>{r.invoiceNo}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="社區人員" />
          <CardBody className="space-y-4">
            <ul className="divide-y divide-gray-100 text-sm">
              {staff.length === 0 ? <li className="py-2 text-gray-500">還沒有人員</li> : null}
              {staff.map(({ m, u }) => (
                <li key={m.id} className="py-2">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-gray-500">
                    {u.email}・{ROLE_LABELS[m.role]}・{u.lastLoginAt ? `最後登入 ${formatDateTime(u.lastLoginAt)}` : '尚未登入'}
                  </div>
                </li>
              ))}
            </ul>
            <ActionForm action={inviteCommunityAdminAction.bind(null, c.id)} submitLabel="邀請" resetOnSuccess>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="姓名（選填）">
                <Input name="name" />
              </Field>
              <Field label="角色">
                <Select name="role" defaultValue="community_admin">
                  <option value="community_admin">社區管理者</option>
                  <option value="staff">警衛／櫃台</option>
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
