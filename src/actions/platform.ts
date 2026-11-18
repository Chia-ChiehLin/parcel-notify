'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import type { CommunityStatus, MembershipRole } from '@/db/schema';
import { requirePlatformAdmin, actorFor } from '@/auth/session';
import { deleteUserSessions } from '@/auth/core';
import { addBillingRecord } from '@/domain/billing';
import {
  createCommunity,
  createOrganization,
  getCommunityWithPlan,
  setCommunityStatus,
  updateCommunityPlan,
  updateOrganization,
} from '@/domain/communities';
import { configureChannel, getSavedSharedChannel, getSharedChannel, initializeSavedWebhook, verifyInstalledWebhook } from '@/domain/line-channels';
import { installRichMenu } from '@/line/rich-menu';
import { createResetLinkForUser, inviteByPlatform } from '@/domain/staff';
import { DomainError } from '@/domain/types';
import type { ActionState } from '@/components/form';
import { bool, errorMessage, num, run, str } from './util';

async function admin() {
  const user = await requirePlatformAdmin();
  return { user, actor: { ...(await actorFor(user)), id: user.id } };
}

export async function createCommunityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const adminEmail = str(fd, 'adminEmail');
    if (adminEmail && !z.email().safeParse(adminEmail).success) throw new DomainError('請輸入有效的社區管理者 Email');
    const lineMode = str(fd, 'lineMode') || 'shared';
    if (lineMode !== 'shared' && lineMode !== 'own') throw new DomainError('請選擇要使用的 LINE 帳號');
    const trialDays = Number(str(fd, 'trialDays') || 14);
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) throw new DomainError('試用天數須為 0 至 90 的整數');
    const planId = str(fd, 'planId');
    const orgId = str(fd, 'orgId') || null;
    if (!z.uuid().safeParse(planId).success) throw new DomainError('請選擇方案');
    if (orgId && !z.uuid().safeParse(orgId).success) throw new DomainError('請選擇所屬物業公司');
    const [plan] = await db().select({ active: schema.plans.isActive }).from(schema.plans).where(eq(schema.plans.id, planId));
    if (!plan?.active) throw new DomainError('方案已停用或不存在，請重新選擇');
    const community = await createCommunity(actor, {
      orgId,
      orgName: str(fd, 'orgName') || null,
      name: str(fd, 'name'),
      slug: str(fd, 'slug'),
      address: str(fd, 'address'),
      planId,
      trialDays,
      lineMode,
    });
    let invite: { url: string; emailed: boolean } | null = null;
    let inviteError: string | null = null;
    if (adminEmail) {
      try {
        invite = await inviteByPlatform(actor, {
          email: adminEmail,
          name: str(fd, 'adminName'),
          role: 'community_admin',
          communityId: community.id,
          where: community.name,
        });
      } catch (err) {
        // 客戶已建立。保留客戶連結，讓服務商直接補發邀請。
        inviteError = errorMessage(err);
      }
    }
    revalidatePath('/admin/communities');
    return {
      ok: true,
      message: `已建立社區「${community.name}」`,
      data: { communityId: community.id, slug: community.slug, inviteUrl: invite?.url ?? null, emailed: invite?.emailed ?? false, inviteError },
    };
  });
}

export async function updateCommunityPlanAction(communityId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const trial = str(fd, 'trialEndsAt');
    await updateCommunityPlan(actor, communityId, {
      planId: str(fd, 'planId'),
      trialEndsAt: trial ? new Date(`${trial}T23:59:59+08:00`) : null,
      paidUntil: str(fd, 'paidUntil') || null,
      orgId: str(fd, 'orgId') || undefined,
    });
    revalidatePath(`/admin/communities/${communityId}`);
    return { ok: true, message: '已更新方案與期限' };
  });
}

export async function setCommunityStatusAction(communityId: string, status: CommunityStatus) {
  const { actor } = await admin();
  await setCommunityStatus(actor, communityId, status, '平台管理員手動變更');
  revalidatePath(`/admin/communities/${communityId}`);
  revalidatePath('/admin/communities');
}

export async function addBillingAction(communityId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const res = await addBillingRecord(actor, communityId, {
      amount: num(fd, 'amount', -1),
      periodStart: str(fd, 'periodStart'),
      periodEnd: str(fd, 'periodEnd'),
      paidAt: str(fd, 'paidAt'),
      method: str(fd, 'method'),
      invoiceNo: str(fd, 'invoiceNo'),
      note: str(fd, 'note'),
    });
    revalidatePath(`/admin/communities/${communityId}`);
    revalidatePath('/admin/billing');
    return { ok: true, message: `已記錄收款，付費期限延長到 ${res.paidUntil}` };
  });
}

