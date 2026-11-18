import { and, desc, eq, exists, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { PickupMethod } from '@/db/schema';
import { randomCode } from '@/lib/crypto';
import { deleteFiles, newFileKey, putFile } from '@/storage';
import { getCommunityWithPlan } from './communities';
import { notifyPickup } from './notify';
import { waitingForUnit } from './parcels';
import { getResident } from './residents';
import { parseSettings } from './settings';
import { parsePickupQr } from './tokens';
import { DomainError, type Scope } from './types';
import { searchUnits } from './units';

export type PickupLookup =
  | {
      kind: 'unit';
      via: 'qr' | 'code' | 'proxy' | 'unit';
      unit: { id: string; label: string };
      parcels: (typeof schema.parcels.$inferSelect)[];
      resident?: { id: string; name: string };
      proxy?: { id: string; name: string | null; expiresAt: Date };
      /** 用取件碼查到時，預設只勾選這一件 */
      highlightParcelId?: string;
    }
  | { kind: 'choices'; units: { id: string; label: string }[] }
  | { kind: 'error'; message: string };

function activeProxyIssuer(communityId: string) {
  return db().select({ id: schema.residents.id }).from(schema.residents)
    .where(and(eq(schema.residents.id, schema.proxyCodes.residentId), eq(schema.residents.unitId, schema.proxyCodes.unitId),
      eq(schema.residents.communityId, communityId), eq(schema.residents.status, 'active')));
}

/**
 * 交付畫面的萬用輸入：掃描 QR、輸入 6 碼取件碼、8 碼代領碼，或直接輸入門牌。
 */
export async function lookupForPickup(communityId: string, rawInput: string): Promise<PickupLookup> {
  const input = rawInput.trim();
  if (!input) return { kind: 'error', message: '請掃描 QR code 或輸入取件碼／門牌' };

  // 1. 住戶的取件 QR
  if (input.startsWith('PNQR:')) {
    const parsed = parsePickupQr(input);
    if ('error' in parsed) {
      return { kind: 'error', message: parsed.error === 'expired' ? 'QR code 已過期，請住戶重新整理頁面後再出示' : '無法辨識的 QR code' };
    }
    const r = await getResident(parsed.residentId);
    if (!r || r.resident.status !== 'active' || r.community.id !== communityId) {
      return { kind: 'error', message: '這個 QR code 不屬於本社區，或住戶已被移除' };
    }
    return {
      kind: 'unit',
      via: 'qr',
      unit: { id: r.unit.id, label: r.unit.label },
      parcels: await waitingForUnit(communityId, r.unit.id, r.unit.occupancyStartedAt),
      resident: { id: r.resident.id, name: r.resident.displayName || '住戶' },
    };
  }

  // 2. 6 碼取件碼
  if (/^\d{6}$/.test(input)) {
    const [p] = await db()
      .select({ parcel: schema.parcels, unit: schema.units })
      .from(schema.parcels)
      .innerJoin(schema.units, eq(schema.parcels.unitId, schema.units.id))
      .where(and(eq(schema.parcels.communityId, communityId), eq(schema.parcels.pickupCode, input), eq(schema.parcels.status, 'waiting')))
      .limit(1);
    if (p) {
      return {
        kind: 'unit',
        via: 'code',
        unit: { id: p.unit.id, label: p.unit.label },
        parcels: [p.parcel],
        highlightParcelId: p.parcel.id,
      };
    }
  }

  // 3. 8 碼代領碼
  const proxyCode = input.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-Z2-9]{8}$/.test(proxyCode)) {
    const [pc] = await db()
      .select({ proxy: schema.proxyCodes, unit: schema.units })
      .from(schema.proxyCodes)
      .innerJoin(schema.units, eq(schema.proxyCodes.unitId, schema.units.id))
      .where(and(eq(schema.proxyCodes.communityId, communityId), eq(schema.proxyCodes.code, proxyCode), exists(activeProxyIssuer(communityId))))
      .limit(1);
    if (pc) {
      if (pc.proxy.usedAt) return { kind: 'error', message: '這組代領碼已經使用過了' };
      if (pc.proxy.expiresAt < new Date()) return { kind: 'error', message: '這組代領碼已過期' };
      return {
        kind: 'unit',
        via: 'proxy',
        unit: { id: pc.unit.id, label: pc.unit.label },
        parcels: await waitingForUnit(communityId, pc.unit.id, pc.unit.occupancyStartedAt),
        proxy: { id: pc.proxy.id, name: pc.proxy.proxyName, expiresAt: pc.proxy.expiresAt },
      };
    }
  }

  // 4. 門牌（需由管理員確認身分）
  const units = await searchUnits(communityId, input, 8);
  if (units.length === 1) {
    return { kind: 'unit', via: 'unit', unit: units[0], parcels: await waitingForUnit(communityId, units[0].id) };
  }
  if (units.length > 1) return { kind: 'choices', units };
  return { kind: 'error', message: '找不到符合的取件碼、代領碼或門牌' };
}

