import crypto from 'node:crypto';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { isUniqueViolation } from '@/db/errors';
import { PARCEL_CATEGORIES, type ParcelCategory, type ParcelStatus } from '@/db/schema';
import { randomDigits } from '@/lib/crypto';
import { addDays } from '@/lib/time';
import { deleteFiles, newFileKey, putFile } from '@/storage';
import { audit } from './audit';
import { getCommunityWithPlan } from './communities';
import { notifyUnitParcels, type NotifySummary } from './notify';
import { parseSettings } from './settings';
import { DomainError, type Scope } from './types';
import { toSearchKey } from './units';
import { bumpUsage } from './usage';

export type ParcelInput = {
  unitId: string;
  carrier?: string | null;
  trackingNo?: string | null;
  categories?: string[];
  storageLocation?: string | null;
  quantity?: number;
  note?: string | null;
  photo?: { data: Buffer; contentType: string; ext: string } | null;
};

export const STATUS_LABELS: Record<ParcelStatus, string> = {
  waiting: '待領取',
  picked_up: '已領取',
  returned: '已退件',
  cancelled: '已取消',
};

function cleanCategories(input: string[] | undefined): ParcelCategory[] {
  return [...new Set((input ?? []).filter((c): c is ParcelCategory => (PARCEL_CATEGORIES as readonly string[]).includes(c)))];
}

function clip(s: string | null | undefined, max: number) {
  const t = s?.trim();
  return t ? t.slice(0, max) : null;
}

/** 產生社區內「待領取」包裹中不重複的 6 碼取件碼 */
async function allocatePickupCodes(communityId: string, n: number): Promise<string[]> {
  const taken = new Set(
    (
      await db()
        .select({ code: schema.parcels.pickupCode })
        .from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, communityId), eq(schema.parcels.status, 'waiting')))
    ).map((r) => r.code),
  );
  const out: string[] = [];
  let guard = 0;
  while (out.length < n) {
    if (++guard > n * 50) throw new Error('無法產生取件碼');
    const c = randomDigits(6);
    if (c.startsWith('0') || taken.has(c)) continue;
    taken.add(c);
    out.push(c);
  }
  return out;
}

export type RegisterResult = {
  parcels: (typeof schema.parcels.$inferSelect)[];
  notifications: NotifySummary[];
};

/**
 * 批次登記包裹。notify = true 時，每一戶只發一則合併通知。
 */
export async function registerParcels(scope: Scope, items: ParcelInput[], opts: { notify: boolean }): Promise<RegisterResult> {
  if (!items.length) throw new DomainError('沒有要登記的包裹');
  if (items.length > 200) throw new DomainError('一次最多登記 200 件');
  const { community, plan } = await getCommunityWithPlan(scope.communityId);
  if (community.status === 'suspended' || community.status === 'cancelled') {
    throw new DomainError('社區服務已停用，無法登記新包裹。請聯絡服務商');
  }
  const unitIds = [...new Set(items.map((i) => i.unitId))];
  const validUnits = await db()
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(and(eq(schema.units.communityId, scope.communityId), inArray(schema.units.id, unitIds)));
  if (validUnits.length !== unitIds.length) throw new DomainError('有包裹的戶別不存在，請重新選擇');

  const batchId = crypto.randomUUID();
  const now = new Date();

  // 照片先上傳（方案沒有照片功能時忽略）
  const photoKeys: (string | null)[] = [];
  for (const item of items) {
    if (item.photo && plan.features.photos) {
      const key = newFileKey(scope.communityId, 'photo', item.photo.ext);
      await putFile(scope.communityId, key, item.photo.data, item.photo.contentType);
      photoKeys.push(key);
    } else photoKeys.push(null);
  }

  let created: (typeof schema.parcels.$inferSelect)[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const codes = await allocatePickupCodes(scope.communityId, items.length);
    try {
      created = await db()
        .insert(schema.parcels)
        .values(
          items.map((item, i) => ({
            communityId: scope.communityId,
            unitId: item.unitId,
            batchId,
            carrier: clip(item.carrier, 40),
            trackingNo: clip(item.trackingNo, 60),
            categories: cleanCategories(item.categories),
            storageLocation: clip(item.storageLocation, 40),
            quantity: Math.max(1, Math.min(99, Math.floor(item.quantity ?? 1))),
            note: clip(item.note, 300),
            photoKey: photoKeys[i],
            pickupCode: codes[i],
            receivedAt: now,
            receivedBy: scope.actor.type === 'user' ? scope.actor.id ?? null : null,
          })),
        )
        .returning();
      break;
    } catch (e) {
      // 同時有其他人登記，取件碼碰撞 → 重試
      if (attempt === 2 || !isUniqueViolation(e, 'parcels_pickup_code_unique')) throw e;
    }
  }

  await bumpUsage(scope.communityId, 'parcels', created.length);
  await db()
    .insert(schema.auditLogs)
    .values(
      created.map((p) => ({
        communityId: scope.communityId,
        actorType: scope.actor.type,
        actorId: scope.actor.id ?? null,
        actorName: scope.actor.name ?? null,
        action: 'parcel.receive',
        entityType: 'parcel',
        entityId: p.id,
        data: { unitId: p.unitId, carrier: p.carrier, trackingNo: p.trackingNo, batchId, pickupCode: p.pickupCode },
        ip: scope.actor.ip ?? null,
      })),
    );

  const notifications: NotifySummary[] = [];
  if (opts.notify) {
    const byUnit = new Map<string, string[]>();
    for (const p of created) byUnit.set(p.unitId, [...(byUnit.get(p.unitId) ?? []), p.id]);
    for (const [unitId, ids] of byUnit) {
      notifications.push(await notifyUnitParcels(community, unitId, ids, 'arrival'));
    }
  }
  return { parcels: created, notifications };
}

