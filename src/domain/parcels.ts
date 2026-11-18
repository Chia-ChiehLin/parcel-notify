import crypto from 'node:crypto';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema, type DB } from '@/db';
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
async function allocatePickupCodes(communityId: string, n: number, database: Pick<DB, 'select'> = db()): Promise<string[]> {
  const reserved = new Set<string>();
  for (let attempt = 0; reserved.size < n && attempt < 10; attempt++) {
    const candidates = new Set<string>();
    while (candidates.size < n - reserved.size) {
      const code = randomDigits(6);
      if (!code.startsWith('0') && !reserved.has(code)) candidates.add(code);
    }
    const occupied = await database.select({ code: schema.parcels.pickupCode }).from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, communityId), eq(schema.parcels.status, 'waiting'), inArray(schema.parcels.pickupCode, [...candidates])));
    for (const { code } of occupied) candidates.delete(code);
    for (const code of candidates) reserved.add(code);
  }
  if (reserved.size !== n) throw new DomainError('暫時無法配發取件碼，請再試一次');
  return [...reserved];
}

export type RegisterResult = {
  parcels: (typeof schema.parcels.$inferSelect)[];
  notifications: NotifySummary[];
};

/**
 * 批次登記包裹。notify = true 時，每一戶只發一則合併通知。
 */
export async function registerParcels(scope: Scope, items: ParcelInput[], opts: { notify: boolean; requestId?: string }): Promise<RegisterResult> {
  if (!items.length) throw new DomainError('沒有要登記的包裹');
  if (items.length > 200) throw new DomainError('一次最多登記 200 件');
  const { community, plan } = await getCommunityWithPlan(scope.communityId);
  if (community.status === 'suspended' || community.status === 'cancelled') {
    throw new DomainError('社區服務已停用，無法登記新包裹。請聯絡服務商');
  }
  const unitIds = [...new Set(items.map((i) => i.unitId))];
  const batchId = crypto.randomUUID();
  const now = new Date();

  // 單筆收件時，平板用同一個請求編號重試，確認前一筆是否已經登記。
  if (opts.requestId && (items.length !== 1 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(opts.requestId))) {
    throw new DomainError('收件請求編號不正確，請重新開啟收件畫面');
  }
  const existingReceipt = async (): Promise<RegisterResult | null> => {
    if (!opts.requestId) return null;
    const [p] = await db().select().from(schema.parcels)
      .where(and(eq(schema.parcels.id, opts.requestId), eq(schema.parcels.communityId, scope.communityId)));
    if (!p) return null;
    if (p.unitId !== items[0].unitId) throw new DomainError('這筆登記已改戶，請先核對包裹紀錄');
    const results = opts.notify && p.notifyStatus === 'pending' && p.status === 'waiting'
      ? [await notifyRegistered(community, p.unitId, [p.id])]
      : opts.notify ? [{ unitId: p.unitId, status: p.notifyStatus, line: 0, email: 0, failed: 0 }] : [];
    return { parcels: [p], notifications: results };
  };
  const prior = await existingReceipt();
  if (prior) return prior;

  const photoKeys: (string | null)[] = [];
  let created: (typeof schema.parcels.$inferSelect)[] = [];
  try {
    for (const item of items) {
      if (item.photo && plan.features.photos) {
        const key = newFileKey(scope.communityId, 'photo', item.photo.ext);
        await putFile(scope.communityId, key, item.photo.data, item.photo.contentType);
        photoKeys.push(key);
      } else photoKeys.push(null);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const codes = await allocatePickupCodes(scope.communityId, items.length);
      try {
        created = await db().transaction(async (tx) => {
          const validUnits = await tx.select({ id: schema.units.id }).from(schema.units)
            .where(and(eq(schema.units.communityId, scope.communityId), inArray(schema.units.id, unitIds)))
            .orderBy(asc(schema.units.id)).for('share');
          if (validUnits.length !== unitIds.length) throw new DomainError('有包裹的戶別不存在，請重新選擇');
          const rows = await tx.insert(schema.parcels).values(items.map((item, i) => ({
            id: opts.requestId,
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
            receivedAt: sql`clock_timestamp()`,
            receivedBy: scope.actor.type === 'user' ? scope.actor.id ?? null : null,
          }))).returning();
          await bumpUsage(scope.communityId, 'parcels', rows.reduce((n, p) => n + p.quantity, 0), now, tx);
          await tx.insert(schema.auditLogs).values(rows.map((p) => ({
            communityId: scope.communityId,
            actorType: scope.actor.type,
            actorId: scope.actor.id ?? null,
            actorName: scope.actor.name ?? null,
            action: 'parcel.receive',
            entityType: 'parcel',
            entityId: p.id,
            data: { unitId: p.unitId, carrier: p.carrier, trackingNo: p.trackingNo, batchId },
            ip: scope.actor.ip ?? null,
          })));
          return rows;
        });
        break;
      } catch (e) {
        if (attempt === 2 || !isUniqueViolation(e, 'parcels_pickup_code_unique')) throw e;
      }
    }
  } catch (e) {
    const keys = photoKeys.filter((k): k is string => !!k);
    if (keys.length) {
      const saved = await db().select({ key: schema.parcels.photoKey }).from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, scope.communityId), inArray(schema.parcels.photoKey, keys)));
      const linked = new Set(saved.map((p) => p.key));
      await deleteFiles(keys.filter((key) => !linked.has(key)));
    }
    if (opts.requestId && isUniqueViolation(e, 'parcels_pkey')) {
      const receipt = await existingReceipt();
      if (receipt) return receipt;
    }
    throw e;
  }

  const notifications: NotifySummary[] = [];
  if (opts.notify) {
    const byUnit = new Map<string, string[]>();
    for (const p of created) byUnit.set(p.unitId, [...(byUnit.get(p.unitId) ?? []), p.id]);
    for (const [unitId, ids] of byUnit) {
      notifications.push(await notifyRegistered(community, unitId, ids));
    }
  }
  return { parcels: created, notifications };
}

