'use client';

import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';
import { Alert, Button } from './ui';

export type ActionState = { ok?: boolean; error?: string; message?: string; data?: Record<string, unknown> } | null;

export function SubmitButton({ children, pendingText = '處理中…', ...props }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** 送出前跳出確認（危險操作用） */
export function ConfirmSubmit({ message, children, ...props }: ComponentProps<typeof Button> & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    >
      {pending ? '處理中…' : children}
    </Button>
  );
}
