import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCommunity } from '@/auth/session';
import { lineBindUrl, resolveCommunityChannel } from '@/domain/line-channels';
import { CATEGORY_LABELS } from '@/domain/settings';
import { PrintButton } from '@/components/print-button';
import { formatDateTime } from '@/lib/time';
import { qrSvg } from '@/lib/qr';

export const metadata = { title: '列印取件通知單' };

/**
 * 取件通知單：投入信箱用，A4 一頁 4 張，每戶一張。
 * ?ids=... 指定包裹；?unbound=1 列出所有「沒有綁定住戶」的待領包裹。
 */
export default async function PrintSlips({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ids?: string; unbound?: string }> }) {
  const { slug } = await params;
  const { ids, unbound } = await searchParams;
  const ctx = await requireCommunity(slug);
  const idList = (ids ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  const conds = [eq(schema.parcels.communityId, ctx.community.id), eq(schema.parcels.status, 'waiting')];
  if (idList.length) conds.push(inArray(schema.parcels.id, idList));
  else if (unbound) conds.push(sql`not exists (select 1 from app.residents r where r.unit_id = ${schema.parcels.unitId} and r.status = 'active')`);
  else conds.push(sql`false`);
  const rows = await db()
    .select({ parcel: schema.parcels, unit: schema.units })
    .from(schema.parcels)
    .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
    .where(and(...conds))
    .orderBy(asc(schema.units.sortKey), asc(schema.parcels.receivedAt));
  const resolved = await resolveCommunityChannel(ctx.community);
  const groups = new Map<string, { unit: typeof schema.units.$inferSelect; parcels: (typeof schema.parcels.$inferSelect)[] }>();
  for (const r of rows) {
    const g = groups.get(r.unit.id) ?? { unit: r.unit, parcels: [] };
    g.parcels.push(r.parcel);
    groups.set(r.unit.id, g);
  }
  const slips = await Promise.all(
    [...groups.values()].map(async (g) => ({
      ...g,
      qr: resolved?.channel.basicId ? await qrSvg(lineBindUrl(resolved.channel.basicId, g.unit.bindCode), { margin: 0 }) : null,
    })),
  );
  // 每張通知單留八列，避免同戶大量到件時取件碼被截掉。
  const sheets = slips.flatMap((slip) => {
    const parts = Math.ceil(slip.parcels.length / 8);
    return Array.from({ length: parts }, (_, i) => ({
      ...slip, parcels: slip.parcels.slice(i * 8, (i + 1) * 8), part: i + 1, parts,
    }));
  });
  const pages: (typeof sheets)[] = [];
  for (let i = 0; i < sheets.length; i += 4) pages.push(sheets.slice(i, i + 4));
  const s = ctx.settings;

  return (
    <div className="-mx-4 -my-6 bg-gray-100 px-4 py-6 print:m-0 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-6 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">取件通知單</h1>
          <p className="text-sm text-gray-500">{slips.length} 戶、{rows.reduce((n, r) => n + r.parcel.quantity, 0)} 件待領包裹。A4 每頁 4 張，剪下投入信箱。</p>
        </div>
        <PrintButton />
      </div>
      {slips.length === 0 ? <p className="no-print text-center text-gray-500">沒有需要列印的包裹（已領取的包裹不會列出）</p> : null}
      {pages.map((page, i) => (
        <div key={i} className="print-page mx-auto mb-6 grid h-[277mm] max-w-[210mm] grid-cols-2 grid-rows-2 bg-white shadow print:mb-0 print:shadow-none">
          {page.map(({ unit, parcels, qr, part, parts }) => (
            <div key={`${unit.id}-${part}`} className="flex flex-col border border-dashed border-gray-300 p-5">
              <div className="text-xs text-gray-500">{ctx.community.name}・取件通知{parts > 1 ? `（${part}/${parts}）` : ''}</div>
              <div className="mt-1 text-3xl font-bold">{unit.label}</div>
              <div className="mt-1 text-sm">
                您有 <b>{parcels.reduce((n, p) => n + p.quantity, 0)}</b> 件包裹在管理室，請攜帶此單領取。
              </div>
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {parcels.map((p) => (
                    <tr key={p.id} className="border-t border-gray-200">
                      <td className="py-1 font-mono text-sm font-bold">{p.pickupCode}</td>
                      <td className="py-1">{p.carrier ?? ''}</td>
                      <td className="py-1">{[p.storageLocation, ...p.categories.map((c) => CATEGORY_LABELS[c])].filter(Boolean).join('・')}</td>
                      <td className="py-1 text-right text-gray-500">{formatDateTime(p.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-auto flex items-end gap-3 pt-3">
                {qr ? <div className="w-20 shrink-0" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
                <div className="text-[10px] leading-snug text-gray-600">
                  {qr ? '用 LINE 掃描左側 QR code 綁定，以後包裹到了會直接通知您，不用再等通知單。' : ''}
                  {s.deskPhone || s.deskHours ? <div className="mt-1">管理室 {[s.deskPhone, s.deskHours].filter(Boolean).join('・')}</div> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
