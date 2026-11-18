'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createCommunityAction } from '@/actions/platform';
import { CopyLink } from '@/components/action-form';
import { FormMessage, SubmitButton } from '@/components/form';
import { Alert, Card, CardBody, CardHeader, Field, Input, Select, buttonClass } from '@/components/ui';

type Plan = { id: string; name: string; maxUnits: number; price: number };

function toSlug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40);
}

export function NewCommunityForm({ plans, orgs }: { plans: Plan[]; orgs: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createCommunityAction, null);
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState({
    name: '', address: '', planId: plans[0]?.id ?? '', lineMode: 'shared', trialDays: '14',
    orgId: '', orgName: '', adminName: '', adminEmail: '',
  });
  const field = (key: keyof typeof fields) => ({
    name: key,
    value: fields[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.currentTarget.value;
      setFields((current) => ({ ...current, [key]: value }));
    },
  });
  const [orgMode, setOrgMode] = useState<'new' | 'existing'>('new');

  if (state?.ok && state.data) {
    const inviteUrl = state.data.inviteUrl as string | null;
    return (
      <Card>
        <CardBody className="space-y-4">
          <Alert tone="success" title={state.message} />
          {typeof state.data.inviteError === 'string' ? (
            <Alert tone="warning" title="社區已建立，管理者邀請仍需確認">
              {state.data.inviteError} <Link href={`/admin/communities/${state.data.communityId}#staff`} className="font-semibold underline">前往社區人員補發邀請</Link>
            </Alert>
          ) : null}
          {inviteUrl ? (
            <>
              <p className="text-sm text-gray-600">{state.data.emailed ? '邀請信已寄出。也可以直接把下面的連結傳給社區管理者：' : '邀請信未寄出，請把下面的連結傳給社區管理者（72 小時內有效）：'}</p>
              <CopyLink url={inviteUrl} label="社區管理者邀請連結" />
            </>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Link className={buttonClass('primary')} href={`/c/${state.data.slug}/setup`}>
              進入社區後台設定
            </Link>
            <Link className={buttonClass('secondary')} href={`/admin/communities/${state.data.communityId}`}>
              查看客戶資料
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="社區資料" />
        <CardBody className="space-y-4">
          <Field label="社區名稱">
            <Input {...field('name')} required placeholder="例如：幸福花園社區" />
          </Field>
          <Field label="網址代號" hint={`社區後台網址：/c/${slug || 'xxx'}（3–40 字元，可用小寫英文、數字及中間的連字號）`}>
            <Input name="slug" required value={slug} onChange={(e) => setSlug(toSlug(e.target.value))} placeholder="happy-garden" pattern={String.raw`[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]`} />
          </Field>
          <Field label="地址（選填）">
            <Input {...field('address')} />
          </Field>
          <Field label="LINE 官方帳號">
            <Select {...field('lineMode')}>
              <option value="shared">使用平台共用帳號（開通最快）</option>
              <option value="own">社區自己的官方帳號（之後在社區後台設定）</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="方案與試用" />
          <CardBody className="space-y-4">
            <Field label="方案">
              <Select {...field('planId')} required>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.maxUnits} 戶以內，NT${p.price.toLocaleString()}/月）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="試用天數" hint="0 表示直接轉為正式（之後記得記錄收款）">
              <Input {...field('trialDays')} type="number" min={0} max={90} />
            </Field>
            <div>
              <div className="mb-1 text-sm font-medium text-gray-700">所屬物業公司</div>
              <div className="mb-2 flex gap-4 text-sm">
                {orgs.length ? (
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={orgMode === 'existing'} onChange={() => setOrgMode('existing')} /> 既有公司
                  </label>
                ) : null}
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={orgMode === 'new'} onChange={() => setOrgMode('new')} /> 獨立社區／新公司
                </label>
              </div>
              {orgMode === 'existing' ? (
                <Select required {...field('orgId')} aria-label="所屬物業公司">
                  <option value="" disabled>請選擇物業公司</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...field('orgName')} placeholder="留白則以社區名稱建立" />
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="社區管理者" description="會收到邀請連結，用來登入社區後台設定戶別、人員等" />
          <CardBody className="space-y-4">
            <Field label="姓名（選填）">
              <Input {...field('adminName')} />
            </Field>
            <Field label="Email（選填，之後也可以再邀請）">
              <Input {...field('adminEmail')} type="email" />
            </Field>
          </CardBody>
        </Card>
        <FormMessage state={state} />
        <SubmitButton size="lg" className="w-full">
          建立社區
        </SubmitButton>
      </div>
    </form>
  );
}
