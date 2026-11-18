import { requirePlatformAdmin } from '@/auth/session';
import { asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { inviteOrgAdminAction, saveOrgAction } from '@/actions/platform';
import { ActionForm } from '@/components/action-form';
import { Card, CardBody, CardHeader, Field, Input, PageHeader } from '@/components/ui';

export const metadata = { title: '物業公司' };
export const dynamic = 'force-dynamic';

export default async function OrgsPage() {
  await requirePlatformAdmin();
  const orgs = await db()
    .select({
      org: schema.organizations,
      communities: sql<number>`(select count(*)::int from app.communities c where c.org_id = ${schema.organizations.id})`,
    })
    .from(schema.organizations)
    .orderBy(asc(schema.organizations.name));
  const admins = await db()
    .select({ orgId: schema.memberships.orgId, name: schema.users.name, email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(isNotNull(schema.memberships.orgId));

  return (
    <>
      <PageHeader title="物業公司" description="物業公司管理者可以管理旗下所有社區、跨社區查看報表。獨立社區也會有一筆同名的公司資料。" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {orgs.map(({ org, communities }) => (
            <Card key={org.id}>
              <CardHeader title={org.name} description={`${communities} 個社區`} />
              <CardBody className="grid gap-6 md:grid-cols-2">
                <ActionForm action={saveOrgAction.bind(null, org.id)}>
                  <Field label="公司名稱">
                    <Input name="name" defaultValue={org.name} required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="聯絡人">
                      <Input name="contactName" defaultValue={org.contactName ?? ''} />
                    </Field>
                    <Field label="電話">
                      <Input name="contactPhone" defaultValue={org.contactPhone ?? ''} />
                    </Field>
                  </div>
                  <Field label="Email">
                    <Input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ''} />
                  </Field>
                  <Field label="備註">
                    <Input name="note" defaultValue={org.note ?? ''} />
                  </Field>
                </ActionForm>
                <div>
                  <div className="mb-2 text-sm font-medium text-gray-700">公司管理者</div>
                  <ul className="mb-4 space-y-1 text-sm">
                    {admins.filter((a) => a.orgId === org.id).map((a) => (
                      <li key={a.email}>
                        {a.name} <span className="text-gray-500">{a.email}</span>
                      </li>
                    ))}
                    {!admins.some((a) => a.orgId === org.id) ? <li className="text-gray-500">尚未設定</li> : null}
                  </ul>
                  <ActionForm action={inviteOrgAdminAction.bind(null, org.id)} submitLabel="邀請公司管理者" resetOnSuccess>
                    <Field label="Email">
                      <Input name="email" type="email" required />
                    </Field>
                    <Field label="姓名（選填）">
                      <Input name="name" />
                    </Field>
                  </ActionForm>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader title="新增物業公司" />
          <CardBody>
            <ActionForm action={saveOrgAction.bind(null, null)} submitLabel="新增" resetOnSuccess>
              <Field label="公司名稱">
                <Input name="name" required />
              </Field>
              <Field label="聯絡人">
                <Input name="contactName" />
              </Field>
              <Field label="電話">
                <Input name="contactPhone" />
              </Field>
              <Field label="Email">
                <Input name="contactEmail" type="email" />
              </Field>
              <Field label="備註">
                <Input name="note" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
