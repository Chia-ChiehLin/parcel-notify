import Link from 'next/link';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { listProxyCodes } from '@/domain/pickup';
import { waitingForUnit } from '@/domain/parcels';
import { residentFromToken } from '@/domain/resident-session';
import { parseSettings } from '@/domain/settings';
import { pickupQrPayload } from '@/domain/tokens';
import { dict, fill } from '@/i18n/resident';
import { formatDateTime } from '@/lib/time';
import { qrSvg } from '@/lib/qr';
import { AutoRefresh } from './refresh';
import { ProxyForm } from './proxy-form';

export const dynamic = 'force-dynamic';

export default async function ResidentHome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await residentFromToken(token);
  if (!r) return <Invalid />;
  const d = dict(r.resident.language);
  const settings = parseSettings(r.community.settings);
  const [waiting, history, proxies] = await Promise.all([
    waitingForUnit(r.community.id, r.unit.id, r.unit.occupancyStartedAt),
    db()
      .select()
      .from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, r.community.id), eq(schema.parcels.unitId, r.unit.id), eq(schema.parcels.status, 'picked_up'),
        r.unit.occupancyStartedAt ? gte(schema.parcels.receivedAt, r.unit.occupancyStartedAt) : undefined))
      .orderBy(desc(schema.parcels.pickedUpAt))
      .limit(10),
    listProxyCodes(r.resident.id),
  ]);
  const qr = waiting.length ? await qrSvg(pickupQrPayload(r.resident.id), { margin: 1 }) : null;
  const total = waiting.reduce((s, p) => s + p.quantity, 0);
  const base = `/r/${token}`;

  return (
    <main lang={r.resident.language === 'en' ? 'en' : 'zh-Hant'}>
      <AutoRefresh seconds={9 * 60} />
      <header className="bg-brand-700 px-5 pb-6 pt-8 text-white">
        <div className="text-sm opacity-80">{r.community.name}</div>
        <div className="mt-1 flex items-end justify-between">
          <h1 className="text-3xl font-bold">{r.unit.label}</h1>
          <Link href={`${base}/settings`} className="rounded-full bg-white/15 px-3 py-1 text-sm">
            ⚙️ {d.settings}
          </Link>
        </div>
      </header>

      <section className="-mt-3 px-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{d.waiting}</h2>
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-sm font-semibold text-amber-800">{fill(d.pieces, { n: total })}</span>
          </div>
          {waiting.length === 0 ? (
            <p className="py-6 text-center text-gray-500">{d.noParcels}</p>
          ) : (
            <>
              <div role="img" aria-label={d.viewPickupQr} className="mx-auto mt-4 w-60 max-w-full" dangerouslySetInnerHTML={{ __html: qr! }} />
              <p className="mt-2 text-center text-sm text-gray-600">{d.showQrHint}</p>
              <p className="text-center text-xs text-gray-400">{d.qrRefresh}</p>
              <ul className="mt-4 divide-y divide-gray-100">
                {waiting.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    {p.photoKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${base}/photo/${p.id}`} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-xl">📦</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {d.pickupCode} <span className="font-mono">{p.pickupCode}</span>
                        {p.categories.map((c) => (
                          <span key={c} className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                            {d.types[c] ?? c}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500">
                        {[p.carrier, p.storageLocation, p.quantity > 1 ? fill(d.pieces, { n: p.quantity }) : null].filter(Boolean).join(' ・ ')}
                      </div>
                      <div className="text-xs text-gray-400">
                        {d.receivedAt} {formatDateTime(p.receivedAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {settings.deskPhone || settings.deskHours ? (
            <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
              {d.deskInfo} {[settings.deskPhone, settings.deskHours].filter(Boolean).join(' ・ ')}
            </p>
          ) : null}
        </div>
      </section>

      {waiting.length ? (
        <section className="mt-4 px-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">{d.proxy}</h2>
            <p className="mt-1 text-sm text-gray-500">{d.proxyHint}</p>
            {proxies.length ? (
              <ul className="mt-3 space-y-2">
                {proxies.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <span className="font-mono text-lg font-bold tracking-widest">{p.code}</span>
                    <span className="text-xs text-gray-500">
                      {p.proxyName ? `${p.proxyName}・` : ''}
                      {d.proxyExpires} {formatDateTime(p.expiresAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ProxyForm token={token} labels={{ name: d.proxyName, create: d.proxyCreate, code: d.proxyCode, expires: d.proxyExpires }} />
          </div>
        </section>
      ) : null}

      <section className="mt-4 px-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">{d.history}</h2>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">{d.noHistory}</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {history.map((p) => (
                <li key={p.id} className="flex justify-between py-2.5">
                  <span>{p.carrier ?? '📦'}</span>
                  <span className="text-gray-500">
                    {formatDateTime(p.pickedUpAt)}
                    {p.pickupName ? `・${p.pickupName}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function Invalid() {
  const d = dict('zh-TW');
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <div className="text-4xl">🔒</div>
        <p className="mt-4 text-gray-700">{d.linkInvalid}</p>
        <p className="mt-2 text-sm text-gray-500">{dict('en').linkInvalid}</p>
      </div>
    </div>
  );
}
