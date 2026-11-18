import type { ReactNode } from 'react';
import { ActionForm } from './action-form';
import { Field, Input, Select } from './ui';
import type { ActionState } from './form';

/** 設定 LINE 官方帳號的步驟說明與表單（平台共用帳號、社區自有帳號共用） */
export function LineSetupForm({ action, defaultName, extra }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; defaultName?: string; extra?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
        <li>
          在 <a className="text-brand-700 underline" href="https://manager.line.biz/" target="_blank" rel="noreferrer">LINE Official Account Manager</a> 建立或選擇專供包裹通知的官方帳號，從「設定 → Messaging API」啟用服務，並選擇這個品牌的 Provider。若已顯示「使用中」或 Channel ID，直接到同一個 Provider 核對該 Channel ID。
        </li>
        <li>使用相同帳號登入 <a className="text-brand-700 underline" href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers</a>，開啟剛建立的 channel，在 <b>Basic settings</b> 分頁，複製 <b>Channel secret</b>。</li>
        <li>在 <b>Messaging API</b> 分頁最下方，找到 <b>Channel access token (long-lived)</b>。已有 token 時直接複製，首次發行才按 <b>Issue</b>。Reissue 會使原 token 失效。</li>
        <li>在受 Vercel 登入保護的 Preview 選擇「僅儲存」。儲存後請核對顯示的帳號名稱與 Basic ID。待網站可公開接收 LINE 請求，再用已儲存的帳號測試並設定 Webhook。</li>
        <li>
          建議到 <b>LINE Official Account Manager</b> → 回應設定，把「自動回應訊息」關閉、「Webhook」開啟，避免住戶收到兩次回覆。
        </li>
      </ol>
      <ActionForm action={action} submitLabel="儲存帳號">
        <Field label="名稱（後台顯示用）">
          <Input name="name" defaultValue={defaultName} placeholder="例如：幸福社區包裹通知" />
        </Field>
        <Field label="Channel secret" hint="32 個英數字">
          <Input name="channelSecret" type="password" required autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Channel access token (long-lived)">
          <Input name="accessToken" type="password" required autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Webhook 設定方式" hint="公開站會先請 LINE 測試候選網址，確認可達且原設定安全後才會寫入。">
          <Select name="webhookMode" defaultValue="save">
            <option value="save">僅儲存（受保護的 Preview）</option>
            <option value="install">儲存後測試並設定本站 Webhook</option>
          </Select>
        </Field>
        {extra}
      </ActionForm>
    </div>
  );
}
