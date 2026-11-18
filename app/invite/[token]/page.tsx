import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { findValidAuthToken } from '@/auth/core';
import { ROLE_LABELS } from '@/auth/access';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui';
import { InviteForm } from './form';

export const metadata = { title: '接受邀請' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findValidAuthToken(token, 'invite');
  if (!invite) {
    return (
      <AuthShell title="邀請已失效">
        <Alert tone="warning">這個邀請連結無效、已使用或已過期（72 小時），請聯絡管理者重新邀請。</Alert>
      </AuthShell>
    );
  }
  let where = '';
  if (invite.payload.communityId) {
    const [c] = await db().select({ name: schema.communities.name }).from(schema.communities).where(eq(schema.communities.id, invite.payload.communityId));
    where = c?.name ?? '';
  } else if (invite.payload.orgId) {
    const [o] = await db().select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, invite.payload.orgId));
    where = o?.name ?? '';
  }
  const [existing] = await db().select({ hasPassword: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.email, invite.email));
  const roleLabel = invite.payload.role ? ROLE_LABELS[invite.payload.role] : '';
  return (
    <AuthShell title={`加入「${where}」`} subtitle={`${invite.email}・${roleLabel}`}>
      <InviteForm token={token} existing={!!existing?.hasPassword} defaultName={invite.payload.name ?? ''} />
    </AuthShell>
  );
}
