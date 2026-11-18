import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandName } from '@/lib/env';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-800">
        ← {brandName()}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-gray-500">最後更新：{updated}</p>
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        這是範本內容，正式營運前請依你的公司資料修改，並建議請律師審閱。
      </div>
      <div className="prose mt-8 space-y-5 text-[15px] leading-relaxed text-gray-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </div>
  );
}
