'use client';

import { useState, type ReactNode } from 'react';
import type { ActionState } from './form';
import { CopyLink } from './action-form';
import { Alert, Button } from './ui';

/** 按鈕觸發 action，並在下方顯示結果訊息（例如產生連結、建立圖文選單） */
export function StateButton({
  action,
  children,
  variant = 'secondary',
  confirm,
}: {
  action: () => Promise<ActionState>;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: string;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, setPending] = useState(false);
  const link = (state?.data?.url ?? state?.data?.inviteUrl) as string | undefined;
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={pending}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setPending(true);
          try {
            setState(await action());
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? '處理中…' : children}
      </Button>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      {link ? <CopyLink url={link} /> : null}
    </div>
  );
}
