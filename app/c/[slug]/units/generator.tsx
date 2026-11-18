'use client';

import { useActionState, useEffect, useState } from 'react';
import { generateUnitsAction, previewUnitsAction } from '@/actions/community';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';

const PATTERNS = [
  { pattern: '{b}-{f}-{u}', example: 'A-14-1' },
  { pattern: '{b}{f}{uu}', example: 'A1401' },
  { pattern: '{f}F-{u}', example: '14F-1（單棟）' },
  { pattern: '{b}棟{f}樓之{u}', example: 'A棟14樓之1' },
  { pattern: '{f}-{u}', example: '14-1（單棟）' },
];

export function UnitGenerator({ slug }: { slug: string }) {
  const [state, action] = useActionState(generateUnitsAction.bind(null, slug), null);
  const [form, setForm] = useState({ buildings: 'A, B', floorFrom: 1, floorTo: 16, skipFloors: '', unitsPerFloor: 4, unitNumbers: '', pattern: '{b}-{f}-{u}' });
  const [preview, setPreview] = useState<{ ok: boolean; count?: number; sample?: string[]; last?: string; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const result = await previewUnitsAction(slug, form);
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview({ ok: false, error: '無法載入預覽，請檢查連線後再試。' });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form, slug]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setPreview(null);
    setForm((f) => ({ ...f, [k]: value }));
  };

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="棟別" hint="用逗號分隔；單棟大樓請留白">
          <Input name="buildings" value={form.buildings} onChange={set('buildings')} placeholder="A, B" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="從幾樓" hint="地下室用負數">
            <Input name="floorFrom" type="number" value={form.floorFrom} onChange={set('floorFrom')} />
          </Field>
          <Field label="到幾樓">
            <Input name="floorTo" type="number" value={form.floorTo} onChange={set('floorTo')} />
          </Field>
        </div>
        <Field label="跳過的樓層" hint="例如 4, 13（選填）">
          <Input name="skipFloors" value={form.skipFloors} onChange={set('skipFloors')} />
        </Field>
        <Field label="每層戶數">
          <Input name="unitsPerFloor" type="number" min={0} max={50} value={form.unitsPerFloor} onChange={set('unitsPerFloor')} />
        </Field>
        <Field label="或指定戶號" hint="例如 1, 2, 3, 5（會取代每層戶數）">
          <Input name="unitNumbers" value={form.unitNumbers} onChange={set('unitNumbers')} />
        </Field>
        <Field label="門牌格式">
          <Select name="pattern" value={form.pattern} onChange={set('pattern')}>
            {PATTERNS.map((p) => (
              <option key={p.pattern} value={p.pattern}>
                {p.example}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm">
        {preview?.ok ? (
          <>
            會產生 <b className="tabular">{preview.count}</b> 戶：{preview.sample?.join('、')}
            {preview.count && preview.count > 12 ? ` … ${preview.last}` : ''}
          </>
        ) : (
          <span className="text-red-600">{preview?.error ?? '預覽中…'}</span>
        )}
      </div>
      <FormMessage state={state} />
      <SubmitButton disabled={!preview?.ok}>產生戶別</SubmitButton>
    </form>
  );
}
