'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { PickupMethod } from '@/db/schema';
import { requireCommunity } from '@/auth/session';
import { closeParcel, notifyPending, registerParcels, resendNotification, updateParcel } from '@/domain/parcels';
import { confirmPickup, lookupForPickup, lookupUnitForPickup, type PickupLookup } from '@/domain/pickup';
import { DomainError } from '@/domain/types';
import { searchUnits } from '@/domain/units';
import { decodeImage } from '@/storage';
import type { ActionState } from '@/components/form';
import { errorMessage, run, str } from './util';

async function staff(slug: string) {
  const ctx = await requireCommunity(slug, 'staff');
  return { ctx, scope: { communityId: ctx.community.id, actor: ctx.actor } };
}

export async function searchUnitsAction(slug: string, q: string) {
  const { ctx } = await staff(slug);
  return searchUnits(ctx.community.id, q.slice(0, 40));
}

export type ReceiveItem = {
  unitId: string;
  carrier?: string;
  trackingNo?: string;
  categories?: string[];
  storageLocation?: string;
  quantity?: number;
  note?: string;
  photo?: string | null;
};

export type ReceiveResult =
  | {
      ok: true;
      parcel: { id: string; pickupCode: string; unitLabel: string; carrier: string | null; quantity: number };
      notify?: { status: string };
    }
  | { ok: false; error: string };

export async function registerParcelAction(slug: string, item: ReceiveItem, notifyNow: boolean): Promise<ReceiveResult> {
  try {
    const { scope } = await staff(slug);
    const photo = await decodeImage(item.photo ?? null);
    const result = await registerParcels(
      scope,
      [
        {
          unitId: item.unitId,
          carrier: item.carrier,
          trackingNo: item.trackingNo,
          categories: item.categories,
          storageLocation: item.storageLocation,
          quantity: item.quantity,
          note: item.note,
          photo,
        },
      ],
      { notify: notifyNow },
    );
    const p = result.parcels[0];
    const [unit] = await db().select({ label: schema.units.label }).from(schema.units).where(eq(schema.units.id, p.unitId));
    return {
      ok: true,
      parcel: { id: p.id, pickupCode: p.pickupCode, unitLabel: unit?.label ?? '', carrier: p.carrier, quantity: p.quantity },
      notify: result.notifications[0] ? { status: result.notifications[0].status } : undefined,
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function notifyBatchAction(slug: string, parcelIds: string[]) {
  try {
    const { scope } = await staff(slug);
    const summaries = await notifyPending(scope, parcelIds.slice(0, 500));
    revalidatePath(`/c/${slug}`);
    return { ok: true as const, summaries: summaries.map((s) => ({ unitId: s.unitId, status: s.status })) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

/** 把所有「已登記但還沒通知」的包裹一次通知（例如忘了按完成） */
export async function notifyAllPendingAction(slug: string): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await staff(slug);
    const rows = await db()
      .select({ id: schema.parcels.id })
      .from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, ctx.community.id), eq(schema.parcels.status, 'waiting'), eq(schema.parcels.notifyStatus, 'pending')));
    if (!rows.length) return { ok: true, message: '沒有待通知的包裹' };
    const res = await notifyPending(scope, rows.map((r) => r.id));
    revalidatePath(`/c/${slug}`);
    return { ok: true, message: `已通知 ${res.length} 戶` };
  });
}

export async function updateParcelAction(slug: string, parcelId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await staff(slug);
    const res = await updateParcel(scope, parcelId, {
      unitId: str(fd, 'unitId') || undefined,
      carrier: str(fd, 'carrier'),
      trackingNo: str(fd, 'trackingNo'),
      storageLocation: str(fd, 'storageLocation'),
      quantity: Number(str(fd, 'quantity')) || 1,
      note: str(fd, 'note'),
      categories: fd.getAll('categories').map(String),
    });
    revalidatePath(`/c/${slug}/parcels/${parcelId}`);
    return { ok: true, message: res.unitChanged ? '已儲存。戶別有變更，建議按「重新通知」通知正確的住戶。' : '已儲存' };
  });
}

export async function closeParcelAction(slug: string, parcelId: string, status: 'returned' | 'cancelled', _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { scope } = await staff(slug);
    await closeParcel(scope, parcelId, status, str(fd, 'note'));
    revalidatePath(`/c/${slug}/parcels/${parcelId}`);
    return { ok: true, message: status === 'returned' ? '已標記退件' : '已取消登記' };
  });
}

export async function resendAction(slug: string, parcelId: string): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await staff(slug);
    if (ctx.readOnly) throw new DomainError('社區服務已停用，無法發送通知');
    const res = await resendNotification(scope, parcelId);
    revalidatePath(`/c/${slug}/parcels/${parcelId}`);
    const label = { sent: '已發送', partial: '部分成功', failed: '發送失敗', no_recipient: '這戶還沒有住戶綁定', skipped: '未發送', pending: '未發送' }[res.status];
    return res.status === 'sent' || res.status === 'partial' ? { ok: true, message: label } : { error: label };
  });
}

// ───────────────────────────── 交付 ─────────────────────────────

export async function lookupPickupAction(slug: string, input: string): Promise<PickupLookup> {
  const { ctx } = await staff(slug);
  return lookupForPickup(ctx.community.id, input.slice(0, 500));
}

export async function lookupUnitPickupAction(slug: string, unitId: string): Promise<PickupLookup> {
  const { ctx } = await staff(slug);
  return lookupUnitForPickup(ctx.community.id, unitId);
}

export async function confirmPickupAction(
  slug: string,
  input: { parcelIds: string[]; method: PickupMethod; residentId?: string; proxyCodeId?: string; pickupName?: string; signature?: string | null },
): Promise<ActionState> {
  return run(async () => {
    const { ctx, scope } = await staff(slug);
    if (ctx.settings.requireSignature && !input.signature) throw new DomainError('請領取人簽名');
    if (input.method === 'manual' && !input.pickupName?.trim()) throw new DomainError('請輸入領取人姓名');
    const signature = await decodeImage(input.signature ?? null);
    const res = await confirmPickup(scope, { ...input, signature });
    revalidatePath(`/c/${slug}`);
    return { ok: true, message: `已交付 ${res.count} 件` };
  });
}
