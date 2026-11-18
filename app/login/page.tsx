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
    <AuthShell title="登入" subtitle="管理室、社區管理者與物業公司登入" footer={<Link href="/forgot" className="hover:text-gray-800">忘記密碼？</Link>}>
      <LoginForm next={next ?? ''} />
    </AuthShell>
  );
}
