import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutAction } from '@/actions/auth';
import { brandName } from '@/lib/env';
import { Logo } from './logo';
import { MobileNav, NavLink } from './nav';

export type NavItem = { href: string; label: string; icon: string; exact?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

export function AppShell({
  groups,
  title,
  subtitle,
  userName,
  userRole,
  switcher,
  banner,
  children,
}: {
  groups: NavGroup[];
  title: string;
  subtitle?: string;
  userName: string;
  userRole: string;
  switcher?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g, i) => (
        <div key={i}>
          {g.title ? <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{g.title}</div> : null}
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavLink key={item.href} href={item.href} exact={item.exact}>
                <span className="w-5 text-center" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  const user = (
    <div className="border-t border-gray-200 p-3">
      <div className="px-3 text-sm font-medium text-gray-900">{userName}</div>
      <div className="px-3 text-xs text-gray-500">{userRole}</div>
      <form action={logoutAction} className="mt-2">
        <button className="w-full rounded-md px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-100">登出</button>
      </form>
    </div>
  );
  const header = (
    <div className="border-b border-gray-200 px-4 py-4">
      <Link href="/" className="flex items-center gap-2">
        <Logo className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-gray-900">{title}</div>
          <div className="truncate text-xs text-gray-500">{subtitle ?? brandName()}</div>
        </div>
      </Link>
      {switcher ? <div className="mt-3">{switcher}</div> : null}
    </div>
  );
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen">
        {header}
        {nav}
        {user}
      </aside>
      <MobileNav title={title}>
        {header}
        {nav}
        {user}
      </MobileNav>
      <main className="min-w-0 flex-1">
        {banner}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
