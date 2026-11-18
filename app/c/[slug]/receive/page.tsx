import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCommunity } from '@/auth/session';
import { getCommunityWithPlan } from '@/domain/communities';
import { Alert, PageHeader } from '@/components/ui';
import { ReceiveClient } from './client';

export const metadata = { title: '收件登記' };

export default async function ReceivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ unit?: string }> }) {
  const { slug } = await params;
  const { unit: unitId } = await searchParams;
  const ctx = await requireCommunity(slug);
  const { plan } = await getCommunityWithPlan(ctx.community.id);
  let initialUnit: { id: string; label: string } | null = null;
  if (unitId && /^[0-9a-f-]{36}$/.test(unitId)) {
    const [u] = await db()
      .select({ id: schema.units.id, label: schema.units.label })
      .from(schema.units)
      .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, ctx.community.id)));
    initialUnit = u ?? null;
  }
  if (ctx.readOnly) {
    return (
      <>
        <PageHeader title="收件登記" />
        <Alert tone="error" title="社區服務已停用">目前無法登記新包裹，請聯絡服務商續約。已登記的包裹仍可以正常交付。</Alert>
      </>
    );
  }
  return (
    <ReceiveClient
      slug={slug}
      carriers={ctx.settings.carriers}
      locations={ctx.settings.storageLocations}
      photosEnabled={plan.features.photos}
      initialUnit={initialUnit}
    />
  );
}
