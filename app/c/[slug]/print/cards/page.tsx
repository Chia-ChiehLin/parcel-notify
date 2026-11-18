import { requireCommunity } from '@/auth/session';
import { lineAddFriendUrl, lineBindUrl, resolveCommunityChannel } from '@/domain/line-channels';
import { listBuildings, listUnits } from '@/domain/units';
import { Alert, LinkButton } from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { brandName } from '@/lib/env';
import { qrSvg } from '@/lib/qr';

export const metadata = { title: '列印綁定卡' };

/** A4 一頁 8 張綁定卡，住戶掃 QR 就會開啟官方帳號並帶入綁定碼 */
export default async function PrintCards({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ building?: string; unbound?: string }> }) {
  const { slug } = await params;
  const { building, unbound } = await searchParams;
  const ctx = await requireCommunity(slug, 'community_admin');
  const [rows, buildings, resolved] = await Promise.all([
    listUnits(ctx.community.id, { buildingId: building || undefined, status: 'active' }),
    listBuildings(ctx.community.id),
    resolveCommunityChannel(ctx.community),
  ]);
  const list = unbound ? rows.filter((r) => r.residentCount === 0) : rows;
  const basicId = resolved?.channel.basicId;
  const cards = await Promise.all(
    list.map(async ({ unit }) => ({
      unit,
      qr: basicId ? await qrSvg(lineBindUrl(basicId, unit.bindCode), { margin: 0 }) : null,
    })),
  );
  const pages: (typeof cards)[] = [];
  for (let i = 0; i < cards.length; i += 8) pages.push(cards.slice(i, i + 8));

  return (
    <div className="-mx-4 -my-6 bg-gray-100 px-4 py-6 print:m-0 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-6 max-w-[210mm] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">列印綁定卡</h1>
            <p className="text-sm text-gray-500">共 {cards.length} 張，A4 每頁 8 張。剪下後投入各戶信箱即可。</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/c/${slug}/units`}>返回</LinkButton>
            <PrintButton />
          </div>
        </div>
        <form className="flex flex-wrap items-center gap-3 text-sm">
          <select name="building" defaultValue={building ?? ''} className="h-9 rounded-md border border-gray-300 bg-white px-2">
            <option value="">全部棟別</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} 棟
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="unbound" value="1" defaultChecked={!!unbound} /> 只印尚未綁定的戶別
          </label>
          <button className="h-9 rounded-md bg-gray-800 px-3 font-medium text-white">套用</button>
        </form>
        {!basicId ? <Alert tone="warning">LINE 官方帳號尚未設定，綁定卡上不會有 QR code，住戶需要手動加入官方帳號並輸入綁定碼。</Alert> : null}
      </div>
      {pages.map((page, i) => (
        <div key={i} className="print-page mx-auto mb-6 grid h-[277mm] max-w-[210mm] grid-cols-2 grid-rows-4 gap-0 bg-white shadow print:mb-0 print:shadow-none">
          {page.map(({ unit, qr }) => (
            <div key={unit.id} className="flex items-center gap-4 border border-dashed border-gray-300 p-4">
              <div className="w-28 shrink-0">{qr ? <div dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="flex h-28 items-center justify-center bg-gray-100 text-xs text-gray-400">無 QR</div>}</div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500">{ctx.community.name}</div>
                <div className="text-2xl font-bold text-gray-900">{unit.label}</div>
                <div className="mt-1 text-xs text-gray-500">綁定碼</div>
                <div className="font-mono text-xl font-bold tracking-[0.15em]">{unit.bindCode}</div>
                <div className="mt-2 text-[10px] leading-snug text-gray-600">
                  {qr ? '用 LINE 掃描 QR code，按「傳送」即可綁定。' : '請向管理室索取社區的 LINE 官方帳號，加入後傳送上方綁定碼。'}
                  {basicId ? <span className="block">官方帳號：{basicId}</span> : null}
                </div>
                <div className="mt-1 text-[9px] text-gray-400">{brandName()}・請勿將綁定碼提供給他人</div>
              </div>
            </div>
          ))}
        </div>
      ))}
      {basicId ? <p className="no-print text-center text-xs text-gray-500">加好友連結：{lineAddFriendUrl(basicId)}</p> : null}
    </div>
  );
}
