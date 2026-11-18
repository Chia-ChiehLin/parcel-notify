import Link from 'next/link';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl">📦</div>
      <h1 className="mt-4 text-2xl font-bold">找不到這個頁面</h1>
      <p className="mt-2 text-gray-500">頁面不存在，或你的帳號沒有權限查看。</p>
      <Link href="/" className={buttonClass('primary', 'md', 'mt-6')}>
        回首頁
      </Link>
    </div>
  );
}
