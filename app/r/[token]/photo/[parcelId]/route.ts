import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { residentFromToken } from '@/domain/resident-session';
import { getFile } from '@/storage';

export const dynamic = 'force-dynamic';

/** 住戶只能看到自己這戶的包裹照片 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; parcelId: string }> }) {
  const { token, parcelId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(parcelId)) return new Response('not found', { status: 404 });
  const r = await residentFromToken(token);
  if (!r) return new Response('not found', { status: 404 });
  const [p] = await db()
    .select({ photoKey: schema.parcels.photoKey })
    .from(schema.parcels)
    .where(and(eq(schema.parcels.id, parcelId), eq(schema.parcels.unitId, r.unit.id)));
  if (!p?.photoKey) return new Response('not found', { status: 404 });
  const file = await getFile(p.photoKey);
  if (!file) return new Response('not found', { status: 404 });
  const body = Buffer.isBuffer(file.body) ? new Uint8Array(file.body) : file.body;
  return new Response(body, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, max-age=3600' } });
}
