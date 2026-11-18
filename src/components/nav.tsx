'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cx } from './ui';

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cx(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-brand-50 text-brand-800' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      {children}
    </Link>
  );
}

export function MobileNav({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="no-print lg:hidden">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <span className="truncate font-semibold text-gray-900">{title}</span>
        <button onClick={() => setOpen(true)} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300" aria-label="開啟選單">
          選單
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          {/* 點選任何連結就關閉選單 */}
          <div className="relative flex h-full w-72 flex-col bg-white shadow-xl" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