export async function lookupUnitForPickup(communityId: string, unitId: string): Promise<PickupLookup> {
  const [u] = await db()
    .select({ id: schema.units.id, label: schema.units.label })
    .from(schema.units)
    .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, communityId)));
  if (!u) return { kind: 'error', message: '找不到這個戶別' };
  return { kind: 'unit', via: 'unit', unit: u, parcels: await waitingForUnit(communityId, u.id) };
}

export type ConfirmPickupInput = {
  parcelIds: string[];
  method: PickupMethod;
  expectedUnitId: string;
  lookupProof?: string;
  residentId?: string | null;
  proxyCodeId?: string | null;
  pickupName?: string | null;
  signature?: { data: Buffer; contentType: string; ext: string } | null;
};

export async function confirmPickup(scope: Scope, input: ConfirmPickupInput) {
  if (!input.parcelIds.length) throw new DomainError('請勾選要交付的包裹');
  if (!['qr', 'code', 'proxy', 'manual'].includes(input.method)) throw new DomainError('請重新選擇領取方式');
  if (input.method === 'manual' && !input.pickupName?.trim()) throw new DomainError('請輸入領取人姓名');
  const { community } = await getCommunityWithPlan(scope.communityId);
  if (parseSettings(community.settings).requireSignature && !input.signature) throw new DomainError('請領取人簽名');
  const rows = await db()
    .select()
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, scope.communityId), inArray(schema.parcels.id, input.parcelIds)));
  if (rows.length !== input.parcelIds.length) throw new DomainError('有包裹不存在');
  if (rows.some((p) => p.status !== 'waiting')) throw new DomainError('有包裹已經被領走或取消，請重新整理');
  const unitIds = new Set(rows.map((r) => r.unitId));
  if (unitIds.size !== 1) throw new DomainError('一次只能交付同一戶的包裹');
  const unitId = rows[0].unitId;
  if (unitId !== input.expectedUnitId) throw new DomainError('包裹戶別已變更，請重新查詢');
  const proof = input.lookupProof?.trim() || '';
  if (input.method === 'code' && (rows.length !== 1 || rows[0].pickupCode !== proof)) throw new DomainError('請以這件包裹的取件碼重新查詢');

  let pickupName = input.pickupName?.trim().slice(0, 40) || null;
  let residentId: string | null = null;
  if (input.method === 'qr') {
    const parsed = parsePickupQr(proof);
    if ('error' in parsed || parsed.residentId !== input.residentId) throw new DomainError('請住戶重新出示有效的取件 QR code');
    const r = await getResident(input.residentId);
    if (!r || r.unit.id !== unitId || r.resident.status !== 'active') throw new DomainError('住戶與包裹的戶別不符');
    residentId = r.resident.id;
    pickupName ??= r.resident.displayName || null;
  }
  let proxyId: string | null = null;
  let proxyIssuerId: string | null = null;
  if (input.method === 'proxy') {
    if (!input.proxyCodeId) throw new DomainError('缺少代領碼');
    const [pc] = await db()
      .select()
      .from(schema.proxyCodes)
      .where(and(eq(schema.proxyCodes.id, input.proxyCodeId), eq(schema.proxyCodes.communityId, scope.communityId), eq(schema.proxyCodes.code, proof.toUpperCase().replace(/[\s-]/g, '')), exists(activeProxyIssuer(scope.communityId))));
    if (!pc || pc.unitId !== unitId) throw new DomainError('代領碼與包裹的戶別不符');
    if (pc.usedAt || pc.expiresAt < new Date()) throw new DomainError('代領碼已使用或過期');
    proxyId = pc.id;
    proxyIssuerId = pc.residentId;
    pickupName ??= pc.proxyName ? `${pc.proxyName}（代領）` : '代領';
  }

  let signatureKey: string | null = null;
  if (input.signature) {
    signatureKey = newFileKey(scope.communityId, 'signature', input.signature.ext);
    await putFile(scope.communityId, signatureKey, input.signature.data, input.signature.contentType);
  }

  const staffId = scope.actor.type === 'user' ? scope.actor.id ?? null : null;
  const now = new Date();
  const updated = await db().transaction(async (tx) => {
    const [unit] = await tx.select({ start: schema.units.occupancyStartedAt }).from(schema.units)
      .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, scope.communityId))).for('share');
    if (!unit) throw new DomainError('找不到這個戶別');
    const ownerId = residentId ?? proxyIssuerId;
    if (ownerId) {
      const [active] = await tx.select({ id: schema.residents.id }).from(schema.residents)
        .where(and(eq(schema.residents.id, ownerId), eq(schema.residents.communityId, scope.communityId),
          eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active'))).for('share');
      if (!active || (input.method === 'qr' && 'error' in parsePickupQr(proof))) throw new DomainError('住戶資料或 QR code 已失效，請重新查詢');
    }
    const res = await tx
      .update(schema.parcels)
      .set({
        status: 'picked_up',
        pickedUpAt: now,
        pickedUpBy: staffId,
        pickupMethod: input.method,
        pickupResidentId: residentId,
        pickupName,
        signatureKey,
        updatedAt: now,
      })
      .where(and(eq(schema.parcels.communityId, scope.communityId), eq(schema.parcels.unitId, unitId), inArray(schema.parcels.id, input.parcelIds), eq(schema.parcels.status, 'waiting'),
        ownerId && unit.start ? gte(schema.parcels.receivedAt, unit.start) : undefined,
        input.method === 'code' ? eq(schema.parcels.pickupCode, proof) : undefined))
      .returning({ id: schema.parcels.id, quantity: schema.parcels.quantity });
    if (res.length !== input.parcelIds.length) throw new DomainError('有包裹剛被其他人交付，請重新整理');
    if (proxyId) {
      const used = await tx
        .update(schema.proxyCodes)
        .set({ usedAt: now, usedBy: staffId })
        .where(and(eq(schema.proxyCodes.id, proxyId), eq(schema.proxyCodes.communityId, scope.communityId), eq(schema.proxyCodes.unitId, unitId), isNull(schema.proxyCodes.usedAt), gt(schema.proxyCodes.expiresAt, sql`clock_timestamp()`), exists(activeProxyIssuer(scope.communityId))))
        .returning({ id: schema.proxyCodes.id });
      if (!used.length) throw new DomainError('代領碼已使用、過期或失效');
    }
    await tx.insert(schema.auditLogs).values(
      input.parcelIds.map((id) => ({
        communityId: scope.communityId,
        actorType: scope.actor.type,
        actorId: scope.actor.id ?? null,
        actorName: scope.actor.name ?? null,
        action: 'parcel.pickup',
        entityType: 'parcel',
        entityId: id,
        data: { method: input.method, pickupName, residentId, proxyId, signed: !!signatureKey },
        ip: scope.actor.ip ?? null,
      })),
    );
    return res;
  }).catch(async (err) => {
    if (signatureKey) {
      const [linked] = await db().select({ id: schema.parcels.id }).from(schema.parcels)
        .where(and(eq(schema.parcels.communityId, scope.communityId), eq(schema.parcels.signatureKey, signatureKey))).limit(1);
      if (!linked) await deleteFiles([signatureKey]);
    }
    throw err;
  });

  const count = updated.reduce((n, p) => n + p.quantity, 0);
  try {
    const notification = await notifyPickup(community, unitId, input.parcelIds, pickupName);
    return { count, unitId, notificationUnconfirmed: !!notification?.failures };
  } catch {
    console.error('[notify] pickup delivery result unavailable');
    return { count, unitId, notificationUnconfirmed: true };
  }
}

