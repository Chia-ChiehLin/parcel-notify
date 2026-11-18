import { EmailVerificationForm } from '@/components/email-verification-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import {
  addEmailResidentAction,
  correctEmailResidentAction,
  verifyCommunityEmailAction,
  deleteUnitAction,
  moveOutAction,
  removeResidentAction,
  rotateCodeAction,
  setPrimaryAction,
  updateUnitAction,
} from '@/actions/community';
import { resolveCommunityChannel, lineBindUrl } from '@/domain/line-channels';
import { listUnitMembers } from '@/domain/residents';
import { getUnit } from '@/domain/units';
import { ActionButton, ActionForm } from '@/components/action-form';
import { StateButton } from '@/components/state-button';
import { CategoryBadges, NotifyBadge, ParcelStatusBadge } from '@/components/status';
import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/time';
import { qrSvg } from '@/lib/qr';

export default async function UnitDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireCommunity(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const unit = await getUnit(ctx.community.id, id).catch(() => null);
  if (!unit) notFound();
  const isAdmin = hasRole(ctx.role, 'community_admin');
  const [members, parcels, resolved] = await Promise.all([
    listUnitMembers(ctx.community.id, unit.id),
    db().select().from(schema.parcels).where(and(eq(schema.parcels.communityId, ctx.community.id), eq(schema.parcels.unitId, unit.id))).orderBy(desc(schema.parcels.receivedAt)).limit(30),
    resolveCommunityChannel(ctx.community),
  ]);
  const bindUrl = resolved?.channel.basicId ? lineBindUrl(resolved.channel.basicId, unit.bindCode) : null;
  const qr = bindUrl && isAdmin ? await qrSvg(bindUrl) : null;
  const base = `/c/${slug}`;

  return (
    <>
      <PageHeader
        title={unit.label}
        back={{ href: `${base}/units`, label: '戶別' }}
        description={unit.status === 'vacant' ? '空戶' : `${members.length} 位住戶已綁定`}
        actions={
          <Link href={`${base}/receive?unit=${unit.id}`} className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-800">
            登記這戶的包裹
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="住戶" description="預設只有主要聯絡人會收到 LINE 推播（可在社區設定改為全部成員）" />
            {members.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">還沒有住戶綁定。請把綁定卡交給住戶，掃描後即可完成綁定。</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>住戶</Th>
                    <Th>通知方式</Th>
                    <Th>綁定時間</Th>
                    {isAdmin ? <Th /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <span className="font-medium">{m.displayName || '（未命名）'}</span> {m.isPrimary ? <Badge tone="brand">主要聯絡人</Badge> : null}
                        {m.email ? <div className="text-xs text-gray-500">{m.email}</div> : null}
                      </Td>
                      <Td className="space-x-1">
                        {m.lineUserId ? <Badge tone={m.lineFollowing && m.notifyLine ? 'green' : 'gray'}>{m.lineFollowing ? (m.notifyLine ? 'LINE' : 'LINE 已關閉') : '已封鎖官方帳號'}</Badge> : null}
                        {m.email ? <Badge tone={m.notifyEmail && m.emailVerifiedAt && m.verifiedEmail === m.email ? 'blue' : 'gray'}>
                          {m.notifyEmail ? (m.emailVerifiedAt && m.verifiedEmail === m.email ? 'Email 已驗證' : 'Email 待驗證') : 'Email 已關閉'}
                        </Badge> : null}
                        {isAdmin && m.email && m.notifyEmail && (!m.emailVerifiedAt || m.verifiedEmail !== m.email) ? (
                          <details className="mt-2 text-sm"><summary className="cursor-pointer">協助驗證信箱</summary>
                            <EmailVerificationForm atDesk action={verifyCommunityEmailAction.bind(null, slug, unit.id, m.id)} />
                          </details>
                        ) : null}
                        {isAdmin && !m.lineUserId ? (
                          <details className="mt-2 text-sm"><summary className="cursor-pointer">更正信箱或停用 Email</summary>
                            <ActionForm action={correctEmailResidentAction.bind(null, slug, unit.id, m.id)} submitLabel="儲存">
                              <input type="hidden" name="version" value={m.tokenVersion} />
                              <Field label="住戶信箱"><Input name="email" type="email" defaultValue={m.email ?? ''} maxLength={254} /></Field>
                              <label><input type="checkbox" name="consent" defaultChecked={m.notifyEmail} /> 已向住戶本人確認同意收取通知</label>
                              <p className="text-xs text-gray-600">更換信箱後須重新驗證。要停止寄送，可取消勾選並儲存。</p>
                            </ActionForm>
                          </details>
                        ) : null}
                      </Td>
                      <Td className="text-sm text-gray-500">{formatDateTime(m.boundAt)}</Td>
                      {isAdmin ? (
                        <Td className="text-right">
                          <div className="flex justify-end gap-2">
                            {!m.isPrimary ? (
                              <ActionButton action={setPrimaryAction.bind(null, slug, m.id)} variant="ghost">
                                設為主要聯絡人
                              </ActionButton>
                            ) : null}
                            <ActionButton action={removeResidentAction.bind(null, slug, m.id)} confirm={`確定移除「${m.displayName || '這位住戶'}」？移除後將不再收到這戶的通知。`} variant="ghost">
                              移除
                            </ActionButton>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="包裹紀錄" description="最近 30 件" />
            <Table>
              <thead>
                <tr>
                  <Th>到件</Th>
                  <Th>物流／類別</Th>
                  <Th>取件碼</Th>
                  <Th>狀態</Th>
                  <Th>通知</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parcels.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="text-center text-gray-500">
                      沒有包裹紀錄
                    </Td>
                  </tr>
                ) : null}
                {parcels.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <Td className="whitespace-nowrap text-sm">
                      <Link href={`${base}/parcels/${p.id}`} className="hover:text-brand-700">
                        {formatDateTime(p.receivedAt)}
                      </Link>
                    </Td>
                    <Td>
                      {p.carrier ?? '—'} <CategoryBadges categories={p.categories} />
                    </Td>
                    <Td className="font-mono">{p.pickupCode}</Td>
                    <Td>
                      <ParcelStatusBadge status={p.status} />
                    </Td>
                    <Td>
                      <NotifyBadge status={p.notifyStatus} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        {isAdmin ? (
          <div className="space-y-6">
            <Card>
              <CardHeader title="綁定碼" />
              <CardBody className="space-y-3">
                <div className="text-center">
                  <div className="font-mono text-3xl font-bold tracking-[0.2em] text-gray-900">{unit.bindCode}</div>
                  {qr ? <div className="mx-auto mt-3 w-40" dangerouslySetInnerHTML={{ __html: qr }} /> : <p className="mt-2 text-xs text-amber-700">LINE 官方帳號尚未設定，綁定卡上不會有 QR code</p>}
                </div>
                <StateButton action={rotateCodeAction.bind(null, slug, unit.id)} confirm="更換後舊的綁定碼會失效（已綁定的住戶不受影響）。確定？">
                  更換綁定碼
                </StateButton>
                <StateButton action={moveOutAction.bind(null, slug, unit.id)} variant="danger" confirm={`遷出會移除 ${unit.label} 的所有住戶並更換綁定碼，舊住戶將不再收到通知。確定？`}>
                  遷出重設
                </StateButton>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="新增 Email 住戶" description="請先取得住戶同意。新增後會寄出一封不含包裹資料的驗證信，再請住戶到管理室出示驗證碼。" />
              <CardBody>
                <ActionForm action={addEmailResidentAction.bind(null, slug, unit.id)} submitLabel="新增" resetOnSuccess>
                  <Field label="姓名">
                    <Input name="name" />
                  </Field>
                  <Field label="Email">
                    <Input name="email" type="email" maxLength={254} required />
                  </Field>
                  <label className="text-sm"><input name="consent" type="checkbox" required /> 已向住戶本人確認同意使用此信箱接收通知</label>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="戶別資料" />
              <CardBody>
                <ActionForm action={updateUnitAction.bind(null, slug, unit.id)}>
                  <Field label="門牌">
                    <Input name="label" defaultValue={unit.label} required />
                  </Field>
                  <Field label="狀態" hint="變更此標示會保留住戶的權限；住戶搬離時請使用「遷出重設」。">
                    <Select name="status" defaultValue={unit.status}>
                      <option value="active">使用中</option>
                      <option value="vacant">空戶</option>
                    </Select>
                  </Field>
                  <Field label="備註">
                    <Input name="note" defaultValue={unit.note ?? ''} />
                  </Field>
                </ActionForm>
                {parcels.length === 0 ? (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <ActionButton action={deleteUnitAction.bind(null, slug, unit.id)} variant="danger" confirm={`確定刪除 ${unit.label}？`}>
                      刪除戶別
                    </ActionButton>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
