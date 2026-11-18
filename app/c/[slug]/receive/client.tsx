'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyBatchAction, registerParcelAction, searchUnitsAction } from '@/actions/parcels';
import { CameraScanner, compressImage } from '@/components/scanner';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Textarea, buttonClass, cx } from '@/components/ui';

type Unit = { id: string; label: string; status?: string };
type BatchItem = { id: string; unitLabel: string; unitId: string; pickupCode: string; carrier: string | null; quantity: number; notified: boolean; notifyStatus?: string };

const CATEGORIES = [
  ['frozen', '冷凍'],
  ['cold', '冷藏'],
  ['large', '大型'],
  ['registered', '掛號'],
  ['document', '文件'],
  ['fragile', '易碎'],
] as const;

const NOTIFY_LABEL: Record<string, string> = { sent: '已通知', partial: '部分通知', failed: '通知失敗', no_recipient: '未綁定', skipped: '未發送' };

function Chip({ active, onClick, children, tone = 'brand' }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: 'brand' | 'blue' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'h-11 rounded-lg border px-3 text-sm font-medium transition-colors',
        active ? (tone === 'blue' ? 'border-blue-600 bg-blue-600 text-white' : 'border-brand-700 bg-brand-700 text-white') : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
      )}
    >
      {children}
    </button>
  );
}