/** 對一戶目前所有「待領取、尚未通知」的包裹發通知（批次登記完成時按「發送通知」用） */
export async function notifyPending(scope: Scope, parcelIds: string[]) {
  const { community } = await getCommunityWithPlan(scope.communityId);
  const rows = await db()
    .select({ id: schema.parcels.id, unitId: schema.parcels.unitId })
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, scope.communityId), inArray(schema.parcels.id, parcelIds), eq(schema.parcels.status, 'waiting')));
  const byUnit = new Map<string, string[]>();
  for (const p of rows) byUnit.set(p.unitId, [...(byUnit.get(p.unitId) ?? []), p.id]);
  const out: NotifySummary[] = [];
  for (const [unitId, ids] of byUnit) out.push(await notifyUnitParcels(community, unitId, ids, 'arrival'));
  await audit(scope.actor, 'parcel.notify', { communityId: scope.communityId, entityType: 'parcel', data: { parcelIds, units: out.length } });
  return out;
}

export type ParcelFilters = {
  status?: ParcelStatus | 'overdue' | 'all';
  q?: string;
  unitId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function listParcels(communityId: string, filters: ParcelFilters = {}) {
  const { community } = await getCommunityWithPlan(communityId);
  const settings = parseSettings(community.settings);
  const conds = [eq(schema.parcels.communityId, communityId)];
  if (filters.status === 'overdue') {
    conds.push(eq(schema.parcels.status, 'waiting'));
    conds.push(lte(schema.parcels.receivedAt, addDays(new Date(), -settings.overdueDays)));
  } else if (filters.status && filters.status !== 'all') {
    conds.push(eq(schema.parcels.status, filters.status));
  }
  if (filters.unitId) conds.push(eq(schema.parcels.unitId, filters.unitId));
  if (filters.from) conds.push(gte(schema.parcels.receivedAt, filters.from));
  if (filters.to) conds.push(lte(schema.parcels.receivedAt, filters.to));
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const key = toSearchKey(q);
    conds.push(
      or(
        ilike(schema.parcels.trackingNo, `%${q}%`),
        eq(schema.parcels.pickupCode, q),
        ilike(schema.units.label, `%${q}%`),
        key ? ilike(schema.units.searchKey, `${key}%`) : undefined,
        ilike(schema.parcels.note, `%${q}%`),
      )!,
    );
  }
  const pageSize = Math.min(200, filters.pageSize ?? 50);
  const page = Math.max(1, filters.page ?? 1);
  const where = and(...conds);
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        parcel: schema.parcels,
        unitLabel: schema.units.label,
        receiverName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.receivedBy})`,
        handlerName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.pickedUpBy})`,
      })
      .from(schema.parcels)
      .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
      .where(where)
      .orderBy(filters.status === 'waiting' || filters.status === 'overdue' ? asc(schema.parcels.receivedAt) : desc(schema.parcels.receivedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db().select({ n: count() }).from(schema.parcels).innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id)).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page, pageSize, overdueDays: settings.overdueDays };
}

export async function getParcel(communityId: string, parcelId: string) {
  const [row] = await db()
    .select({
      parcel: schema.parcels,
      unit: schema.units,
      receiverName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.receivedBy})`,
      handlerName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.pickedUpBy})`,
      pickupResidentName: sql<string | null>`(select display_name from app.residents r where r.id = ${schema.parcels.pickupResidentId})`,
    })
    .from(schema.parcels)
    .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
    .where(and(eq(schema.parcels.id, parcelId), eq(schema.parcels.communityId, communityId)))
    .limit(1);
  if (!row) throw new DomainError('找不到這件包裹');
  const history = await db()
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.entityType, 'parcel'), eq(schema.auditLogs.entityId, parcelId), eq(schema.auditLogs.communityId, communityId)))
    .orderBy(asc(schema.auditLogs.createdAt));
  const notes = await db()
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.communityId, communityId), sql`${parcelId}::uuid = any(${schema.notifications.parcelIds})`))
    .orderBy(asc(schema.notifications.createdAt));
  return { ...row, history, notifications: notes };
}

