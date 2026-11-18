import Link from 'next/link';
import { count, eq, and } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCommunity } from '@/auth/session';
import { completeSetupAction } from '@/actions/community';
import { resolveCommunityChannel } from '@/domain/line-channels';
import { ActionButton } from '@/components/action-form';
import { Card, CardBody, PageHeader, buttonClass, cx } from '@/components/ui';

export const metadata = { title: '開通設定' };

export default async function SetupWizard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const cid = ctx.community.id;
  const [[units], [staff], [residents], [parcels], resolved] = await Promise.all([
    db().select({ n: count() }).from(schema.units).where(eq(schema.units.communityId, cid)),
    db().select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.communityId, cid)),
    db().select({ n: count() }).from(schema.residents).where(and(eq(schema.residents.communityId, cid), eq(schema.residents.status, 'active'))),
    db().select({ n: count() }).from(schema.parcels).where(eq(schema.parcels.communityId, cid)),
    resolveCommunityChannel(ctx.community),
  ]);
  const s = ctx.settings;
  const base = `/c/${slug}`;
  const steps = [
    { done: !!(s.deskPhone || s.deskHours), title: '填寫管理室聯絡資訊', desc: '管理室電話與領取時間會出現在住戶的通知裡。', href: `${base}/settings`, cta: '前往設定' },
    { done: units.n > 0, title: '建立戶別', desc: '用產生器依棟別、樓層、每層戶數一次建立，或匯入 CSV。', href: `${base}/units`, cta: '建立戶別' },
    { done: !!resolved, title: '確認 LINE 官方帳號', desc: ctx.community.lineMode === 'shared' ? '使用平台共用帳號，不需要額外設定。' : '設定社區自己的官方帳號。', href: `${base}/settings/line`, cta: '查看' },
    { done: staff.n > 1, title: '邀請警衛／櫃台人員', desc: '每位人員用自己的帳號登入，誰收的、誰交付的都查得到。', href: `${base}/staff`, cta: '邀請人員' },
    { done: residents.n > 0, title: '列印綁定卡給住戶', desc: '每戶一張，投入信箱。住戶用 LINE 掃描就完成綁定。', href: `${base}/print/cards`, cta: '列印綁定卡' },
    { done: parcels.n > 0, title: '登記第一件包裹', desc: '用平板開啟「收件登記」，試著登記一件包裹並確認住戶收到通知。', href: `${base}/receive`, cta: '收件登記' },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  return (
    <>
      <PageHeader title="開通設定" description={`完成以下步驟就可以開始使用（${doneCount}/${steps.length}）`} />
      <div className="space-y-3">
        {steps.map((step, i) => (
          <Card key={step.title}>
            <CardBody className="flex flex-wrap items-center gap-4">
              <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', step.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>{step.done ? '✓' : i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className={cx('font-semibold', step.done ? 'text-gray-500 line-through' : 'text-gray-900')}>{step.title}</div>
                <div className="text-sm text-gray-500">{step.desc}</div>
              </div>
              <Link href={step.href} className={buttonClass(step.done ? 'ghost' : 'secondary', 'sm')}>
                {step.cta}
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <ActionButton action={completeSetupAction.bind(null, slug)} variant="primary" size="md">
          完成設定，開始使用
        </ActionButton>
      </div>
    </>
  );
}
