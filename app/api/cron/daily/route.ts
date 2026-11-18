import { safeEqual } from '@/lib/crypto';
import { runDaily } from '@/domain/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Vercel Cron 每天呼叫：到期停用、逾期提醒、清除過期資料 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const started = Date.now();
  const result = await runDaily();
  console.log('[cron] daily done', JSON.stringify(result));
  return Response.json({ ok: true, ms: Date.now() - started, ...result });
}
