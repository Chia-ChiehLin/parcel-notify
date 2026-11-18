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
  fallbackAllowed,
  labels,
}: {
  token: string;
  hasLine: boolean;
  fallbackAllowed: boolean;
  defaults: { notifyLine: boolean; notifyEmail: boolean; emailFallbackOnly: boolean; email: string; language: string };
  languages: { code: string; label: string }[];
  labels: { notifyLine: string; notifyEmail: string; email: string; language: string; save: string };
}) {
  const [state, action] = useActionState(updatePrefsAction.bind(null, token), null);
  const [emailEnabled, setEmailEnabled] = useState(defaults.notifyEmail);
  return (
    <form action={action} className="space-y-3">
      {hasLine ? <Checkbox name="notifyLine" label={labels.notifyLine} defaultChecked={defaults.notifyLine} /> : null}
      <Checkbox name="notifyEmail" label={labels.notifyEmail} checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
      {hasLine && emailEnabled ? <Checkbox name="emailFallbackOnly" defaultChecked={defaults.emailFallbackOnly}
        label={defaults.language === 'en' ? 'Only email me when LINE cannot deliver' : '只在 LINE 無法送達時寄 Email'}
        hint={fallbackAllowed
          ? (defaults.language === 'en' ? 'With this option off, verified email receives arrival notices even when LINE delivers.' : '未勾選時，驗證過的 Email 也會收到每次到件通知。')
          : (defaults.language === 'en' ? 'Your community has turned off fallback. No emails will be sent in fallback-only mode.' : '社區目前關閉備援；選擇只收備援信時將不會寄送。')} /> : null}
      <Field label={labels.email}>
        <Input name="email" type="email" required={emailEnabled} defaultValue={defaults.email} placeholder="name@example.com" />
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
  const [state, action, pending] = useActionState(() => unbindAction(token), null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(confirmText)) e.preventDefault(); }}>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} variant="ghost" className="w-full text-red-600">{label}</Button>
    </form>
  );
}