async function notifyRegistered(community: typeof schema.communities.$inferSelect, unitId: string, ids: string[]): Promise<NotifySummary> {
  try {
    return await notifyUnitParcels(community, unitId, ids, 'arrival');
  } catch {
    // 收件已提交。無法確認通知結果時保留紀錄，櫃台仍應取得原取件碼。
    console.error('[notify] delivery result unavailable for registered parcels');
    return { unitId, status: 'sending', line: 0, email: 0, failed: 0 };
  }
}

/** 對一戶目前所有「待領取、尚未通知」的包裹發通知（批次登記完成時按「發送通知」用） */
export async function notifyPending(scope: Scope, parcelIds: string[]) {
  const { community } = await getCommunityWithPlan(scope.communityId);
  const rows = await db()
    .select({ id: schema.parcels.id, unitId: schema.parcels.unitId })
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, scope.communityId), inArray(schema.parcels.id, parcelIds), eq(schema.parcels.status, 'waiting'), eq(schema.parcels.notifyStatus, 'pending')));
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

export const MAX_PARCEL_EXPORT_ROWS = 10_000;

export async function listParcels(communityId: string, filters: ParcelFilters = {}, mode: 'page' | 'export' = 'page') {
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
  const pageSize = mode === 'export' ? MAX_PARCEL_EXPORT_ROWS + 1 : Math.min(200, filters.pageSize ?? 50);
  const page = Math.max(1, filters.page ?? 1);
  const where = and(...conds);
  const pageQuery = db()
      .select({
        parcel: schema.parcels,
        unitLabel: schema.units.label,
        receiverName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.receivedBy})`,
        handlerName: sql<string | null>`(select name from app.users u where u.id = ${schema.parcels.pickedUpBy})`,
      })
      .from(schema.parcels)
      .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
      .where(where)
      .orderBy(filters.status === 'waiting' || filters.status === 'overdue' ? asc(schema.parcels.receivedAt) : desc(schema.parcels.receivedAt), asc(schema.parcels.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  if (mode === 'export') {
    const rows = await pageQuery;
    return { rows, total: rows.length, page, pageSize, overdueDays: settings.overdueDays };
  }
  const [rows, [total]] = await Promise.all([
    pageQuery,
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
  return db().transaction(async (tx) => {
    const [parcel] = await tx.select().from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, scope.communityId), eq(schema.parcels.id, parcelId))).for('update');
    if (!parcel || parcel.status !== 'waiting') throw new DomainError('只有待領取的包裹可以修改');
    if (input.unitId && input.unitId !== parcel.unitId) {
      if (parcel.notifyStatus === 'sending' && parcel.notifiedAt && Date.now() - parcel.notifiedAt.getTime() < 15 * 60_000) {
        throw new DomainError('這件包裹正在傳送到件通知，請稍後再更換戶別');
      }
      const [u] = await tx
        .select({ id: schema.units.id, start: schema.units.occupancyStartedAt })
        .from(schema.units)
        .where(and(eq(schema.units.id, input.unitId), eq(schema.units.communityId, scope.communityId))).for('share');
      if (!u) throw new DomainError('找不到這個戶別');
      if (u.start && parcel.receivedAt < u.start) throw new DomainError('包裹早於該戶上次遷出時間，請先確認收件人');
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
    const reassigned = changed.unitId ? {
      pickupCode: (await allocatePickupCodes(scope.communityId, 1, tx))[0],
      notifyStatus: 'pending' as const, notifiedAt: null, reminderCount: 0, lastRemindedAt: null,
    } : {};
    await tx.update(schema.parcels).set({ ...patch, ...reassigned, updatedAt: new Date() })
      .where(and(eq(schema.parcels.communityId, scope.communityId), eq(schema.parcels.id, parcelId)));
    await audit(scope.actor, 'parcel.update', { communityId: scope.communityId, entityType: 'parcel', entityId: parcelId, data: changed }, tx);
    return { unitChanged: !!changed.unitId };
  });
}

/** 退件或取消登記 */
export async function closeParcel(scope: Scope, parcelId: string, status: 'returned' | 'cancelled', note?: string) {
  if (status !== 'returned' && status !== 'cancelled') throw new DomainError('結案狀態不正確');
  await db().transaction(async (tx) => {
    const [closed] = await tx.update(schema.parcels)
      .set({ status, closedAt: new Date(), closedNote: clip(note, 300), updatedAt: new Date() })
      .where(and(eq(schema.parcels.communityId, scope.communityId), eq(schema.parcels.id, parcelId), eq(schema.parcels.status, 'waiting')))
      .returning({ id: schema.parcels.id });
    if (!closed) throw new DomainError('這件包裹已經不是待領取狀態');
    await audit(scope.actor, status === 'returned' ? 'parcel.return' : 'parcel.cancel', {
      communityId: scope.communityId, entityType: 'parcel', entityId: parcelId, data: { note: clip(note, 300) },
    }, tx);
  });
}

export async function resendNotification(scope: Scope, parcelId: string) {
  const { parcel } = await getParcel(scope.communityId, parcelId);
  if (parcel.status !== 'waiting') throw new DomainError('只有待領取的包裹可以重新通知');
  const { community } = await getCommunityWithPlan(scope.communityId);
  const result = await notifyUnitParcels(community, parcel.unitId, [parcelId], 'arrival', true);
  await audit(scope.actor, 'parcel.notify', { communityId: scope.communityId, entityType: 'parcel', entityId: parcelId, data: { status: result.status } });
  return result;
}

export async function waitingForUnit(communityId: string, unitId: string, occupancyStartedAt?: Date | null) {
  return db()
    .select()
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, communityId), eq(schema.parcels.unitId, unitId), eq(schema.parcels.status, 'waiting'),
      occupancyStartedAt ? gte(schema.parcels.receivedAt, occupancyStartedAt) : undefined))
    .orderBy(asc(schema.parcels.receivedAt));
}

/** 一次交付數件時簽名共用；只刪除沒有其他包裹仍需保留的檔案。 */
export async function deleteParcelFiles(
  communityId: string,
  rows: Pick<typeof schema.parcels.$inferSelect, 'id' | 'photoKey' | 'signatureKey'>[],
) {
  const ids = new Set(rows.map((p) => p.id));
  const signatures = new Set(rows.flatMap((p) => p.signatureKey ? [p.signatureKey] : []));
  if (signatures.size) {
    const linked = await db().select({ id: schema.parcels.id, key: schema.parcels.signatureKey }).from(schema.parcels)
      .where(and(eq(schema.parcels.communityId, communityId), inArray(schema.parcels.signatureKey, [...signatures])));
    for (const p of linked) if (!ids.has(p.id) && p.key) signatures.delete(p.key);
  }
  const photos = rows.flatMap((p) => p.photoKey ? [p.photoKey] : []);
  await deleteFiles([...photos, ...signatures]);
}

/** 刪除照片檔（保留紀錄） */
export async function removePhotos(communityId: string, parcelIds: string[]) {
  if (!parcelIds.length) return 0;
  const rows = await db()
    .select({ id: schema.parcels.id, photoKey: schema.parcels.photoKey, signatureKey: schema.parcels.signatureKey })
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, communityId), inArray(schema.parcels.id, parcelIds)));
  await deleteParcelFiles(communityId, rows);
  await db().update(schema.parcels).set({ photoKey: null, signatureKey: null }).where(and(eq(schema.parcels.communityId, communityId), inArray(schema.parcels.id, parcelIds)));
  return rows.length;
}
