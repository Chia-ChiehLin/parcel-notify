import { audit } from '@/domain/audit';
import { requireCommunity } from '@/auth/session';
import { exportUnitsCsv } from '@/domain/units';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const includeCodes = new URL(req.url).searchParams.get('codes') === '1';
  const csv = await exportUnitsCsv(ctx.community.id, includeCodes);
  await audit(ctx.actor, 'unit.export', { communityId: ctx.community.id, data: { includeCodes } });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${ctx.community.name}-戶別.csv`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
