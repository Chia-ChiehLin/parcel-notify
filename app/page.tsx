import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/session';
import { listAccessibleCommunities, listOrgAdminOrgIds } from '@/auth/access';
import { Logo } from '@/components/logo';
import { buttonClass } from '@/components/ui';
import { brandName } from '@/lib/env';
import { logoutAction } from '@/actions/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) return <Landing />;
  if (user.isPlatformAdmin) redirect('/admin');
  const communities = await listAccessibleCommunities(user);
  const orgIds = await listOrgAdminOrgIds(user.id);
  if (orgIds.length) redirect('/org');
  if (communities.length === 1) redirect(`/c/${communities[0].slug}`);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold">選擇社區</h1>
      {communities.length === 0 ? (
        <p className="mt-4 text-gray-600">你的帳號目前沒有加入任何社區。請聯絡社區管理者邀請你。</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {communities.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="block rounded-xl border border-gray-200 bg-white px-5 py-4 font-medium shadow-sm hover:border-brand-400">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form action={logoutAction} className="mt-8">
        <button className="text-sm text-gray-500 hover:text-gray-800">登出</button>
      </form>
    </div>
  );
}

function Landing() {
  const features = [
    ['📦 平板快速登記', '輸入戶號、掃描條碼、拍照，一次登記多件，同一戶自動合併成一則通知。'],
    ['💬 LINE 即時通知', '住戶掃綁定卡就能完成綁定，包裹一到馬上收到通知卡片。'],
    ['🔐 QR code 領取', '住戶出示取件 QR，管理室掃描交付，全程留下紀錄，減少冒領與爭議。'],
    ['⏰ 逾期自動提醒', '超過天數未領自動提醒，管理室一眼看到逾期清單。'],
    ['🏢 多社區管理', '物業公司可以同時管理旗下所有社區，跨社區看報表。'],
    ['📊 報表與稽核', '收件量、領取時間、物流商統計，所有操作都有稽核紀錄可查。'],
  ];
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 text-brand-800">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-bold">{brandName()}</span>
        </div>
        <Link href="/login" className={buttonClass('secondary', 'md')}>
          登入
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-10">
        <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight text-gray-900 sm:text-5xl">讓管理室收包裹，變得簡單又不出錯</h1>
        <p className="mt-5 max-w-xl text-lg text-gray-600">包裹登記、LINE 通知、QR code 領取、逾期提醒，一套系統全部搞定。專為台灣社區大樓與物業公司設計。</p>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className={buttonClass('primary', 'lg')}>
            登入管理後台
          </Link>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="font-semibold text-gray-900">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{d}</p>
            </div>
          ))}
        </div>
      </main>
      <footer className="border-t border-gray-100 py-6 text-center text-sm text-gray-500">
        <Link href="/privacy" className="hover:text-gray-800">
          隱私權政策
        </Link>
        <span className="mx-3">・</span>
        <Link href="/terms" className="hover:text-gray-800">
          服務條款
        </Link>
      </footer>
    </div>
  );
}
