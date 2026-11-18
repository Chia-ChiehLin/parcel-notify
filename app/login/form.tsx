'use client';

import { useActionState } from 'react';
import { loginAction } from '@/actions/auth';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input } from '@/components/ui';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="密碼">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" size="lg">
        登入
      </SubmitButton>
    </form>
  );
}
