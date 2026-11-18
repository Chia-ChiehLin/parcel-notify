import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandName, serviceContact } from '@/lib/env';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const contact = serviceContact();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-800">
        ← {brandName()}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-gray-500">最後更新：{updated}</p>
      <div className="prose mt-8 space-y-5 text-[15px] leading-relaxed text-gray-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      <footer className="mt-8 border-t border-gray-200 pt-4 text-sm text-gray-700">
        {contact.operator && <p>服務提供者：{contact.operator}</p>}
        {contact.email ? <a className="underline" href={`mailto:${contact.email}`}>客服與個資聯絡信箱：{contact.email}</a> : <p>服務問題與個資申請可由所屬社區管理室受理，並轉交服務提供者。</p>}
      </footer>
    </div>
  );
}
