import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/session';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './form';

export const metadata = { title: '登入' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect('/');
  const { next } = await searchParams;
  return (
    <AuthShell title="登入" subtitle="管理室、社區管理者與物業公司登入" footer={<div className="flex flex-wrap justify-center gap-5"><Link href="/forgot" className="hover:text-gray-800">忘記密碼？</Link><Link href="/product" className="hover:text-gray-800">認識包裹管理服務</Link></div>}>
      <LoginForm next={next ?? ''} />
    </AuthShell>
  );
}
