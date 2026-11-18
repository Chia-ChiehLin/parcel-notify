import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getEffectiveRole } from '@/auth/access';
import { getCurrentUser } from '@/auth/session';
import { getFile } from '@/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 包裹照片與簽名：只有該社區的人員可以看（檔案路徑格式 c/<社區ID>/...） */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const path = key.join('/');
  const m = path.match(/^c\/([0-9a-f-]{36})\/(photo|signature)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/);
  if (!m) return new Response('not found', { status: 404 });
  const user = await getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  const [community] = await db().select({ id: schema.communities.id, orgId: schema.communities.orgId }).from(schema.communities).where(eq(schema.communities.id, m[1]));
  if (!community || !(await getEffectiveRole(user, community))) return new Response('not found', { status: 404 });
  const file = await getFile(path);
  if (!file) return new Response('not found', { status: 404 });
  const body = Buffer.isBuffer(file.body) ? new Uint8Array(file.body) : file.body;
  return new Response(body, {
    headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
}