export async function inviteCommunityAdminAction(communityId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const { community } = await getCommunityWithPlan(communityId);
    const role = (str(fd, 'role') || 'community_admin') as MembershipRole;
    if (role !== 'community_admin' && role !== 'staff') throw new DomainError('角色不正確');
    const res = await inviteByPlatform(actor, { email: str(fd, 'email'), name: str(fd, 'name'), role, communityId, where: community.name });
    return { ok: true, message: res.emailed ? '已寄出邀請信' : '已建立邀請連結（Email 未設定，請複製連結交給對方）', data: { inviteUrl: res.url } };
  });
}

export async function saveOrgAction(orgId: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await admin();
    const input = {
      name: str(fd, 'name'),
      contactName: str(fd, 'contactName'),
      contactEmail: str(fd, 'contactEmail'),
      contactPhone: str(fd, 'contactPhone'),
      note: str(fd, 'note'),
    };
    if (orgId) await updateOrganization(orgId, input);
    else await createOrganization(input);
    revalidatePath('/admin/orgs');
    return { ok: true, message: orgId ? '已儲存' : '已新增物業公司' };
  });
}

export async function inviteOrgAdminAction(orgId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    if (!org) throw new DomainError('找不到公司');
    const res = await inviteByPlatform(actor, { email: str(fd, 'email'), name: str(fd, 'name'), role: 'org_admin', orgId, where: org.name });
    return { ok: true, message: res.emailed ? '已寄出邀請信' : '已建立邀請連結', data: { inviteUrl: res.url } };
  });
}

export async function savePlanAction(planId: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await admin();
    const values = {
      code: str(fd, 'code').toLowerCase(),
      name: str(fd, 'name'),
      maxUnits: Math.max(1, num(fd, 'maxUnits', 100)),
      maxStaff: Math.max(1, num(fd, 'maxStaff', 5)),
      monthlyPrice: Math.max(0, num(fd, 'monthlyPrice', 0)),
      sortOrder: num(fd, 'sortOrder', 0),
      isActive: bool(fd, 'isActive'),
      features: { email: bool(fd, 'fEmail'), photos: bool(fd, 'fPhotos'), sms: false, ownLine: bool(fd, 'fOwnLine') },
    };
    if (!/^[a-z0-9-]{2,30}$/.test(values.code)) throw new DomainError('方案代碼只能用小寫英文、數字和連字號');
    if (!values.name) throw new DomainError('請輸入方案名稱');
    if (planId) await db().update(schema.plans).set(values).where(eq(schema.plans.id, planId));
    else await db().insert(schema.plans).values(values);
    revalidatePath('/admin/plans');
    return { ok: true, message: '已儲存方案' };
  });
}

export async function configureSharedLineAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const res = await configureChannel(actor, {
      communityId: null, setupWebhook: str(fd, 'webhookMode') === 'install',
      name: str(fd, 'name'),
      channelSecret: str(fd, 'channelSecret'),
      accessToken: str(fd, 'accessToken'),
    });
    revalidatePath('/admin/line');
    return { ok: true, message: `已儲存「${res.channel.displayName}」（${res.channel.basicId}）。${res.setup.message}` };
  });
}

export async function installSharedRichMenuAction(): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const channel = await getSharedChannel();
    if (!channel) throw new DomainError('請先設定共用 LINE 帳號');
    await installRichMenu(actor, channel);
    revalidatePath('/admin/line');
    return { ok: true, message: '已建立圖文選單，住戶重新開啟聊天室即可看到' };
  });
}

export async function createResetLinkAction(userId: string): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const url = await createResetLinkForUser(actor, userId);
    return { ok: true, message: '已產生重設密碼連結（24 小時有效）', data: { url } };
  });
}

export async function toggleUserStatusAction(userId: string) {
  const { user } = await admin();
  if (user.id === userId) return;
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return;
  const status = u.status === 'active' ? 'disabled' : 'active';
  await db().update(schema.users).set({ status }).where(eq(schema.users.id, userId));
  if (status === 'disabled') await deleteUserSessions(userId);
  revalidatePath('/admin/users');
}

export async function verifySharedWebhookAction(): Promise<ActionState> {
  return run(async () => {
    await admin();
    const channel = await getSavedSharedChannel();
    if (!channel) throw new DomainError('請先設定平台共用帳號。');
    await verifyInstalledWebhook(channel);
    return { ok: true, message: 'LINE 已啟用 Webhook，本站已收到驗證請求。下一步可用測試住戶確認收件通知。' };
  });
}

export async function initializeSharedWebhookAction(): Promise<ActionState> {
  return run(async () => {
    const { actor } = await admin();
    const setup = await initializeSavedWebhook(actor, null);
    revalidatePath('/admin/line');
    return setup.state === 'ready' ? { ok: true, message: setup.message } : { error: setup.message };
  });
}
