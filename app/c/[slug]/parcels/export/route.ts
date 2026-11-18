import { requireCommunity } from '@/auth/session';
import type { ParcelStatus } from '@/db/schema';
import { listParcels, STATUS_LABELS } from '@/domain/parcels';
import { CATEGORY_LABELS } from '@/domain/settings';
import { toCsv } from '@/domain/units';
import { formatDateTime } from '@/lib/time';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug);
  const sp = new URL(req.url).searchParams;
  const status = (sp.get('status') ?? 'all') as ParcelStatus | 'overdue' | 'all';
  const from = sp.get('from') ? new Date(`${sp.get('from')}T00:00:00+08:00`) : undefined;
  const to = sp.get('to') ? new Date(`${sp.get('to')}T23:59:59+08:00`) : undefined;
  const all: Awaited<ReturnType<typeof listParcels>>['rows'] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await listParcels(ctx.community.id, { status, q: sp.get('q') ?? undefined, from, to, page, pageSize: 200 });
    all.push(...res.rows);
    if (res.rows.length < 200) break;
  }
  const csv = toCsv([
    ['門牌', '到件時間', '物流商', '單號', '類別', '件數', '存放位置', '取件碼', '狀態', '領取時間', '領取人', '領取方式', '收件人員', '交付人員', '備註'],
    ...all.map(({ parcel: p, unitLabel, receiverName, handlerName }) => [
      unitLabel,
      formatDateTime(p.receivedAt),
      p.carrier,
      p.trackingNo,
      p.categories.map((c) => CATEGORY_LABELS[c] ?? c).join('、'),
      p.quantity,
      p.storageLocation,
      p.pickupCode,
      STATUS_LABELS[p.status],
      p.pickedUpAt ? formatDateTime(p.pickedUpAt) : '',
      p.pickupName,
      p.pickupMethod ? { qr: 'QR', code: '取件碼', proxy: '代領', manual: '人工核對' }[p.pickupMethod] : '',
      receiverName,
      handlerName,
      p.note,
    ]),
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${ctx.community.name}-包裹紀錄.csv`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
