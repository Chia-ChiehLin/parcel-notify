'use client';

import { useActionState } from 'react';
import { acceptInviteAction } from '@/actions/auth';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input } from '@/components/ui';

export function InviteForm({ token, existing, defaultName }: { token: string; existing: boolean; defaultName: string }) {
  const [state, action] = useActionState(acceptInviteAction.bind(null, token), null);
  return (
    <form action={action} className="space-y-4">
      {existing ? (
        <p className="text-sm text-gray-600">你已經有帳號了，輸入原本的密碼即可加入。</p>
      ) : (
        <Field label="你的姓名">
          <Input name="name" defaultValue={defaultName} required autoFocus />
        </Field>
      )}
      <Field label={existing ? '密碼' : '設定密碼'} hint={existing ? undefined : '至少 8 個字元，需包含英文字母和數字'}>
        <Input name="password" type="password" autoComplete={existing ? 'current-password' : 'new-password'} required minLength={8} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">{existing ? '加入' : '建立帳號並加入'}</SubmitButton>
    </form>
  );
}
