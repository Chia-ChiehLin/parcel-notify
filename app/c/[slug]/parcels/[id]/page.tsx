import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCommunity } from '@/auth/session';
import { closeParcelAction, resendAction, updateParcelAction } from '@/actions/parcels';
import { getParcel } from '@/domain/parcels';
import { CATEGORY_LABELS } from '@/domain/settings';
import { AUDIT_ACTION_LABELS } from '@/domain/audit';
import { ActionForm } from '@/components/action-form';
import { StateButton } from '@/components/state-button';
import { CategoryBadges, NotifyBadge, ParcelStatusBadge } from '@/components/status';
import { Badge, Card, CardBody, CardHeader, Field, Input, LinkButton, PageHeader, Select } from '@/components/ui';
import { formatDateTime } from '@/lib/time';

const METHOD = { qr: '住戶 QR', code: '取件碼', proxy: '代領碼', manual: '人工核對' } as const;

export default async function ParcelDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireCommunity(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getParcel(ctx.community.id, id).catch(() => null);
  if (!data) notFound();
  const { parcel: p, unit, receiverName, handlerName, pickupResidentName, history, notifications } = data;
  const s = ctx.settings;
  const base = `/c/${slug}`;
  const waiting = p.status === 'waiting';

  return (
    <>
      <PageHeader
        title={`${unit.label} 的包裹`}
        back={{ href: `${base}/parcels`, label: '包裹紀錄' }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ParcelStatusBadge status={p.status} /> <NotifyBadge status={p.notifyStatus} /> 取件碼 <span className="font-mono font-semibold">{p.pickupCode}</span>
          </span>
        }
        actions={
          waiting ? (
            <>
              <LinkButton href={`${base}/pickup?unit=${unit.id}`} variant="primary">
                交付
              </LinkButton>
              <LinkButton href={`${base}/print/slips?ids=${p.id}`} target="_blank">
                列印通知單
              </LinkButton>
            </>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="包裹資料" />
            <CardBody className="grid gap-6 sm:grid-cols-[1fr_auto]">
              <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
                <dt className="text-gray-500">門牌</dt>
                <dd>
                  <Link href={`${base}/units/${unit.id}`} className="font-semibold hover:text-brand-700">
                    {unit.label}
                  </Link>
                </dd>
                <dt className="text-gray-500">物流商</dt>
                <dd>{p.carrier ?? '—'}</dd>
                <dt className="text-gray-500">單號</dt>
                <dd className="break-all">{p.trackingNo ?? '—'}</dd>
                <dt className="text-gray-500">類別</dt>
                <dd>{p.categories.length ? <CategoryBadges categories={p.categories} /> : '—'}</dd>
                <dt className="text-gray-500">件數</dt>
                <dd>{p.quantity}</dd>
                <dt className="text-gray-500">存放位置</dt>
                <dd>{p.storageLocation ?? '—'}</dd>
                <dt className="text-gray-500">備註</dt>
                <dd>{p.note ?? '—'}</dd>
                <dt className="text-gray-500">到件</dt>
                <dd>
                  {formatDateTime(p.receivedAt)}
                  {receiverName ? `・${receiverName}` : ''}
                </dd>
                {p.pickedUpAt ? (
                  <>
                    <dt className="text-gray-500">領取</dt>
                    <dd>
                      {formatDateTime(p.pickedUpAt)}・{p.pickupName ?? pickupResidentName ?? '—'}
                      {p.pickupMethod ? <Badge className="ml-2">{METHOD[p.pickupMethod]}</Badge> : null}
                      {handlerName ? <div className="text-xs text-gray-500">交付人員：{handlerName}</div> : null}
                    </dd>
                  </>
                ) : null}
                {p.closedAt ? (
                  <>
                    <dt className="text-gray-500">結案</dt>
                    <dd>
                      {formatDateTime(p.closedAt)} {p.closedNote}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="space-y-3">
                {p.photoKey ? (
                  <a href={`/api/files/${p.photoKey}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${p.photoKey}`} alt="包裹照片" className="w-48 rounded-lg ring-1 ring-gray-200" />
                  </a>
                ) : null}
                {p.signatureKey ? (
                  <div>
                    <div className="text-xs text-gray-500">簽名</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${p.signatureKey}`} alt="簽名" className="w-48 rounded-lg bg-white ring-1 ring-gray-200" />
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="處理紀錄" />
            <CardBody>
              <ol className="relative space-y-4 border-l border-gray-200 pl-5 text-sm">
                {[...history.map((h) => ({ at: h.createdAt, text: `${AUDIT_ACTION_LABELS[h.action] ?? h.action}`, by: h.actorName })), ...notifications.map((n) => ({ at: n.createdAt, text: `${n.kind === 'reminder' ? '逾期提醒' : n.kind === 'pickup' ? '領取通知' : '到件通知'}（${n.channel === 'line' ? 'LINE' : 'Email'}）${n.status === 'failed' ? `失敗：${n.error ?? ''}` : '已送出'}`, by: null as string | null }))]
                  .sort((a, b) => a.at.getTime() - b.at.getTime())
                  .map((e, i) => (
                    <li key={i}>
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-600" />
                      <div className="font-medium text-gray-800">{e.text}</div>
                      <div className="text-xs text-gray-500">
                        {formatDateTime(e.at)}
                        {e.by ? `・${e.by}` : ''}
                      </div>
                    </li>
                  ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        {waiting ? (
          <div className="space-y-6">
            <Card>
              <CardHeader title="通知" />
              <CardBody>
                <StateButton action={resendAction.bind(null, slug, p.id)} variant="primary">
                  重新通知
                </StateButton>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="修改" description="登記錯誤時可以修改，修改紀錄會保留" />
              <CardBody>
                <ActionForm action={updateParcelAction.bind(null, slug, p.id)}>
                  <Field label="物流商">
                    <Select name="carrier" defaultValue={p.carrier ?? ''}>
                      <option value="">（未填）</option>
                      {[...new Set([...(p.carrier ? [p.carrier] : []), ...s.carriers])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="存放位置">
                    <Select name="storageLocation" defaultValue={p.storageLocation ?? ''}>
                      <option value="">（未填）</option>
                      {[...new Set([...(p.storageLocation ? [p.storageLocation] : []), ...s.storageLocations])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="單號">
                      <Input name="trackingNo" defaultValue={p.trackingNo ?? ''} />
                    </Field>
                    <Field label="件數">
                      <Input name="quantity" type="number" min={1} max={99} defaultValue={p.quantity} />
                    </Field>
                  </div>
                  <fieldset>
                    <legend className="mb-1 text-sm font-medium text-gray-700">類別</legend>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {Object.entries(CATEGORY_LABELS).map(([v, label]) => (
                        <label key={v} className="flex items-center gap-1.5">
                          <input type="checkbox" name="categories" value={v} defaultChecked={p.categories.includes(v as never)} /> {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Field label="備註">
                    <Input name="note" defaultValue={p.note ?? ''} />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="退件／取消" />
              <CardBody className="space-y-4">
                <ActionForm action={closeParcelAction.bind(null, slug, p.id, 'returned')} submitLabel="標記退件" submitVariant="secondary">
                  <Field label="退件原因">
                    <Input name="note" placeholder="例如：逾期未領，退回寄件人" />
                  </Field>
                </ActionForm>
                <ActionForm action={closeParcelAction.bind(null, slug, p.id, 'cancelled')} submitLabel="取消這筆登記" submitVariant="danger">
                  <Field label="取消原因">
                    <Input name="note" placeholder="例如：重複登記" required />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
