import Link from 'next/link';
import { inArray, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db, schema } from '@/db';
import { listOrgAdminOrgIds } from '@/auth/access';
import { requireUser } from '@/auth/session';
import { logoutAction } from '@/actions/auth';
import { CommunityStatusBadge } from '@/components/status';
import { Card, PageHeader, Table, Td, Th } from '@/components/ui';
import { Logo } from '@/components/logo';
import { addDays } from '@/lib/time';

export const metadata = { title: '物業公司總覽' };
export const dynamic = 'force-dynamic';

/** 物業公司管理者：旗下所有社區的狀況一覽 */
export default async function OrgOverview() {
  const user = await requireUser();
  const orgIds = await listOrgAdminOrgIds(user.id);
  if (!orgIds.length) notFound();
  const orgs = await db().select().from(schema.organizations).where(inArray(schema.organizations.id, orgIds));
  const since = addDays(new Date(), -30);
  const rows = await db()
    .select({
      c: schema.communities,
      units: sql<number>`(select count(*)::int from app.units u where u.community_id = ${schema.communities.id})`,
      residents: sql<number>`(select count(*)::int from app.residents r where r.community_id = ${schema.communities.id} and r.status = 'active')`,
      waiting: sql<number>`(select coalesce(sum(quantity),0)::int from app.parcels p where p.community_id = ${schema.communities.id} and p.status = 'waiting')`,
      parcels30: sql<number>`(select coalesce(sum(quantity),0)::int from app.parcels p where p.community_id = ${schema.communities.id} and p.received_at > ${since})`,
      avgHours: sql<number | null>`(select round(avg(extract(epoch from (picked_up_at - received_at))/3600)::numeric,1)::float from app.parcels p where p.community_id = ${schema.communities.id} and p.status = 'picked_up' and p.picked_up_at > ${since})`,
    })
    .from(schema.communities)
    .where(inArray(schema.communities.orgId, orgIds))
    .orderBy(schema.communities.name);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="font-bold">{orgs.map((o) => o.name).join('、')}</span>
        </div>
        <form action={logoutAction}>
          <button className="text-sm text-gray-500 hover:text-gray-800">登出</button>
        </form>
      </div>
      <PageHeader title="旗下社區" description={`${rows.length} 個社區・近 30 天共 ${rows.reduce((s, r) => s + r.parcels30, 0)} 件包裹`} />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>社區</Th>
              <Th>狀態</Th>
              <Th className="text-right">戶數</Th>
              <Th className="text-right">住戶</Th>
              <Th className="text-right">待領取</Th>
              <Th className="text-right">近 30 天包裹</Th>
              <Th className="text-right">平均領取（小時）</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ c, units, residents, waiting, parcels30, avgHours }) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`/c/${c.slug}`} className="font-semibold hover:text-brand-700">
                    {c.name}
                  </Link>
                </Td>
                <Td>
                  <CommunityStatusBadge status={c.status} />
                </Td>
                <Td className="text-right tabular">{units}</Td>
                <Td className="text-right tabular">{residents}</Td>
                <Td className="text-right tabular">{waiting}</Td>
                <Td className="text-right tabular">{parcels30}</Td>
                <Td className="text-right tabular">{avgHours ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
