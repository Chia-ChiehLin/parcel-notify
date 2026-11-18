'use client';

import { buttonClass } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl">⚠️</div>
      <h1 className="mt-4 text-2xl font-bold">發生錯誤</h1>
      <p className="mt-2 text-gray-500">請重新整理再試一次。如果持續發生，請聯絡客服並提供錯誤代碼。</p>
      {error.digest ? <p className="mt-1 font-mono text-xs text-gray-400">錯誤代碼：{error.digest}</p> : null}
      <button onClick={reset} className={buttonClass('primary', 'md', 'mt-6')}>
        再試一次
      </button>
    </div>
  );
}
