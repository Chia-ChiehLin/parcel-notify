import { requirePlatformAdmin } from '@/auth/session';
import { listOrganizations, listPlans } from '@/domain/communities';
import { PageHeader } from '@/components/ui';
import { NewCommunityForm } from './form';

export const metadata = { title: '開通新社區' };
export const dynamic = 'force-dynamic';

export default async function NewCommunityPage() {
  await requirePlatformAdmin();
  const [plans, orgs] = await Promise.all([listPlans(true), listOrganizations()]);
  return (
    <>
      <PageHeader title="開通新社區" back={{ href: '/admin/communities', label: '社區客戶' }} description="建立社區後台，並邀請社區管理者（總幹事、主委）設定密碼。" />
      <NewCommunityForm plans={plans.map((p) => ({ id: p.id, name: p.name, maxUnits: p.maxUnits, price: p.monthlyPrice }))} orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
    </>
  );
}
