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

const NOTIFY_LABEL: Record<string, string> = { sent: '已通知', partial: '部分通知', failed: '通知失敗', no_recipient: '無可用收件人', skipped: '未發送', sending: '傳送中', pending: '待通知' };

function Chip({ active, onClick, children, tone = 'brand' }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: 'brand' | 'blue' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
  staffId,
}: {
  slug: string;
  carriers: string[];
  locations: string[];
  photosEnabled: boolean;
  initialUnit: Unit | null;
  staffId: string;
}) {
  const storeKey = `pn-batch-${slug}-${staffId}`;
  const prefKey = `pn-receive-pref-${slug}`;
  const [unit, setUnit] = useState<Unit | null>(initialUnit);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ query: string; units: Unit[]; failed?: boolean } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
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
  const lastAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const unitInput = useRef<HTMLInputElement>(null);
  const currentSearch = !unit && query.trim() && searchResult?.query === query ? searchResult : null;
  const results = currentSearch?.units ?? [];

  // 還原上次的批次清單與偏好（平板重新整理也不會遺失）。
  // localStorage 只在瀏覽器存在，必須在掛載後才讀，否則伺服器與瀏覽器的畫面會不一致。
  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect */
      // 舊版平板共用同一份取件碼快取；尚未通知的登記仍可在總覽找到。
      localStorage.removeItem(`pn-batch-${slug}`);
      const saved = JSON.parse(sessionStorage.getItem(storeKey) ?? '[]');
      if (Array.isArray(saved)) setBatch(saved);
      const pref = JSON.parse(localStorage.getItem(prefKey) ?? '{}');
      if (pref.carrier) setCarrier(pref.carrier);
      if (pref.location) setLocation(pref.location);
      if (typeof pref.notifyNow === 'boolean') setNotifyNow(pref.notifyNow);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    setHydrated(true);
  }, [storeKey, prefKey, slug]);
  useEffect(() => {
    try {
      if (hydrated) sessionStorage.setItem(storeKey, JSON.stringify(batch));
    } catch {}
  }, [batch, hydrated, storeKey]);
  useEffect(() => {
    try {
      if (hydrated) localStorage.setItem(prefKey, JSON.stringify({ carrier, location, notifyNow }));
    } catch {}
  }, [carrier, hydrated, location, notifyNow, prefKey]);

  useEffect(() => {
    if (!query.trim() || unit) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const units = await searchUnitsAction(slug, query);
        if (!cancelled) { setSearchResult({ query, units }); setHighlight(0); }
      } catch {
        if (!cancelled) setSearchResult({ query, units: [], failed: true });
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, slug, unit]);

  useEffect(() => {
    if (!unit) unitInput.current?.focus();
  }, [unit]);

  const pendingIds = batch.filter((b) => !b.notified).map((b) => b.id);
  const pendingUnits = new Set(batch.filter((b) => !b.notified).map((b) => b.unitId)).size;

  const submit = useCallback(async () => {
    if (!unit || busy || preparingPhoto) return;
    setBusy(true);
    setError(null);
    let res;
    try {
      const item = { unitId: unit.id, carrier, trackingNo, categories, storageLocation: location, quantity, note, photo };
      const fingerprint = JSON.stringify([item, notifyNow]);
      if (lastAttempt.current?.fingerprint !== fingerprint) {
        lastAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
      }
      res = await registerParcelAction(slug, { ...item, requestId: lastAttempt.current.requestId }, notifyNow);
    } catch {
      setError('無法確認登記結果，請先查看包裹紀錄，以免重複登記。');
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    lastAttempt.current = null;
    setBatch((b) => [
      {
        id: res.parcel.id,
        unitId: unit.id,
        unitLabel: res.parcel.unitLabel,
        pickupCode: res.parcel.pickupCode,
        carrier: res.parcel.carrier,
        quantity: res.parcel.quantity,
        notified: !!res.notify && res.notify.status !== 'sending' && res.notify.status !== 'pending',
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
  }, [unit, busy, preparingPhoto, slug, carrier, trackingNo, categories, location, quantity, note, photo, notifyNow]);

  const finishBatch = async () => {
    if (!pendingIds.length || busy) return;
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await notifyBatchAction(slug, pendingIds.slice(0, 500));
    } catch {
      setError('無法確認通知結果，請先到包裹紀錄查看通知狀態。');
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const statuses = new Map(res.statuses.map((p) => [p.id, p.status]));
    const requested = new Set(pendingIds.slice(0, 500));
    setBatch((items) => items.map((item) => {
      if (!requested.has(item.id)) return item;
      const status = statuses.get(item.id) ?? 'skipped';
      return { ...item, notified: status !== 'pending' && status !== 'sending', notifyStatus: status };
    }));
    const counts = new Map<string, number>();
    for (const status of statuses.values()) counts.set(status, (counts.get(status) ?? 0) + 1);
    const summary = [...counts].map(([status, n]) => `${NOTIFY_LABEL[status] ?? status} ${n} 筆`).join('、');
    setFlash(summary || '沒有可發送的待領包裹，請查看包裹紀錄。');
    setTimeout(() => setFlash(null), 3500);
  };

  const printGroups = [];
  for (let i = 0; i < batch.length; i += 60) printGroups.push(batch.slice(i, i + 60));
  const attention = batch.filter((b) => b.notified && b.notifyStatus !== 'sent').length;
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
        {flash ? <Alert tone="info" className="mb-4 text-base">{flash}</Alert> : null}
        {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}

        <Card>
          <CardBody>
            <fieldset disabled={busy} className="min-w-0 space-y-5">
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
                    aria-label="搜尋戶號"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) e.preventDefault();
                      if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, results.length - 1));
                      if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
                      if (!e.nativeEvent.isComposing && e.key === 'Enter' && results[highlight]) {
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
                    <p className="mt-2 text-sm text-gray-500" role="status">{!currentSearch ? '查詢中…' : currentSearch.failed ? '查詢失敗，請確認網路後重新輸入戶號。' : '找不到符合的戶號'}</p>
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
                  <Input aria-label="物流單號" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="掃描或輸入單號" className="h-12 text-base" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                  <Button variant="secondary" size="lg" onClick={() => setScanning(true)}>
                    📷 掃描
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-sm font-semibold text-gray-700">備註（選填）</div>
                <Textarea aria-label="備註" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="例如：外箱破損、需冷藏盡快領取" />
              </div>
              {photosEnabled ? (
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-gray-700">照片（選填）</div>
                  <div className="flex items-center gap-3">
                    <label className={buttonClass('secondary', 'lg', 'cursor-pointer')}>
                      {preparingPhoto ? '處理照片中…' : '📸 拍照'}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        disabled={busy || preparingPhoto}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (!f) return;
                          setPreparingPhoto(true);
                          setError(null);
                          setPhoto(null);
                          try { setPhoto(await compressImage(f)); }
                          catch { setError('這張照片無法讀取，請重新拍照或選擇 JPG、PNG 圖片。'); }
                          finally { setPreparingPhoto(false); }
                        }}
                      />
                    </label>
                    {photo ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt="包裹照片" className="h-16 w-16 rounded-lg object-cover ring-1 ring-gray-200" />
                        <button type="button" aria-label="移除照片" onClick={() => setPhoto(null)} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-gray-800 text-xs text-white">
                          ✕
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <Button size="xl" className="w-full" disabled={!unit || busy || preparingPhoto} onClick={submit}>
              {busy ? '登記中…' : unit ? `登記 ${unit.label}${quantity > 1 ? `（${quantity} 件）` : ''}` : '請先選擇戶號'}
            </Button>
            </fieldset>
          </CardBody>
        </Card>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader
            title="本次登記"
            description={[pendingIds.length ? `${pendingIds.length} 筆待處理（${pendingUnits} 戶）` : '', attention ? `${attention} 筆通知需確認` : '', batch.length && !pendingIds.length && !attention ? '全部已通知' : ''].filter(Boolean).join(' ・ ')}
            actions={
              batch.some((b) => b.notifyStatus === 'sent') ? (
                <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setBatch((b) => b.filter((x) => x.notifyStatus !== 'sent'))}>
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
                    <Link href={`/c/${slug}/parcels/${b.id}`} className="underline underline-offset-2">{b.unitLabel}</Link>
                    {b.quantity > 1 ? <span className="ml-1 text-sm text-gray-500">×{b.quantity}</span> : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {b.carrier ?? '未填物流'}・取件碼 <span className="font-mono">{b.pickupCode}</span>
                  </div>
                </div>
                {b.notified ? (
                  <Badge tone={b.notifyStatus === 'sent' ? 'green' : b.notifyStatus === 'failed' ? 'red' : 'gray'}>{NOTIFY_LABEL[b.notifyStatus ?? ''] ?? '已處理'}</Badge>
                ) : (
                  <Badge tone="yellow">{b.notifyStatus === 'sending' ? '傳送中' : '待通知'}</Badge>
                )}
              </div>
            ))}
          </div>
          <CardBody className="space-y-2 border-t border-gray-100">
            {attention ? <p className="text-sm text-amber-800">點選戶號查看通知紀錄，可重新通知或列印取件通知單。</p> : null}
            <Button size="lg" className="w-full" disabled={!pendingIds.length || busy} onClick={finishBatch}>
              完成並發送通知{pendingUnits ? `（${pendingUnits} 戶）` : ''}
            </Button>
            {printGroups.map((items, i) => (
              <Link key={items[0].id} className={buttonClass('secondary', 'md', 'w-full')} href={`/c/${slug}/print/slips?ids=${items.map((b) => b.id).join(',')}`} target="_blank">
                🖨️ 列印取件通知單{printGroups.length > 1 ? `（${i + 1}/${printGroups.length}）` : ''}
              </Link>
            ))}
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
