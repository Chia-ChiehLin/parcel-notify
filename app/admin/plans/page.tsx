import { requirePlatformAdmin } from '@/auth/session';
import { savePlanAction } from '@/actions/platform';
import { listPlans } from '@/domain/communities';
import { ActionForm } from '@/components/action-form';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import type { schema } from '@/db';

export const metadata = { title: '方案' };
export const dynamic = 'force-dynamic';

function PlanFields({ plan }: { plan?: typeof schema.plans.$inferSelect }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="方案名稱">
          <Input name="name" defaultValue={plan?.name} required />
        </Field>
        <Field label="代碼">
          <Input name="code" defaultValue={plan?.code} required pattern="[a-z0-9-]{2,30}" />
        </Field>
        <Field label="戶數上限">
          <Input name="maxUnits" type="number" min={1} defaultValue={plan?.maxUnits ?? 150} required />
        </Field>
        <Field label="人員帳號上限">
          <Input name="maxStaff" type="number" min={1} defaultValue={plan?.maxStaff ?? 5} required />
        </Field>
        <Field label="月費（NT$）">
          <Input name="monthlyPrice" type="number" min={0} defaultValue={plan?.monthlyPrice ?? 0} />
        </Field>
        <Field label="排序">
          <Input name="sortOrder" type="number" defaultValue={plan?.sortOrder ?? 0} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Checkbox name="fEmail" label="Email 通知" defaultChecked={plan?.features.email ?? true} />
        <Checkbox name="fPhotos" label="包裹拍照" defaultChecked={plan?.features.photos ?? false} />
        <Checkbox name="fOwnLine" label="自有 LINE 帳號" defaultChecked={plan?.features.ownLine ?? false} />
        <Checkbox name="isActive" label="可供選擇" defaultChecked={plan?.isActive ?? true} />
      </div>
    </>
  );
}

export default async function PlansPage() {
  await requirePlatformAdmin();
  const plans = await listPlans();
  return (
    <>
      <PageHeader title="方案" description="修改方案會立即套用到使用該方案的社區。超過上限時，社區會被擋下新增戶別或人員。" />
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader title={p.name} description={`NT$${p.monthlyPrice.toLocaleString()}/月`} />
            <CardBody>
              <ActionForm action={savePlanAction.bind(null, p.id)}>
                <PlanFields plan={p} />
              </ActionForm>
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardHeader title="新增方案" />
          <CardBody>
            <ActionForm action={savePlanAction.bind(null, null)} submitLabel="新增" resetOnSuccess>
              <PlanFields />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
