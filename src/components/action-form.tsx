'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { FormMessage, SubmitButton, type ActionState } from './form';
import { Button, cx } from './ui';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** 一般用途的表單：送出 server action、顯示結果、可選擇成功後清空 */
export function ActionForm({
  action,
  children,
  submitLabel = '儲存',
  submitVariant = 'primary',
  resetOnSuccess = false,
  className,
  footer,
  inline = false,
}: {
  action: Action;
  children: ReactNode;
  submitLabel?: string;
  submitVariant?: 'primary' | 'secondary' | 'danger';
  resetOnSuccess?: boolean;
  className?: string;
  footer?: ReactNode;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const link = (state?.data?.inviteUrl ?? state?.data?.url) as string | undefined;
  return (
    <form ref={ref} action={formAction} className={cx(inline ? 'flex flex-wrap items-end gap-3' : 'space-y-4', className)}>
      {children}
      <div className={inline ? '' : 'flex flex-wrap items-center gap-3'}>
        <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
        {footer}
      </div>
      {inline ? <div className="basis-full" /> : null}
      <FormMessage state={state} />
      {link ? <CopyLink url={link} /> : null}
    </form>
  );
}

export function CopyLink({ url, label = '連結' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 text-xs font-medium text-gray-500">{label}（請複製後交給對方，不要公開張貼）</div>
      <div className="flex gap-2">
        <input readOnly value={url} className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? '已複製' : '複製'}
        </Button>
      </div>
    </div>
  );
}

/** 單一按鈕觸發的 action（例如狀態切換），可加確認視窗 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = 'secondary',
  size = 'sm',
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning';
  size?: 'sm' | 'md';
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setPending(true);
        try {
          await action();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? '處理中…' : children}
    </Button>
  );
}
