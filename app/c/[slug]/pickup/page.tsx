import { requireCommunity } from '@/auth/session';
import { PickupClient } from './client';

export const metadata = { title: '交付取件' };

export default async function PickupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ unit?: string }> }) {
  const { slug } = await params;
  const { unit } = await searchParams;
  const ctx = await requireCommunity(slug);
  return <PickupClient slug={slug} requireSignature={ctx.settings.requireSignature} initialUnitId={unit && /^[0-9a-f-]{36}$/.test(unit) ? unit : null} />;
}
