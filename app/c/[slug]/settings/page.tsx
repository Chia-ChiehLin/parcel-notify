import { requireCommunity } from '@/auth/session';
import { saveListsAction, saveNotifySettingsAction, saveProfileAction, saveRetentionAction } from '@/actions/community';
import { ActionForm } from '@/components/action-form';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: '社區設定' };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireCommunity(slug, 'community_admin');
  const s = ctx.settings;
  const c = ctx.community;
  return (
    <>
      <PageHeader title="社區設定" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="基本資料" description="管理室電話與服務時間會顯示在住戶的通知裡" />
          <CardBody>
            <ActionForm action={saveProfileAction.bind(null, slug)}>
              <Field label="社區名稱">
                <Input name="name" defaultValue={c.name} required />
              </Field>
              <Field label="地址">
                <Input name="address" defaultValue={c.address ?? ''} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="管理室電話">
                  <Input name="deskPhone" defaultValue={s.deskPhone} placeholder="02-1234-5678" />
                </Field>
                <Field label="領取時間">
                  <Input name="deskHours" defaultValue={s.deskHours} placeholder="07:00–23:00" />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="通知與提醒" description="LINE 推播每則都會計入官方帳號的月額度" />
          <CardBody>
            <ActionForm action={saveNotifySettingsAction.bind(null, slug)}>
              <div className="grid grid-cols-3 gap-3">
                <Field label="逾期天數" hint="超過幾天算逾期">
                  <Input name="overdueDays" type="number" min={1} max={60} defaultValue={s.overdueDays} />
                </Field>
                <Field label="提醒間隔（天）">
                  <Input name="reminderIntervalDays" type="number" min={1} max={30} defaultValue={s.reminderIntervalDays} />
                </Field>
                <Field label="最多提醒次數" hint="0 = 不提醒">
                  <Input name="maxReminders" type="number" min={0} max={10} defaultValue={s.maxReminders} />
                </Field>
              </div>
              <div className="space-y-1">
                <Checkbox name="notifyAllMembers" defaultChecked={s.notifyAllMembers} label="同戶所有成員都推播" hint="關閉時只推播主要聯絡人，其他成員可在 LINE 輸入「我的包裹」查詢（不計費）" />
                <Checkbox name="notifyOnPickup" defaultChecked={s.notifyOnPickup} label="領取後推播確認訊息" hint="可防止冒領，但每次交付都會多一則推播" />
                <Checkbox name="emailFallback" defaultChecked={s.emailFallback} label="LINE 送不到時改寄 Email" hint="僅適用已同意、已驗證信箱，並選擇「只在 LINE 無法送達時寄 Email」的住戶。" />
                <Checkbox name="requireSignature" defaultChecked={s.requireSignature} label="交付時要求簽名" />
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="物流商與存放位置" description="收件登記時的選單，每行一項" />
          <CardBody>
            <ActionForm action={saveListsAction.bind(null, slug)}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="物流商">
                  <Textarea name="carriers" rows={10} defaultValue={s.carriers.join('\n')} />
                </Field>
                <Field label="存放位置">
                  <Textarea name="storageLocations" rows={10} defaultValue={s.storageLocations.join('\n')} />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="資料保留（個資保護）" description="超過期限的資料會在每天的排程自動刪除" />
          <CardBody>
            <ActionForm action={saveRetentionAction.bind(null, slug)}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="包裹紀錄保留天數" hint="30–3650 天，待領取的包裹不會被刪">
                  <Input name="retentionDays" type="number" min={30} max={3650} defaultValue={s.retentionDays} />
                </Field>
                <Field label="照片與簽名保留天數" hint="從領取或結案後起算">
                  <Input name="photoRetentionDays" type="number" min={1} max={365} defaultValue={s.photoRetentionDays} />
                </Field>
              </div>
              <p className="text-xs text-gray-500">稽核紀錄至少保留一年，以便處理包裹爭議。</p>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
