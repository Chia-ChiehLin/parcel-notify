import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ───────────────────────────── 按鈕 ─────────────────────────────

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm disabled:bg-brand-700/50',
  secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 shadow-sm disabled:text-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm disabled:bg-red-600/50',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
  ghost: 'text-gray-700 hover:bg-gray-100',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-5 text-base rounded-lg',
  xl: 'h-16 px-6 text-lg rounded-xl',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed whitespace-nowrap',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant = 'secondary', size = 'md', className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ───────────────────────────── 表單 ─────────────────────────────

const fieldBase =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-gray-100';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(fieldBase, 'h-10 text-sm', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(fieldBase, 'py-2 text-sm', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(fieldBase, 'h-10 text-sm pr-8', className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, hint, ...props }: ComponentProps<'input'> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 py-1">
      <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-gray-300 text-brand-700 focus:ring-brand-500" {...props} />
      <span>
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        {hint ? <span className="block text-xs text-gray-500">{hint}</span> : null}
      </span>
    </label>
  );
}

// ───────────────────────────── 版面 ─────────────────────────────

export function Card({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cx('rounded-xl border border-gray-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back ? (
          <Link href={back.href} className="mb-1 inline-block text-sm text-gray-500 hover:text-gray-800">
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

type Tone = 'gray' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'brand';
const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 ring-gray-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>{children}</span>;
}

const ALERT_TONES = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof ALERT_TONES; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm', ALERT_TONES[tone], className)} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-base font-semibold text-gray-800">{title}</div>
      {description ? <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'gray', href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gray' | 'red' | 'brand' | 'amber'; href?: string }) {
  const color = { gray: 'text-gray-900', red: 'text-red-600', brand: 'text-brand-700', amber: 'text-amber-600' }[tone];
  const inner = (
    <>
      <div className="text-sm text-gray-500">{label}</div>
      <div className={cx('mt-1 text-3xl font-bold tabular', color)}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-gray-500">{sub}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">{inner}</div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-gray-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('whitespace-nowrap bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500', className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('px-4 py-3 align-middle text-gray-800', className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
      <span>
        共 {total} 筆，第 {page}/{pages} 頁
      </span>
      <div className="flex gap-2">
        {page > 1 ? <LinkButton size="sm" href={hrefFor(page - 1)}>上一頁</LinkButton> : null}
        {page < pages ? <LinkButton size="sm" href={hrefFor(page + 1)}>下一頁</LinkButton> : null}
      </div>
    </div>
  );
}