export function ReceiveClient({
  slug,
  carriers,
  locations,
  photosEnabled,
  initialUnit,
}: {
  slug: string;
  carriers: string[];
  locations: string[];
  photosEnabled: boolean;
  initialUnit: Unit | null;
}) {
  const storeKey = `pn-batch-${slug}`;
  const prefKey = `pn-receive-pref-${slug}`;
  const [unit, setUnit] = useState<Unit | null>(initialUnit);
  const [query, setQuery] = useState('');
  const [rawResults, setResults] = useState<Unit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [carrier, setCarrier] = useState<string>('');
  const [categories, setCategories] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [trackingNo, setTrackingNo] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [notifyNow, setNotifyNow] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const unitInput = useRef<HTMLInputElement>(null);
  const results = unit || !query.trim() ? [] : rawResults;

  // 還原上次的批次清單與偏好（平板重新整理也不會遺失）。
  // localStorage 只在瀏覽器存在，必須在掛載後才讀，否則伺服器與瀏覽器的畫面會不一致。
  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect */
      const saved = localStorage.getItem(storeKey);
      if (saved) setBatch(JSON.parse(saved));
      const pref = JSON.parse(localStorage.getItem(prefKey) ?? '{}');
      if (pref.carrier) setCarrier(pref.carrier);
      if (pref.location) setLocation(pref.location);
      if (typeof pref.notifyNow === 'boolean') setNotifyNow(pref.notifyNow);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, [storeKey, prefKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(batch));
    } catch {}
  }, [batch, storeKey]);
  useEffect(() => {
    try {
      localStorage.setItem(prefKey, JSON.stringify({ carrier, location, notifyNow }));
    } catch {}
  }, [carrier, location, notifyNow, prefKey]);

  useEffect(() => {
    if (!query.trim() || unit) return;
    const t = setTimeout(async () => {
      const r = await searchUnitsAction(slug, query);
      setResults(r);
      setHighlight(0);
    }, 150);
    return () => clearTimeout(t);
  }, [query, slug, unit]);

  useEffect(() => {
    if (!unit) unitInput.current?.focus();
  }, [unit]);

  const pendingIds = batch.filter((b) => !b.notified).map((b) => b.id);
  const pendingUnits = new Set(batch.filter((b) => !b.notified).map((b) => b.unitId)).size;

  const submit = useCallback(async () => {
    if (!unit || busy) return;
    setBusy(true);
    setError(null);
    const res = await registerParcelAction(
      slug,
      { unitId: unit.id, carrier, trackingNo, categories, storageLocation: location, quantity, note, photo },
      notifyNow,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBatch((b) => [
      {
        id: res.parcel.id,
        unitId: unit.id,
        unitLabel: res.parcel.unitLabel,
        pickupCode: res.parcel.pickupCode,
        carrier: res.parcel.carrier,
        quantity: res.parcel.quantity,
        notified: !!res.notify,
        notifyStatus: res.notify?.status,
      },
      ...b,
    ]);
    setFlash(`✓ ${res.parcel.unitLabel} 已登記，取件碼 ${res.parcel.pickupCode}${res.notify ? `（${NOTIFY_LABEL[res.notify.status] ?? res.notify.status}）` : ''}`);
    setTimeout(() => setFlash(null), 3500);
    // 保留物流商與存放位置，方便同一家物流連續登記
    setUnit(null);
    setQuery('');
    setTrackingNo('');
    setNote('');
    setPhoto(null);
    setQuantity(1);
    setCategories([]);
  }, [unit, busy, slug, carrier, trackingNo, categories, location, quantity, note, photo, notifyNow]);

  const finishBatch = async () => {
    if (!pendingIds.length) return;
    setBusy(true);
    const res = await notifyBatchAction(slug, pendingIds);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const byUnit = new Map(res.summaries.map((s) => [s.unitId, s.status]));
    setBatch((b) => b.map((x) => (x.notified ? x : { ...x, notified: true, notifyStatus: byUnit.get(x.unitId) ?? 'skipped' })));
    setFlash(`✓ 已通知 ${res.summaries.length} 戶`);
    setTimeout(() => setFlash(null), 3500);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">收件登記</h1>
          <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <input type="checkbox" checked={notifyNow} onChange={(e) => setNotifyNow(e.target.checked)} className="h-5 w-5" />
            每件登記後立即通知
          </label>
        </div>
        {flash ? <Alert tone="success" className="mb-4 text-base">{flash}</Alert> : null}
        {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}

        <Card>
          <CardBody className="space-y-5">
            {/* 戶號 */}
            <div>
              <div className="mb-1.5 text-sm font-semibold text-gray-700">1. 戶號</div>
              {unit ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-14 items-center rounded-xl bg-brand-50 px-5 text-2xl font-bold text-brand-800 ring-2 ring-brand-600">{unit.label}</div>
                  <Button variant="ghost" onClick={() => setUnit(null)}>
                    更換
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    ref={unitInput}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, results.length - 1));
                      if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
                      if (e.key === 'Enter' && results[highlight]) {
                        e.preventDefault();
                        setUnit(results[highlight]);
                      }
                    }}
                    placeholder="輸入戶號，例如 A141 或 14-1"
                    className="h-14 text-xl"
                    autoComplete="off"
                    inputMode="text"
                  />
                  {results.length ? (
                    <div className="absolute z-20 mt-1 grid w-full grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg sm:grid-cols-3">
                      {results.map((r, i) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setUnit(r)}
                          className={cx('h-12 rounded-lg text-left text-lg font-semibold', i === highlight ? 'bg-brand-700 px-3 text-white' : 'px-3 hover:bg-gray-100')}
                        >
                          {r.label}
                          {r.status === 'vacant' ? <span className="ml-1 text-xs font-normal opacity-70">空戶</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : query.trim() ? (
                    <p className="mt-2 text-sm text-gray-500">找不到符合的戶號</p>
                  ) : null}
                </div>
              )}
            </div>

            {/* 物流商 */}
            <div>
              <div className="mb-1.5 text-sm font-semibold text-gray-700">2. 物流商</div>
              <div className="flex flex-wrap gap-2">
                {carriers.map((c) => (
                  <Chip key={c} active={carrier === c} onClick={() => setCarrier(carrier === c ? '' : c)}>
                    {c}
                  </Chip>
                ))}
              </div>
            </div>

            {/* 類別、位置、件數 */}
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">類別（可複選）</div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(([v, label]) => (
                    <Chip key={v} tone="blue" active={categories.includes(v)} onClick={() => setCategories((cs) => (cs.includes(v) ? cs.filter((x) => x !== v) : [...cs, v]))}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">存放位置</div>
                <div className="flex flex-wrap gap-2">
                  {locations.map((l) => (
                    <Chip key={l} active={location === l} onClick={() => setLocation(location === l ? '' : l)}>
                      {l}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">件數</div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="lg" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="減少">
                    −
                  </Button>
                  <span className="w-10 text-center text-2xl font-bold tabular">{quantity}</span>
                  <Button variant="secondary" size="lg" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="增加">
                    ＋
                  </Button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">物流單號（選填，可用掃描槍或相機）</div>
                <div className="flex gap-2">
                  <Input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="掃描或輸入單號" className="h-12 text-base" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                  <Button variant="secondary" size="lg" onClick={() => setScanning(true)}>
                    📷 掃描
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">備註（選填）</div>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="例如：外箱破損、需冷藏盡快領取" />
              </div>
              {photosEnabled ? (
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-gray-700">照片（選填）</div>
                  <div className="flex items-center gap-3">
                    <label className={buttonClass('secondary', 'lg', 'cursor-pointer')}>
                      📸 拍照
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) setPhoto(await compressImage(f));
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {photo ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt="包裹照片" className="h-16 w-16 rounded-lg object-cover ring-1 ring-gray-200" />
                        <button type="button" onClick={() => setPhoto(null)} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-gray-800 text-xs text-white">
                          ✕
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <Button size="xl" className="w-full" disabled={!unit || busy} onClick={submit}>
              {busy ? '登記中…' : unit ? `登記 ${unit.label}${quantity > 1 ? `（${quantity} 件）` : ''}` : '請先選擇戶號'}
            </Button>
          </CardBody>
        </Card>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader
            title="本次登記"
            description={pendingIds.length ? `${pendingIds.length} 件尚未通知（${pendingUnits} 戶）` : '全部已通知'}
            actions={
              batch.length ? (
                <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setBatch((b) => b.filter((x) => !x.notified))}>
                  清除已通知
                </button>
              ) : null
            }
          />
          <div className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto">
            {batch.length === 0 ? <p className="px-5 py-8 text-center text-sm text-gray-500">登記的包裹會出現在這裡</p> : null}
            {batch.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-semibold">
                    {b.unitLabel}
                    {b.quantity > 1 ? <span className="ml-1 text-sm text-gray-500">×{b.quantity}</span> : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {b.carrier ?? '未填物流'}・取件碼 <span className="font-mono">{b.pickupCode}</span>
                  </div>
                </div>
                {b.notified ? (
                  <Badge tone={b.notifyStatus === 'sent' ? 'green' : b.notifyStatus === 'failed' ? 'red' : 'gray'}>{NOTIFY_LABEL[b.notifyStatus ?? ''] ?? '已處理'}</Badge>
                ) : (
                  <Badge tone="yellow">待通知</Badge>
                )}
              </div>
            ))}
          </div>
          <CardBody className="space-y-2 border-t border-gray-100">
            <Button size="lg" className="w-full" disabled={!pendingIds.length || busy} onClick={finishBatch}>
              完成並發送通知{pendingUnits ? `（${pendingUnits} 戶）` : ''}
            </Button>
            {batch.length ? (
              <Link className={buttonClass('secondary', 'md', 'w-full')} href={`/c/${slug}/print/slips?ids=${batch.slice(0, 60).map((b) => b.id).join(',')}`} target="_blank">
                🖨️ 列印取件通知單
              </Link>
            ) : null}
            <p className="text-xs text-gray-500">同一戶的多件包裹會合併成一則 LINE 通知，節省訊息費。</p>
          </CardBody>
        </Card>
      </div>

      {scanning ? (
        <CameraScanner
          title="掃描物流單號"
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setTrackingNo(text);
            setScanning(false);
          }}
        />
      ) : null}
    </div>
  );
}
