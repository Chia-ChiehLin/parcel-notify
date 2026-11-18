'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LineMode } from '@/db/schema';
import { hasRole } from '@/auth/access';
import { requireCommunity } from '@/auth/session';
import {
  getCommunityWithPlan,
  markSetupCompleted,
  setLineMode,
  updateCommunityProfile,
  updateCommunitySettings,
} from '@/domain/communities';
import { configureChannel, getOwnChannel } from '@/domain/line-channels';
import { confirmResidentEmail, requestResidentEmailVerification, verificationMessage } from '@/domain/resident-email';
import { addEmailResident, removeResident, setPrimary, updateResidentPrefs } from '@/domain/residents';
import { changeStaffRole, inviteStaff, removeStaff, revokeInvite } from '@/domain/staff';
import { DomainError } from '@/domain/types';
import {
  createSingleUnit,
  createUnits,
  deleteUnit,
  generateUnitList,
  moveOut,
  parseUnitsCsv,
  rotateBindCode,
  updateUnit,
} from '@/domain/units';
import { installRichMenu } from '@/line/rich-menu';
import type { ActionState } from '@/components/form';
import { bool, num, run, str } from './util';

async function admin(slug: string) {
  const ctx = await requireCommunity(slug, 'community_admin');
  return { ctx, scope: { communityId: ctx.community.id, actor: ctx.actor } };
}

// ───────────────────────────── 戶別 ─────────────────────────────

type GeneratorInput = { buildings: string; floorFrom: number; floorTo: number; skipFloors: string; unitsPerFloor: number; unitNumbers: string; pattern: string };

function generatorList(input: GeneratorInput) {
  const split = (value: string) => value.split(/[,，、\s]+/).filter(Boolean);
  return generateUnitList({
    buildings: split(input.buildings),
    floorFrom: input.floorFrom,
    floorTo: input.floorTo,
    skipFloors: split(input.skipFloors).map(Number).filter(Number.isFinite),
    unitsPerFloor: input.unitsPerFloor,
    unitNumbers: split(input.unitNumbers),
    pattern: input.pattern,
  });
}

export async function previewUnitsAction(slug: string, input: GeneratorInput) {
  await admin(slug);
  try {
    const list = generatorList(input);
    return { ok: true as const, count: list.length, sample: list.slice(0, 12).map((u) => u.label), last: list.at(-1)?.label ?? '' };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : '產生失敗' };
  }
}

export async function generateUnitsAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const list = generatorList({
      buildings: str(fd, 'buildings'),
      floorFrom: num(fd, 'floorFrom', 1),
      floorTo: num(fd, 'floorTo', 1),
      skipFloors: str(fd, 'skipFloors'),
      unitsPerFloor: num(fd, 'unitsPerFloor', 0),
      unitNumbers: str(fd, 'unitNumbers'),
      pattern: str(fd, 'pattern') || '{b}-{f}-{u}',
    });
    const res = await createUnits(scope, list);
    revalidatePath(`/c/${slug}/units`);
    return { ok: true, message: `已新增 ${res.created} 戶${res.skipped ? `（${res.skipped} 戶已存在，略過）` : ''}` };
  });
}

export async function importUnitsAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const file = fd.get('file');
    let text = str(fd, 'csv');
    if (file instanceof File && file.size > 0) {
      if (file.size > 1024 * 1024) throw new DomainError('檔案太大（上限 1MB）');
      text = await file.text();
    }
    if (!text) throw new DomainError('請選擇 CSV 檔或貼上內容');
    const res = await createUnits(scope, parseUnitsCsv(text), 'unit.import');
    revalidatePath(`/c/${slug}/units`);
    return { ok: true, message: `已匯入 ${res.created} 戶${res.skipped ? `（${res.skipped} 戶已存在，略過）` : ''}` };
  });
}

export async function addUnitAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const floorRaw = str(fd, 'floor');
    const label = await createSingleUnit(scope, {
      building: str(fd, 'building'),
      floor: floorRaw ? Number(floorRaw) : null,
      number: str(fd, 'number'),
      label: str(fd, 'label'),
    });
    revalidatePath(`/c/${slug}/units`);
    return { ok: true, message: `已新增 ${label}` };
  });
}

export async function updateUnitAction(slug: string, unitId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    await updateUnit(scope, unitId, { label: str(fd, 'label'), status: str(fd, 'status') === 'vacant' ? 'vacant' : 'active', note: str(fd, 'note') });
    revalidatePath(`/c/${slug}/units/${unitId}`);
    return { ok: true, message: '已儲存' };
  });
}

export async function deleteUnitAction(slug: string, unitId: string) {
  const { scope } = await admin(slug);
  await deleteUnit(scope, unitId);
  redirect(`/c/${slug}/units`);
}

