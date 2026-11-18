'use client';

import { useActionState } from 'react';
import { setupAction } from '@/actions/auth';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input } from '@/components/ui';

export function SetupForm() {
  const [state, action] = useActionState(setupAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="設定碼" hint="Vercel 環境變數 SETUP_TOKEN 的值">
        <Input name="token" type="password" required autoFocus />
      </Field>
      <Field label="你的姓名">
        <Input name="name" required />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="密碼" hint="至少 8 個字元，需包含英文字母和數字">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="再輸入一次">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">建立</SubmitButton>
    </form>
  );
}