export async function updateParcel(
  scope: Scope,
  parcelId: string,
  input: { unitId?: string; carrier?: string | null; trackingNo?: string | null; categories?: string[]; storageLocation?: string | null; quantity?: number; note?: string | null },
) {
  const { parcel } = await getParcel(scope.communityId, parcelId);
  if (parcel.status !== 'waiting') throw new DomainError('只有待領取的包裹可以修改');
  if (input.unitId && input.unitId !== parcel.unitId) {
    const [u] = await db()
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(and(eq(schema.units.id, input.unitId), eq(schema.units.communityId, scope.communityId)));
    if (!u) throw new DomainError('找不到這個戶別');
  }
  const patch = {
    unitId: input.unitId ?? parcel.unitId,
    carrier: input.carrier !== undefined ? clip(input.carrier, 40) : parcel.carrier,
    trackingNo: input.trackingNo !== undefined ? clip(input.trackingNo, 60) : parcel.trackingNo,
    categories: input.categories ? cleanCategories(input.categories) : parcel.categories,
    storageLocation: input.storageLocation !== undefined ? clip(input.storageLocation, 40) : parcel.storageLocation,
    quantity: input.quantity ? Math.max(1, Math.min(99, Math.floor(input.quantity))) : parcel.quantity,
    note: input.note !== undefined ? clip(input.note, 300) : parcel.note,
  };
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    const before = parcel[k as keyof typeof parcel];
    if (JSON.stringify(before) !== JSON.stringify(v)) changed[k] = { from: before, to: v };
  }
  if (!Object.keys(changed).length) return { unitChanged: false };
  await db().update(schema.parcels).set({ ...patch, updatedAt: new Date() }).where(eq(schema.parcels.id, parcelId));
  await audit(scope.actor, 'parcel.update', { communityId: scope.communityId, entityType: 'parcel', entityId: parcelId, data: changed });
  return { unitChanged: !!changed.unitId };
}

/** 退件或取消登記 */
export async function closeParcel(scope: Scope, parcelId: string, status: 'returned' | 'cancelled', note?: string) {
  const { parcel } = await getParcel(scope.communityId, parcelId);
  if (parcel.status !== 'waiting') throw new DomainError('這件包裹已經不是待領取狀態');
  await db()
    .update(schema.parcels)
    .set({ status, closedAt: new Date(), closedNote: clip(note, 300), updatedAt: new Date() })
    .where(eq(schema.parcels.id, parcelId));
  await audit(scope.actor, status === 'returned' ? 'parcel.return' : 'parcel.cancel', {
    communityId: scope.communityId,
    entityType: 'parcel',
    entityId: parcelId,
    data: { note },
  });
}

export async function resendNotification(scope: Scope, parcelId: string) {
  const { parcel } = await getParcel(scope.communityId, parcelId);
  if (parcel.status !== 'waiting') throw new DomainError('只有待領取的包裹可以重新通知');
  const { community } = await getCommunityWithPlan(scope.communityId);
  const result = await notifyUnitParcels(community, parcel.unitId, [parcelId], 'arrival');
  await audit(scope.actor, 'parcel.notify', { communityId: scope.communityId, entityType: 'parcel', entityId: parcelId, data: { status: result.status } });
  return result;
}

export async function waitingForUnit(communityId: string, unitId: string) {
  return db()
    .select()
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, communityId), eq(schema.parcels.unitId, unitId), eq(schema.parcels.status, 'waiting')))
    .orderBy(asc(schema.parcels.receivedAt));
}

/** 刪除照片檔（保留紀錄） */
export async function removePhotos(parcelIds: string[]) {
  if (!parcelIds.length) return 0;
  const rows = await db()
    .select({ id: schema.parcels.id, photoKey: schema.parcels.photoKey, signatureKey: schema.parcels.signatureKey })
    .from(schema.parcels)
    .where(inArray(schema.parcels.id, parcelIds));
  await deleteFiles(rows.flatMap((r) => [r.photoKey, r.signatureKey].filter((k): k is string => !!k)));
  await db().update(schema.parcels).set({ photoKey: null, signatureKey: null }).where(inArray(schema.parcels.id, parcelIds));
  return rows.length;
}