export async function rotateCodeAction(slug: string, unitId: string): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const code = await rotateBindCode(scope, unitId);
    revalidatePath(`/c/${slug}/units/${unitId}`);
    return { ok: true, message: `新的綁定碼：${code}（舊的綁定碼已失效，已綁定的住戶不受影響）` };
  });
}

export async function moveOutAction(slug: string, unitId: string): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const res = await moveOut(scope, unitId);
    revalidatePath(`/c/${slug}/units/${unitId}`);
    return { ok: true, message: `已移除 ${res.removed} 位住戶並更換綁定碼。請把新的綁定卡交給新住戶。` };
  });
}

// ───────────────────────────── 住戶 ─────────────────────────────

export async function removeResidentAction(slug: string, residentId: string) {
  const { scope } = await admin(slug);
  await removeResident(scope.actor, scope.communityId, residentId);
  revalidatePath(`/c/${slug}/residents`);
  revalidatePath(`/c/${slug}/units`, 'layout');
}

export async function setPrimaryAction(slug: string, residentId: string) {
  const { scope } = await admin(slug);
  await setPrimary(scope, residentId);
  revalidatePath(`/c/${slug}/units`, 'layout');
  revalidatePath(`/c/${slug}/residents`);
}

export async function addEmailResidentAction(slug: string, unitId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const { plan } = await getCommunityWithPlan(scope.communityId);
    if (!plan.features.email) throw new DomainError('目前方案不包含 Email 通知');
    if (!bool(fd, 'consent')) throw new DomainError('請先向住戶本人確認同意，再新增通知信箱');
    const resident = await addEmailResident(scope, { unitId, name: str(fd, 'name'), email: str(fd, 'email') });
    revalidatePath(`/c/${slug}/units/${unitId}`);
    const state = await requestResidentEmailVerification({ communityId: scope.communityId, residentId: resident.id, unitId });
    return { ok: true, message: '已新增住戶。' + verificationMessage(state) };
  });
}

export async function correctEmailResidentAction(slug: string, unitId: string, residentId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const result = await updateResidentPrefs(scope.communityId, residentId, {
      actor: scope.actor, emailOnlyUnitId: unitId, tokenVersion: Number(str(fd, 'version')),
      email: str(fd, 'email'), notifyEmail: bool(fd, 'consent'),
    });
    const state = result.requestCode ? await requestResidentEmailVerification({
      communityId: scope.communityId, unitId, residentId, tokenVersion: result.resident.tokenVersion,
    }) : null;
    revalidatePath(`/c/${slug}/units/${unitId}`);
    revalidatePath(`/c/${slug}/residents`);
    return { ok: true, message: '已更新住戶通知設定。' + (state ? verificationMessage(state) : '') };
  });
}

export async function verifyCommunityEmailAction(slug: string, unitId: string, residentId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const target = { communityId: scope.communityId, unitId, residentId };
    const state = str(fd, 'operation') === 'resend'
      ? await requestResidentEmailVerification(target)
      : await confirmResidentEmail(target, str(fd, 'code'), scope.actor);
    revalidatePath(`/c/${slug}/units/${unitId}`);
    revalidatePath(`/c/${slug}/residents`);
    const message = verificationMessage(state);
    return state === 'sent' || state === 'verified' ? { ok: true, message } : { error: message };
  });
}

// ───────────────────────────── 人員 ─────────────────────────────

export async function inviteStaffAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await admin(slug);
    const role = str(fd, 'role') === 'community_admin' ? 'community_admin' : 'staff';
    const res = await inviteStaff(
      { ...scope, communityName: ctx.community.name, invitedBy: ctx.user.id },
      { email: str(fd, 'email'), name: str(fd, 'name'), role },
    );
    revalidatePath(`/c/${slug}/staff`);
    return { ok: true, message: res.emailed ? '已寄出邀請信' : 'Email 尚未設定，請複製邀請連結交給對方（72 小時內有效）', data: { inviteUrl: res.url } };
  });
}

export async function removeStaffAction(slug: string, membershipId: string) {
  const { ctx, scope } = await admin(slug);
  await removeStaff({ ...scope, selfUserId: ctx.user.id }, membershipId);
  revalidatePath(`/c/${slug}/staff`);
}

export async function changeStaffRoleAction(slug: string, membershipId: string, role: 'staff' | 'community_admin') {
  const { ctx, scope } = await admin(slug);
  await changeStaffRole({ ...scope, selfUserId: ctx.user.id }, membershipId, role);
  revalidatePath(`/c/${slug}/staff`);
}

