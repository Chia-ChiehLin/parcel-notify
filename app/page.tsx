import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/session';
import { listAccessibleCommunities, listOrgAdminOrgIds } from '@/auth/access';
import { logoutAction } from '@/actions/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/product');
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
