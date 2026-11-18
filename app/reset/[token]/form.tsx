'use client';

import { useActionState } from 'react';
import { resetAction } from '@/actions/auth';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input } from '@/components/ui';

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetAction.bind(null, token), null);
  return (
    <form action={action} className="space-y-4">
      <Field label="新密碼" hint="至少 8 個字元，需包含英文字母和數字">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="再輸入一次">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">儲存並登入</SubmitButton>
    </form>
  );
}