export async function revokeInviteAction(slug: string, inviteId: string) {
  const { scope } = await admin(slug);
  await revokeInvite(scope, inviteId);
  revalidatePath(`/c/${slug}/staff`);
}

// ───────────────────────────── 設定 ─────────────────────────────

export async function saveProfileAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    await updateCommunityProfile(scope.actor, scope.communityId, { name: str(fd, 'name'), address: str(fd, 'address') });
    await updateCommunitySettings(scope.actor, scope.communityId, { deskPhone: str(fd, 'deskPhone'), deskHours: str(fd, 'deskHours') });
    revalidatePath(`/c/${slug}`, 'layout');
    return { ok: true, message: '已儲存' };
  });
}

export async function saveNotifySettingsAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    await updateCommunitySettings(scope.actor, scope.communityId, {
      overdueDays: num(fd, 'overdueDays', 3),
      reminderIntervalDays: num(fd, 'reminderIntervalDays', 2),
      maxReminders: num(fd, 'maxReminders', 3),
      notifyAllMembers: bool(fd, 'notifyAllMembers'),
      notifyOnPickup: bool(fd, 'notifyOnPickup'),
      emailFallback: bool(fd, 'emailFallback'),
      requireSignature: bool(fd, 'requireSignature'),
    });
    revalidatePath(`/c/${slug}/settings`);
    return { ok: true, message: '已儲存通知設定' };
  });
}

export async function saveListsAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const carriers = str(fd, 'carriers').split('\n').map((s) => s.trim()).filter(Boolean);
    const storageLocations = str(fd, 'storageLocations').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!carriers.length) throw new DomainError('物流商至少要有一項');
    await updateCommunitySettings(scope.actor, scope.communityId, { carriers, storageLocations });
    revalidatePath(`/c/${slug}/settings`);
    return { ok: true, message: '已儲存' };
  });
}

export async function saveRetentionAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    await updateCommunitySettings(scope.actor, scope.communityId, {
      retentionDays: num(fd, 'retentionDays', 180),
      photoRetentionDays: num(fd, 'photoRetentionDays', 30),
    });
    revalidatePath(`/c/${slug}/settings`);
    return { ok: true, message: '已儲存' };
  });
}

export async function setLineModeAction(slug: string, mode: LineMode): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await admin(slug);
    if (mode === 'own') {
      const { plan } = await getCommunityWithPlan(scope.communityId);
      if (!plan.features.ownLine && ctx.role !== 'platform_admin') throw new DomainError('目前方案不包含自有 LINE 帳號，請升級方案');
      if (!(await getOwnChannel(scope.communityId))) throw new DomainError('請先在下方設定社區自己的官方帳號');
    }
    await setLineMode(scope.actor, scope.communityId, mode);
    revalidatePath(`/c/${slug}/settings/line`);
    return {
      ok: true,
      message: '已切換。注意：切換官方帳號後，住戶需要加入新的官方帳號並重新輸入綁定碼才會收到通知。',
    };
  });
}

export async function configureOwnLineAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await admin(slug);
    const { plan } = await getCommunityWithPlan(scope.communityId);
    if (!plan.features.ownLine && ctx.role !== 'platform_admin') throw new DomainError('目前方案不包含自有 LINE 帳號，請升級方案');
    const res = await configureChannel(scope.actor, {
      communityId: scope.communityId,
      name: str(fd, 'name') || ctx.community.name,
      channelSecret: str(fd, 'channelSecret'),
      accessToken: str(fd, 'accessToken'),
    });
    revalidatePath(`/c/${slug}/settings/line`);
    return {
      ok: true,
      message: res.webhookTest?.success
        ? `已連上「${res.channel.displayName}」，Webhook 已自動設定並測試成功。確認無誤後，請在上方切換為「使用社區自己的帳號」。`
        : `已連上「${res.channel.displayName}」，但 Webhook 測試失敗：${res.webhookTest?.detail ?? '未知原因'}`,
    };
  });
}

export async function installOwnRichMenuAction(slug: string): Promise<ActionState> {
  return run(async () => {
    const { scope } = await admin(slug);
    const channel = await getOwnChannel(scope.communityId);
    if (!channel) throw new DomainError('請先設定社區自己的官方帳號');
    await installRichMenu(scope.actor, channel);
    revalidatePath(`/c/${slug}/settings/line`);
    return { ok: true, message: '已建立圖文選單' };
  });
}

export async function completeSetupAction(slug: string) {
  const { ctx } = await admin(slug);
  await markSetupCompleted(ctx.community.id);
  redirect(`/c/${slug}`);
}

/** 給一般頁面判斷是否顯示管理功能 */
export async function canManage(slug: string) {
  const ctx = await requireCommunity(slug);
  return hasRole(ctx.role, 'community_admin');
}
