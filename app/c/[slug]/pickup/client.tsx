'use client';

import { useEffect, useRef, useState } from 'react';
import { confirmPickupAction, lookupPickupAction, lookupUnitPickupAction } from '@/actions/parcels';
import type { PickupLookup } from '@/domain/pickup';
import { CameraScanner } from '@/components/scanner';
import { SignaturePad } from '@/components/signature-pad';
import { Alert, Badge, Button, Card, CardBody, Input, cx } from '@/components/ui';

const CATEGORY: Record<string, string> = { cold: '冷藏', frozen: '冷凍', large: '大型', registered: '掛號', document: '文件', fragile: '易碎' };

function ago(iso: string | Date) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '1 小時內';
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function PickupClient({ slug, requireSignature, initialUnitId }: { slug: string; requireSignature: boolean; initialUnitId: string | null }) {
  const [input, setInput] = useState('');
  const [lookup, setLookup] = useState<PickupLookup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickupName, setPickupName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [wantSignature, setWantSignature] = useState(requireSignature);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apply = (res: PickupLookup) => {
    setLookup(res);
    setError(res.kind === 'error' ? res.message : null);
    if (res.kind === 'unit') {
      setSelected(new Set(res.parcels.map((p) => p.id)));
      setPickupName(res.proxy?.name ?? '');
    }
  };

  const search = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setDone(null);
    apply(await lookupPickupAction(slug, text));
    setBusy(false);
  };

  useEffect(() => {
    if (initialUnitId) lookupUnitPickupAction(slug, initialUnitId).then(apply);
  }, [initialUnitId, slug]);

  const reset = () => {
    setInput('');
    setLookup(null);
    setSelected(new Set());
    setPickupName('');
    setSignature(null);
    setWantSignature(requireSignature);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirm = async () => {
    if (lookup?.kind !== 'unit' || !selected.size) return;
    const method = lookup.via === 'qr' ? 'qr' : lookup.via === 'proxy' ? 'proxy' : lookup.via === 'code' ? 'code' : 'manual';
    setBusy(true);
    const res = await confirmPickupAction(slug, {
      parcelIds: [...selected],
      method,
      residentId: lookup.resident?.id,
      proxyCodeId: lookup.proxy?.id,
      pickupName: pickupName || undefined,
      signature: wantSignature ? signature : null,
    });
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setDone(`${lookup.unit.label}：${res?.message ?? '已交付'}`);
    reset();
  };

  const unit = lookup?.kind === 'unit' ? lookup : null;
  const viaLabel = unit
    ? { qr: ['住戶 QR', 'green'], code: ['取件碼', 'blue'], proxy: ['代領碼', 'purple'], unit: ['門牌查詢・請核對身分', 'yellow'] }[unit.via]
    : null;
  const needName = unit?.via === 'unit';
  const canConfirm = !!unit && selected.size > 0 && !busy && (!needName || pickupName.trim()) && (!wantSignature || !!signature);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">交付取件</h1>
      {done ? <Alert tone="success" className="mb-4 text-base">✓ {done}</Alert> : null}

      <Card className="mb-6">
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(input);
            }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="掃描住戶 QR，或輸入取件碼／代領碼／門牌"
              className="h-14 text-lg"
              autoComplete="off"
            />
            <Button type="submit" size="lg" disabled={busy}>
              查詢
            </Button>
            <Button type="button" size="lg" variant="secondary" onClick={() => setScanning(true)}>
              📷
            </Button>
          </form>
          <p className="mt-2 text-xs text-gray-500">可以用平板相機掃描住戶手機上的 QR code，或接 USB 掃描槍直接掃。</p>
        </CardBody>
      </Card>

      {error ? <Alert tone="error" className="mb-4">{error}</Alert> : null}

      {lookup?.kind === 'choices' ? (
        <Card>
          <CardBody>
            <div className="mb-3 text-sm font-medium text-gray-700">找到多個門牌，請選擇：</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {lookup.units.map((u) => (
                <Button key={u.id} variant="secondary" size="lg" onClick={async () => apply(await lookupUnitPickupAction(slug, u.id))}>
                  {u.label}
                </Button>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {unit ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div>
              <div className="text-3xl font-bold">{unit.unit.label}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                {viaLabel ? <Badge tone={viaLabel[1] as 'green'}>{viaLabel[0]}</Badge> : null}
                {unit.resident ? <span className="text-gray-600">住戶：{unit.resident.name}</span> : null}
                {unit.proxy ? <span className="text-gray-600">代領人：{unit.proxy.name ?? '未填'}</span> : null}
              </div>
            </div>
            <Button variant="ghost" onClick={reset}>
              取消
            </Button>
          </div>
          {unit.parcels.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-500">這戶目前沒有待領取的包裹</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {unit.parcels.map((p) => {
                const on = selected.has(p.id);
                return (
                  <label key={p.id} className={cx('flex cursor-pointer items-center gap-4 px-5 py-4', on ? 'bg-brand-50/60' : '', unit.highlightParcelId === p.id ? 'ring-2 ring-inset ring-blue-400' : '')}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                      className="h-6 w-6"
                    />
                    {p.photoKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${p.photoKey}`} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-gray-200" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold">{p.storageLocation ?? '未填位置'}</span>
                        {p.categories.map((c) => (
                          <Badge key={c} tone={c === 'frozen' || c === 'cold' ? 'blue' : c === 'registered' ? 'red' : 'purple'}>
                            {CATEGORY[c] ?? c}
                          </Badge>
                        ))}
                        {p.quantity > 1 ? <Badge>×{p.quantity}</Badge> : null}
                      </div>
                      <div className="text-sm text-gray-500">
                        {p.carrier ?? '未填物流'}・取件碼 <span className="font-mono">{p.pickupCode}</span>・{ago(p.receivedAt)}
                        {p.trackingNo ? `・${p.trackingNo}` : ''}
                      </div>
                      {p.note ? <div className="text-sm text-amber-700">備註：{p.note}</div> : null}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {unit.parcels.length ? (
            <CardBody className="space-y-4 border-t border-gray-100">
              {needName || unit.via === 'proxy' ? (
                <div>
                  <div className="mb-1 text-sm font-medium text-gray-700">{needName ? '領取人姓名（必填，請核對身分）' : '代領人姓名'}</div>
                  <Input value={pickupName} onChange={(e) => setPickupName(e.target.value)} placeholder="例如：王小明" className="h-12 text-base" />
                </div>
              ) : null}
              {!requireSignature ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={wantSignature} onChange={(e) => setWantSignature(e.target.checked)} className="h-5 w-5" /> 請領取人簽名
                </label>
              ) : null}
              {wantSignature ? <SignaturePad onChange={setSignature} /> : null}
              <Button size="xl" className="w-full" disabled={!canConfirm} onClick={confirm}>
                {busy ? '處理中…' : `確認交付 ${selected.size} 件`}
              </Button>
            </CardBody>
          ) : null}
        </Card>
      ) : null}

      {scanning ? (
        <CameraScanner
          title="掃描住戶取件 QR"
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            setInput(text.startsWith('PNQR:') ? '' : text);
            search(text);
          }}
        />
      ) : null}
    </div>
  );
}
