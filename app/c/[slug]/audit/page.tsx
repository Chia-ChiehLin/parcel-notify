import Link from 'next/link';
import { and, desc, eq, like } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCommunity } from '@/auth/session';
import { AuditTable } from '@/components/audit-table';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: '稽核紀錄' };

const FILTERS = [
  ['', '全部'],
  ['parcel', '包裹'],
  ['resident', '住戶'],
  ['unit', '戶別'],
  ['staff', '人員'],
  ['community', '設定'],
];

export default async function AuditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ type?: string }> }) {
  const { slug } = await params;
  const { type } = await searchParams;
  const ctx = await requireCommunity(slug, 'community_admin');
  const conds = [eq(schema.auditLogs.communityId, ctx.community.id)];
  if (type && FILTERS.some(([v]) => v === type)) conds.push(like(schema.auditLogs.action, `${type}.%`));
  const rows = await db()
    .select({ log: schema.auditLogs })
    .from(schema.auditLogs)
    .where(and(...conds))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(300);
  return (
    <>
      <PageHeader title="稽核紀錄" description="誰在什麼時候做了什麼，發生包裹爭議時可以查這裡（最近 300 筆）" />
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-5 py-3 text-sm">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={v ? `?type=${v}` : '?'} className={`rounded-md px-3 py-1.5 ${(type ?? '') === v ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </Link>
          ))}
        </div>
        <AuditTable rows={rows} />
      </Card>
    </>
  );
}
