import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { residentFromToken } from '@/domain/resident-session';
import { getFile } from '@/storage';

export const dynamic = 'force-dynamic';

/** 住戶只能看到自己這戶的包裹照片 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; parcelId: string }> }) {
  const { token, parcelId } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(parcelId)) return new Response('not found', { status: 404 });
  const r = await residentFromToken(token);
  if (!r) return new Response('not found', { status: 404 });
  const [p] = await db()
    .select({ photoKey: schema.parcels.photoKey })
    .from(schema.parcels)
    .where(and(eq(schema.parcels.id, parcelId), eq(schema.parcels.communityId, r.community.id), eq(schema.parcels.unitId, r.unit.id),
      r.unit.occupancyStartedAt ? gte(schema.parcels.receivedAt, r.unit.occupancyStartedAt) : undefined));
  if (!p?.photoKey?.startsWith(`c/${r.community.id}/photo/`)) return new Response('not found', { status: 404 });
  const file = await getFile(p.photoKey);
  if (!file) return new Response('not found', { status: 404 });
  const body = Buffer.isBuffer(file.body) ? new Uint8Array(file.body) : file.body;
  return new Response(body, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
