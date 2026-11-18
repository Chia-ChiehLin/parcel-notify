'use client';

import { useActionState, useState } from 'react';
import { unbindAction, updatePrefsAction } from '@/actions/resident';
import { FormMessage, SubmitButton } from '@/components/form';
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';

export function SettingsForm({
  token,
  hasLine,
  defaults,
  languages,
  labels,
}: {
  token: string;
  hasLine: boolean;
  defaults: { notifyLine: boolean; notifyEmail: boolean; email: string; language: string };
  languages: { code: string; label: string }[];
  labels: { notifyLine: string; notifyEmail: string; email: string; language: string; save: string };
}) {
  const [state, action] = useActionState(updatePrefsAction.bind(null, token), null);
  return (
    <form action={action} className="space-y-3">
      {hasLine ? <Checkbox name="notifyLine" label={labels.notifyLine} defaultChecked={defaults.notifyLine} /> : null}
      <Checkbox name="notifyEmail" label={labels.notifyEmail} defaultChecked={defaults.notifyEmail} />
      <Field label={labels.email}>
        <Input name="email" type="email" defaultValue={defaults.email} placeholder="name@example.com" />
      </Field>
      <Field label={labels.language}>
        <Select name="language" defaultValue={defaults.language}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">{labels.save}</SubmitButton>
    </form>
  );
}

export function UnbindButton({ token, label, confirmText }: { token: string; label: string; confirmText: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (msg) return <Alert tone="success">{msg}</Alert>;
  return (
    <Button
      variant="ghost"
      className="w-full text-red-600"
      onClick={async () => {
        if (!window.confirm(confirmText)) return;
        const res = await unbindAction(token);
        setMsg(res?.message ?? res?.error ?? '');
      }}
    >
      {label}
    </Button>
  );
}
