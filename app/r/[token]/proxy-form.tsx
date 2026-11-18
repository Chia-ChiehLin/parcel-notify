'use client';

import { useActionState } from 'react';
import { createProxyAction } from '@/actions/resident';
import { SubmitButton } from '@/components/form';
import { Alert, Input } from '@/components/ui';

export function ProxyForm({ token, labels }: { token: string; labels: { name: string; create: string; code: string; expires: string } }) {
  const [state, action] = useActionState(createProxyAction.bind(null, token), null);
  return (
    <form action={action} className="mt-3 space-y-2">
      <Input name="proxyName" placeholder={labels.name} maxLength={30} />
      <SubmitButton variant="secondary" className="w-full">
        {labels.create}
      </SubmitButton>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.data?.code ? (
        <div className="rounded-lg bg-brand-50 p-3 text-center">
          <div className="text-xs text-brand-800">{labels.code}</div>
          <div className="font-mono text-3xl font-bold tracking-[0.2em] text-brand-900">{String(state.data.code)}</div>
        </div>
      ) : null}
    </form>
  );
}
