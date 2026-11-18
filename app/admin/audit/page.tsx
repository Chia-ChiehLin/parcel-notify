import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AuditTable } from '@/components/audit-table';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: '稽核紀錄' };
export const dynamic = 'force-dynamic';

export default async function PlatformAuditPage() {
  const rows = await db()
    .select({ log: schema.auditLogs, communityName: schema.communities.name })
    .from(schema.auditLogs)
    .leftJoin(schema.communities, eq(schema.auditLogs.communityId, schema.communities.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(300);
  return (
    <>
      <PageHeader title="稽核紀錄" description="最近 300 筆，所有社區" />
      <Card>
        <AuditTable rows={rows} showCommunity />
      </Card>
    </>
  );
}
