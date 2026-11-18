import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import { exportUnitsCsv } from '@/domain/units';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug);
  const includeCodes = new URL(req.url).searchParams.get('codes') === '1' && hasRole(ctx.role, 'community_admin');
  const csv = await exportUnitsCsv(ctx.community.id, includeCodes);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${ctx.community.name}-戶別.csv`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
