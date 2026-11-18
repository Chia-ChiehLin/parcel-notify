import { findValidAuthToken } from '@/auth/core';
import { AuthShell } from '@/components/auth-shell';
import { Alert, LinkButton } from '@/components/ui';
import { ResetForm } from './form';

export const metadata = { title: '重設密碼' };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await findValidAuthToken(token, 'reset');
  if (!row) {
    return (
      <AuthShell title="連結已失效">
        <Alert tone="warning">這個重設密碼連結無效或已過期，請重新申請。</Alert>
        <LinkButton href="/forgot" className="mt-4 w-full">
          重新申請
        </LinkButton>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="設定新密碼" subtitle={row.email}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
