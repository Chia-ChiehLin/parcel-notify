'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const desktop = window.matchMedia('(min-width: 64rem)');
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close(); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [open]);
  return (
    <div className="no-print sticky top-0 z-30 lg:hidden">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1.5">
        <span className="truncate font-semibold text-gray-900">{title}</span>
        <button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-gray-700 ring-1 ring-gray-300" aria-label="開啟選單">
          選單
        </button>
      </div>
      {open ? (
        <dialog
          ref={dialog}
          aria-label="導覽選單"
          onClose={() => setOpen(false)}
          onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}
          className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/30"
        >
          <div className="flex h-full w-72 max-w-[90vw] flex-col bg-white shadow-xl" onClick={(e) => { if ((e.target as Element).closest('a')) dialog.current?.close(); }}>
            <button type="button" autoFocus onClick={() => dialog.current?.close()} className="self-end px-4 py-3 text-sm font-medium">關閉選單</button>
            {children}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
