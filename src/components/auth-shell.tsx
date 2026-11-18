import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandName } from '@/lib/env';
import { Logo } from './logo';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-gray-50 px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-brand-800">
        <Logo className="h-9 w-9" />
        <span className="text-xl font-bold">{brandName()}</span>
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <div className="mt-6 text-sm text-gray-500">{footer}</div> : null}
    </div>
  );
}
