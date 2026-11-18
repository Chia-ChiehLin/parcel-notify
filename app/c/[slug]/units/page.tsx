import Link from 'next/link';
import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import { addUnitAction, importUnitsAction } from '@/actions/community';
import { getCommunityWithPlan } from '@/domain/communities';
import { listUnits } from '@/domain/units';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, Table, Td, Th } from '@/components/ui';
import { UnitGenerator } from './generator';

export const metadata = { title: '戶別' };

export default async function UnitsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; view?: string }> }) {
  const { slug } = await params;
  const { q, view } = await searchParams;
  const ctx = await requireCommunity(slug);
  const isAdmin = hasRole(ctx.role, 'community_admin');
  const [rows, { plan }] = await Promise.all([
    listUnits(ctx.community.id, { q, status: view === 'vacant' ? 'vacant' : undefined }),
    getCommunityWithPlan(ctx.community.id),
  ]);
  const filtered = view === 'unbound' ? rows.filter((r) => r.residentCount === 0 && r.unit.status === 'active') : rows;
  const base = `/c/${slug}/units`;
  const total = rows.length;

  return (
    <>
      <PageHeader
        title="戶別"
        description={`${total} 戶（方案上限 ${plan.maxUnits} 戶）`}
        actions={
          isAdmin && total ? (
            <>
              <LinkButton href={`/c/${slug}/print/cards`}>列印綁定卡</LinkButton>
              <a href={`${base}/export?codes=1`} className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold shadow-sm hover:bg-gray-50">
                匯出 CSV
              </a>
            </>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div className="flex gap-1 text-sm">
            {[
              ['', '全部'],
              ['unbound', '尚未綁定'],
              ['vacant', '空戶'],
            ].map(([v, label]) => (
              <Link key={v} href={v ? `${base}?view=${v}` : base} className={`rounded-md px-3 py-1.5 ${(view ?? '') === v ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-600 hover:bg-gray-100'}`}>
                {label}
              </Link>
            ))}
          </div>
          <form className="flex gap-2">
            {view ? <input type="hidden" name="view" value={view} /> : null}
            <Input name="q" defaultValue={q} placeholder="搜尋門牌，例如 A141" className="w-56" />
          </form>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title={total ? '沒有符合的戶別' : '還沒有戶別'} description={total ? undefined : isAdmin ? '用下方的產生器一次建立所有戶別，或匯入 CSV。' : '請社區管理者建立戶別。'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>門牌</Th>
                <Th>棟別</Th>
                <Th className="text-right">綁定住戶</Th>
                <Th className="text-right">待領包裹</Th>
                <Th>狀態</Th>
                {isAdmin ? <Th>綁定碼</Th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(({ unit, buildingName, residentCount, waitingCount }) => (
                <tr key={unit.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`${base}/${unit.id}`} className="font-semibold text-gray-900 hover:text-brand-700">
                      {unit.label}
                    </Link>
                  </Td>
                  <Td>{buildingName ?? '—'}</Td>
                  <Td className="text-right tabular">{residentCount === 0 ? <span className="text-gray-400">0</span> : residentCount}</Td>
                  <Td className="text-right tabular">{waitingCount ? <Badge tone="yellow">{waitingCount}</Badge> : <span className="text-gray-400">0</span>}</Td>
                  <Td>{unit.status === 'vacant' ? <Badge>空戶</Badge> : residentCount ? <Badge tone="green">已綁定</Badge> : <Badge tone="yellow">未綁定</Badge>}</Td>
                  {isAdmin ? <Td className="font-mono text-xs tracking-wider text-gray-600">{unit.bindCode}</Td> : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* 產生器固定放在這裡：新增後頁面重新整理，表單和結果訊息才不會消失 */}
      {isAdmin ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="批次產生戶別" description="依棟別、樓層、每層戶數自動產生門牌和綁定碼；已存在的門牌會自動略過" />
            <CardBody>
              <UnitGenerator slug={slug} />
            </CardBody>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="新增單一戶別" />
              <CardBody>
                <ActionForm action={addUnitAction.bind(null, slug)} submitLabel="新增" resetOnSuccess>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="棟別">
                      <Input name="building" placeholder="A" />
                    </Field>
                    <Field label="樓層">
                      <Input name="floor" type="number" placeholder="14" />
                    </Field>
                    <Field label="戶號">
                      <Input name="number" required placeholder="1" />
                    </Field>
                  </div>
                  <Field label="門牌（選填）" hint="留白會自動組成，例如 A-14-1">
                    <Input name="label" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="匯入 CSV" description="欄位：門牌,棟別,樓層,戶號（第一列為標題）" />
              <CardBody>
                <ActionForm action={importUnitsAction.bind(null, slug)} submitLabel="匯入" resetOnSuccess>
                  <input type="file" name="file" accept=".csv,text/csv" className="block w-full text-sm" />
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
