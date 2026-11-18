'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotAction } from '@/actions/auth';
import { FormMessage, SubmitButton } from '@/components/form';
import { Field, Input } from '@/components/ui';

export default function ForgotPage() {
  const [state, action] = useActionState(forgotAction, null);
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">忘記密碼</h1>
        <p className="mt-1 text-sm text-gray-500">輸入登入用的 Email，我們會寄重設密碼的連結給你。</p>
        <form action={action} className="mt-6 space-y-4">
          <Field label="Email">
            <Input name="email" type="email" required autoFocus />
          </Field>
          <FormMessage state={state} />
          <SubmitButton className="w-full">寄出重設連結</SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          沒收到信？請聯絡社區管理者或服務商協助。
          <br />
          <Link href="/login" className="text-brand-700 hover:underline">
            回到登入
          </Link>
        </p>
      </div>
    </div>
  );
}
