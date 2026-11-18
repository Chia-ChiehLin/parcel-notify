import { audit } from '@/domain/audit';
import { isCalendarDate } from '@/lib/time';
import { requireCommunity } from '@/auth/session';
import type { ParcelStatus } from '@/db/schema';
import { listParcels, MAX_PARCEL_EXPORT_ROWS, STATUS_LABELS } from '@/domain/parcels';
import { CATEGORY_LABELS } from '@/domain/settings';
import { toCsv } from '@/domain/units';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const sp = new URL(req.url).searchParams;
  const status = (sp.get('status') ?? 'all') as ParcelStatus | 'overdue' | 'all';
  if (status !== 'overdue' && status !== 'all' && !Object.hasOwn(STATUS_LABELS, status)) {
    return new Response('請回上一頁選擇有效的包裹狀態。', { status: 400 });
  }
  const fromDate = sp.get('from');
  const toDate = sp.get('to');
  const from = fromDate && isCalendarDate(fromDate) ? new Date(`${fromDate}T00:00:00+08:00`) : undefined;
  const to = toDate && isCalendarDate(toDate) ? new Date(`${toDate}T23:59:59.999+08:00`) : undefined;
  if ((fromDate && !from) || (toDate && !to) || (from && to && from > to)) {
    return new Response('請回上一頁確認起訖日期後再匯出。', { status: 400 });
  }
  const { rows } = await listParcels(ctx.community.id, { status, q: sp.get('q') ?? undefined, from, to }, 'export');
  if (rows.length > MAX_PARCEL_EXPORT_ROWS) {
    return new Response('本次查詢超過一萬筆。請回到包裹紀錄縮短日期範圍，再分段匯出。', { status: 422 });
  }
  const csv = toCsv([
    ['門牌', '到件時間', '物流商', '單號', '類別', '件數', '存放位置', '取件碼', '狀態', '領取時間', '領取人', '領取方式', '收件人員', '交付人員', '備註'],
    ...rows.map(({ parcel: p, unitLabel, receiverName, handlerName }) => [
      unitLabel,
      p.receivedAt.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }),
      p.carrier,
      p.trackingNo,
      p.categories.map((c) => CATEGORY_LABELS[c] ?? c).join('、'),
      p.quantity,
      p.storageLocation,
      p.pickupCode,
      STATUS_LABELS[p.status],
      p.pickedUpAt ? p.pickedUpAt.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }) : '',
      p.pickupName,
      p.pickupMethod ? { qr: 'QR', code: '取件碼', proxy: '代領', manual: '人工核對' }[p.pickupMethod] : '',
      receiverName,
      handlerName,
      p.note,
    ]),
  ]);
  await audit(ctx.actor, 'parcel.export', { communityId: ctx.community.id, data: { rows: rows.length } });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${ctx.community.name}-包裹紀錄.csv`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
