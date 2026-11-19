import { requireCommunity } from '@/auth/session';
import { configureOwnLineAction, initializeOwnWebhookAction, installOwnRichMenuAction, setLineModeAction } from '@/actions/community';
import { getCommunityWithPlan } from '@/domain/communities';
import { channelQuotaSummary, getOwnChannel, getSharedChannel, lineAddFriendUrl, webhookUrlFor } from '@/domain/line-channels';
import { LineSetupForm } from '@/components/line-setup';
import { StateButton } from '@/components/state-button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export const metadata = { title: 'LINE 官方帳號' };

export default async function LineSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const [{ plan }, own, shared] = await Promise.all([getCommunityWithPlan(ctx.community.id), getOwnChannel(ctx.community.id), getSharedChannel()]);
  const mode = ctx.community.lineMode;
  const active = mode === 'own' ? (own?.isActive ? own : null) : mode === 'shared' ? shared : null;
  const quota = active ? await channelQuotaSummary(active) : null;
  const canOwn = plan.features.ownLine || ctx.role === 'platform_admin';

  return (
    <>
      <PageHeader title="LINE 官方帳號" description="住戶加入官方帳號並輸入綁定碼後，包裹通知就會從這個帳號發出。" />

      <Card className="mb-6">
        <CardHeader title="目前使用" />
        <CardBody className="space-y-4">
          {active ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-lg font-semibold">{active.displayName ?? active.name}</div>
              <Badge tone="green">{mode === 'own' ? '社區自有帳號' : '平台共用帳號'}</Badge>
              <span className="text-sm text-gray-500">{active.basicId}</span>
              <a className="text-sm text-brand-700 underline" href={lineAddFriendUrl(active.basicId ?? '')} target="_blank" rel="noreferrer">
                加好友連結
              </a>
              {quota ? (
                <span className="text-sm text-gray-500">
                  本月訊息用量 {quota}
                </span>
              ) : null}
            </div>
          ) : (
            <Alert tone="warning">{mode === 'shared' ? '服務商尚未設定共用帳號，請聯絡服務商。' : '尚未設定社區自己的官方帳號。'}</Alert>
          )}
          <div className="flex flex-wrap gap-3">
            {mode !== 'shared' ? (
              <StateButton action={setLineModeAction.bind(null, slug, 'shared')} confirm="切換後，住戶需要加入平台共用帳號並重新輸入綁定碼才會收到通知。確定切換？">
                改用平台共用帳號
              </StateButton>
            ) : null}
            {mode !== 'own' && own?.isActive ? (
              <StateButton action={setLineModeAction.bind(null, slug, 'own')} variant="primary" confirm="切換後，住戶需要加入社區自己的官方帳號並重新輸入綁定碼才會收到通知。確定切換？">
                改用社區自己的帳號
              </StateButton>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="社區自己的官方帳號" description="用社區自己的名稱和頭像發送通知，訊息費由社區的 LINE 方案負擔" />
        <CardBody className="space-y-6">
          {!canOwn ? (
            <Alert tone="info">目前方案（{plan.name}）不包含自有 LINE 帳號，請聯絡服務商升級方案。</Alert>
          ) : (
            <>
              {own ? (
                <div className="grid gap-4 rounded-lg bg-gray-50 p-4 text-sm md:grid-cols-2">
                  <div>
                    <div>
                      <span className="text-gray-500">已儲存帳號：</span>
                      {own.displayName}（{own.basicId}）
                    </div>
                    <div className="mt-1 break-all">
                      <span className="text-gray-500">Webhook：</span>
                      <code className="text-xs">{webhookUrlFor(own)}</code>
                    </div>
                  </div>
                  <div>
                    <StateButton action={initializeOwnWebhookAction.bind(null, slug)}>測試並設定本站 Webhook</StateButton>
                    {own.isActive ? <StateButton action={installOwnRichMenuAction.bind(null, slug)}>{own.richMenuId ? '重新建立圖文選單' : '建立圖文選單'}</StateButton> : null}
                  </div>
                </div>
              ) : null}
              <LineSetupForm action={configureOwnLineAction.bind(null, slug)} defaultName={own?.name ?? ctx.community.name} />
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