// ───────────────────────────── 代領碼 ─────────────────────────────

export async function createProxyCode(residentId: string, input: { proxyName?: string | null; hours?: number }) {
  const r = await getResident(residentId);
  if (!r || r.resident.status !== 'active') throw new DomainError('住戶資料不存在');
  const hours = Math.max(1, Math.min(72, input.hours ?? 24));
  if (!Number.isInteger(hours)) throw new DomainError('請輸入有效的小時數');
  return db().transaction(async (tx) => {
    await tx.select({ id: schema.units.id }).from(schema.units)
      .where(and(eq(schema.units.communityId, r.community.id), eq(schema.units.id, r.unit.id))).for('update');
    const [owner] = await tx.select().from(schema.residents)
      .where(and(eq(schema.residents.communityId, r.community.id), eq(schema.residents.unitId, r.unit.id),
        eq(schema.residents.id, residentId), eq(schema.residents.status, 'active'))).for('share');
    if (!owner) throw new DomainError('住戶資料不存在');
    const active = await tx.select({ id: schema.proxyCodes.id }).from(schema.proxyCodes)
      .where(and(eq(schema.proxyCodes.communityId, r.community.id), eq(schema.proxyCodes.unitId, r.unit.id),
        isNull(schema.proxyCodes.usedAt), gt(schema.proxyCodes.expiresAt, new Date()), exists(activeProxyIssuer(r.community.id)))).limit(5);
    if (active.length >= 5) throw new DomainError('有效的代領碼已達 5 組上限，請等舊的過期或使用後再產生');
    for (let i = 0; i < 5; i++) {
      const [row] = await tx.insert(schema.proxyCodes).values({
        communityId: r.community.id, unitId: r.unit.id, residentId, code: randomCode(8),
        proxyName: input.proxyName?.trim().slice(0, 30) || null,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      }).onConflictDoNothing({ target: [schema.proxyCodes.communityId, schema.proxyCodes.code] }).returning();
      if (!row) continue;
      await tx.insert(schema.auditLogs).values({
        communityId: r.community.id, actorType: 'resident', actorId: residentId, actorName: owner.displayName || '住戶',
        action: 'proxy.create', entityType: 'unit', entityId: r.unit.id, data: { proxyName: row.proxyName, hours },
      });
      return row;
    }
    throw new Error('無法產生代領碼');
  });
}

export async function listProxyCodes(residentId: string) {
  const r = await getResident(residentId);
  if (!r || r.resident.status !== 'active') return [];
  return db()
    .select()
    .from(schema.proxyCodes)
    .where(and(eq(schema.proxyCodes.communityId, r.community.id), eq(schema.proxyCodes.unitId, r.unit.id), isNull(schema.proxyCodes.usedAt), gt(schema.proxyCodes.expiresAt, new Date()), exists(activeProxyIssuer(r.community.id))))
    .orderBy(desc(schema.proxyCodes.createdAt));
}
