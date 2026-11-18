'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton, type ActionState } from './form';
import { Field, Input } from './ui';

export function EmailVerificationForm({ action, english = false, atDesk = false }: {
  action: (previous: ActionState, data: FormData) => Promise<ActionState>;
  english?: boolean;
  atDesk?: boolean;
}) {
  const [state, submit] = useActionState(action, null);
  return (
    <form action={submit} className="space-y-2 text-left">
      <Field label={english ? 'Email verification code' : 'Email 驗證碼'} hint={atDesk
        ? '核對住戶身分及本人同意後，再輸入住戶在現場出示的驗證碼。'
        : english ? 'Enter the 8-character code from your email to enable parcel notifications.' : '輸入信中的 8 碼驗證碼，確認信箱並同意接收包裹通知。'}>
        <Input name="code" type="text" autoComplete="one-time-code" autoCapitalize="characters" maxLength={8} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="operation" value="confirm" size="sm" pendingText={english ? 'Please wait…' : '處理中…'}>{english ? 'Confirm email' : '確認信箱'}</SubmitButton>
        <SubmitButton name="operation" value="resend" variant="secondary" size="sm" formNoValidate pendingText={english ? 'Please wait…' : '處理中…'}>{english ? 'Send a new code' : '重寄驗證碼'}</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
