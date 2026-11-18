import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db, schema } from '@/db';
import { AuthShell } from '@/components/auth-shell';
import { SetupForm } from './form';

export const metadata = { title: '建立平台管理員' };
export const dynamic = 'force-dynamic';

/** 第一次部署後建立平台管理員。已經有平台管理員、或沒有設定 SETUP_TOKEN 時，這個頁面不存在。 */
export default async function SetupPage() {
  if (!process.env.SETUP_TOKEN) notFound();
  const [admin] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isPlatformAdmin, true)).limit(1);
  if (admin) notFound();
  return (
    <AuthShell title="建立平台管理員" subtitle="這是你（服務商）的總管理帳號，只需要建立一次。">
      <SetupForm />
    </AuthShell>
  );
}
