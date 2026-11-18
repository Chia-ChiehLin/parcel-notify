import { requirePlatformAdmin } from '@/auth/session';
import { configureSharedLineAction, initializeSharedWebhookAction, installSharedRichMenuAction, verifySharedWebhookAction } from '@/actions/platform';
import { credsOf, getChannelQuota, getSavedSharedChannel, lineAddFriendUrl, webhookUrlFor } from '@/domain/line-channels';
import { LineSetupForm } from '@/components/line-setup';
import { StateButton } from '@/components/state-button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: '共用 LINE 帳號' };
export const dynamic = 'force-dynamic';

export default async function SharedLinePage() {
  await requirePlatformAdmin();
  const channel = await getSavedSharedChannel();
  const quota = channel ? await getChannelQuota({ channel, creds: credsOf(channel) }) : null;
  return (
    <>
      <PageHeader title="共用 LINE 官方帳號" description="選擇「共用帳號」的社區，住戶都會加入這個官方帳號。訊息費由這個帳號的 LINE 方案負擔，請反映在售價中。" />
      {channel ? (
        <Card className="mb-6">
          <CardHeader title={channel.displayName ?? channel.name} description={channel.basicId ?? ''} actions={<Badge tone="green">已儲存帳號</Badge>} />
          <CardBody className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-2">
              <div>
                <span className="text-gray-500">Webhook 網址：</span>
                <code className="break-all rounded bg-gray-100 px-1.5 py-0.5 text-xs">{webhookUrlFor(channel)}</code>
              </div>
              <div>
                <span className="text-gray-500">加好友連結：</span>
                <a className="text-brand-700 underline" href={lineAddFriendUrl(channel.basicId ?? '')} target="_blank" rel="noreferrer">
                  {lineAddFriendUrl(channel.basicId ?? '')}
                </a>
              </div>
              <div>
                <span className="text-gray-500">最近驗證記錄：</span>
                {channel.verifiedAt ? formatDateTime(channel.verifiedAt) : '待設定 Webhook'}
              </div>
              <div>
                <span className="text-gray-500">本月訊息用量：</span>
                {quota ? `${quota.used} / ${quota.limit ?? '無上限'} 則` : '無法取得'}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-gray-600">請從 LINE 能公開連入的網站設定 Webhook。完成後還需實機測試。</p>
              <StateButton action={initializeSharedWebhookAction}>測試並設定本站 Webhook</StateButton>
              <StateButton action={verifySharedWebhookAction}>檢查 LINE Webhook 連線</StateButton>
              <div className="font-medium text-gray-700">圖文選單</div>
              <p className="text-gray-500">{channel.richMenuId ? '已建立。重新建立會覆蓋目前的預設選單。' : '建立後，住戶聊天室下方會出現「我的包裹／取件 QR／通知設定／使用說明」按鈕。'}</p>
              {channel.isActive ? <StateButton action={installSharedRichMenuAction}>{channel.richMenuId ? '重新建立圖文選單' : '建立圖文選單'}</StateButton> : null}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Alert tone="warning" className="mb-6" title="尚未設定">
          設定完成前，使用共用帳號的社區無法發送 LINE 通知。
        </Alert>
      )}
      <Card>
        <CardHeader title={channel ? '更新金鑰' : '連接 LINE 官方帳號'} />
        <CardBody>
          <LineSetupForm action={configureSharedLineAction} defaultName={channel?.name} />
        </CardBody>
      </Card>
    </>
  );
}
