import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { randomCode } from '@/lib/crypto';
import { audit } from './audit';
import { assertWithinUnitLimit } from './communities';
import { DomainError, type Scope } from './types';

export type GeneratedUnit = { building: string; floor: number | null; number: string; label: string };

export type GenerateInput = {
  /** 棟別，例如 ['A','B']；沒有分棟就給 [''] */
  buildings: string[];
  floorFrom: number;
  floorTo: number;
  /** 跳過的樓層，例如 [4, 13] */
  skipFloors?: number[];
  /** 每層戶數（1..n），或直接指定戶號 */
  unitsPerFloor?: number;
  unitNumbers?: string[];
  /** 命名規則：{b} 棟別、{f} 樓層、{u} 戶號、{uu} 兩位數戶號 */
  pattern: string;
};

export const LABEL_PATTERNS = [
  { pattern: '{b}-{f}-{u}', example: 'A-14-1' },
  { pattern: '{b}{f}{uu}', example: 'A1401' },
  { pattern: '{f}F-{u}', example: '14F-1' },
  { pattern: '{b}棟{f}樓之{u}', example: 'A棟14樓之1' },
  { pattern: '{f}-{u}', example: '14-1' },
];

export function renderLabel(pattern: string, b: string, f: number | null, u: string): string {
  const uu = /^\d+$/.test(u) ? u.padStart(2, '0') : u;
  return pattern
    .replaceAll('{b}', b)
    .replaceAll('{f}', f === null ? '' : f < 0 ? `B${-f}` : String(f))
    .replaceAll('{uu}', uu)
    .replaceAll('{u}', u)
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim();
}

export function generateUnitList(input: GenerateInput): GeneratedUnit[] {
  const buildings = input.buildings.length ? input.buildings.map((b) => b.trim()) : [''];
  if (!input.pattern.includes('{u}') && !input.pattern.includes('{uu}')) {
    throw new DomainError('命名規則必須包含 {u} 或 {uu}（戶號）');
  }
  if (buildings.filter(Boolean).length > 1 && !input.pattern.includes('{b}')) {
    throw new DomainError('有多個棟別時，命名規則必須包含 {b}（棟別），否則門牌會重複');
  }
  const from = Math.min(input.floorFrom, input.floorTo);
  const to = Math.max(input.floorFrom, input.floorTo);
  if (to - from > 200) throw new DomainError('樓層範圍太大');
  const skip = new Set(input.skipFloors ?? []);
  const numbers =
    input.unitNumbers && input.unitNumbers.length
      ? input.unitNumbers.map((n) => n.trim()).filter(Boolean)
      : Array.from({ length: Math.max(0, input.unitsPerFloor ?? 0) }, (_, i) => String(i + 1));
  if (!numbers.length) throw new DomainError('請設定每層戶數或戶號');

  const out: GeneratedUnit[] = [];
  const seen = new Set<string>();
  for (const b of buildings) {
    for (let f = from; f <= to; f++) {
      if (f === 0 || skip.has(f)) continue;
      for (const n of numbers) {
        const label = renderLabel(input.pattern, b, f, n);
        if (!label) continue;
        if (seen.has(label)) throw new DomainError(`命名規則產生了重複的門牌「${label}」，請調整規則`);
        seen.add(label);
        out.push({ building: b, floor: f, number: n, label });
      }
    }
  }
  if (out.length > 3000) throw new DomainError('一次最多產生 3000 戶');
  return out;
}

/** 搜尋用代號：去掉符號後的大寫字串，例如 A-14-1 → A141 */
export function toSearchKey(label: string): string {
  return label
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-_/.,]+/g, '')
    .replace(/[棟樓之號]/g, '');
}

function sortKeyFor(buildingOrder: number, floor: number | null, number: string): string {
  const b = String(buildingOrder).padStart(3, '0');
  const f = String((floor ?? 0) + 100).padStart(4, '0');
  const n = /^\d+$/.test(number) ? number.padStart(6, '0') : number.padEnd(6, ' ');
  return `${b}|${f}|${n}`;
}

async function newBindCode(): Promise<string> {
  // 31^8 ≈ 8.5 × 10^11 種組合，碰撞機率極低；仍檢查一次
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8);
    const [hit] = await db().select({ id: schema.units.id }).from(schema.units).where(eq(schema.units.bindCode, code)).limit(1);
    if (!hit) return code;
  }
  throw new Error('無法產生不重複的綁定碼');
}

async function ensureBuildings(communityId: string, names: string[]) {
  const unique = [...new Set(names.filter(Boolean))];
  const existing = await db().select().from(schema.buildings).where(eq(schema.buildings.communityId, communityId));
  const map = new Map(existing.map((b) => [b.name, b]));
  let order = existing.reduce((m, b) => Math.max(m, b.sortOrder), 0);
  for (const name of unique) {
    if (!map.has(name)) {
      const [b] = await db()
        .insert(schema.buildings)
        .values({ communityId, name, sortOrder: ++order })
        .onConflictDoNothing()
        .returning();
      if (b) map.set(name, b);
    }
  }
  return map;
}

/** 批次建立戶別；已存在的門牌會略過。回傳新增數量 */
export async function createUnits(scope: Scope, list: GeneratedUnit[], action: 'unit.generate' | 'unit.import' = 'unit.generate') {
  if (!list.length) return { created: 0, skipped: 0 };
  const existing = await db()
    .select({ label: schema.units.label })
    .from(schema.units)
    .where(and(eq(schema.units.communityId, scope.communityId), inArray(schema.units.label, list.map((u) => u.label))));
  const existingLabels = new Set(existing.map((e) => e.label));
  const toCreate = list.filter((u) => !existingLabels.has(u.label));
  await assertWithinUnitLimit(scope.communityId, toCreate.length);
  const buildingMap = await ensureBuildings(scope.communityId, toCreate.map((u) => u.building));

  const rows = [];
  for (const u of toCreate) {
    const b = u.building ? buildingMap.get(u.building) : undefined;
    rows.push({
      communityId: scope.communityId,
      buildingId: b?.id ?? null,
      floor: u.floor,
      number: u.number,
      label: u.label,
      searchKey: toSearchKey(u.label),
      sortKey: sortKeyFor(b?.sortOrder ?? 0, u.floor, u.number),
      bindCode: await newBindCode(),
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db().insert(schema.units).values(rows.slice(i, i + 500));
  }
  await audit(scope.actor, action, {
    communityId: scope.communityId,
    entityType: 'unit',
    data: { created: rows.length, skipped: existingLabels.size },
  });
  return { created: rows.length, skipped: list.length - rows.length };
}

export async function createSingleUnit(scope: Scope, input: { building: string; floor: number | null; number: string; label?: string }) {
  const number = input.number.trim();
  if (!number) throw new DomainError('請輸入戶號');
  const label = (input.label?.trim() || renderLabel(input.building ? '{b}-{f}-{u}' : '{f}-{u}', input.building.trim(), input.floor, number)).trim();
  const result = await createUnits(scope, [{ building: input.building.trim(), floor: input.floor, number, label }], 'unit.generate');
  if (!result.created) throw new DomainError(`門牌「${label}」已經存在`);
  return label;
}

export async function updateUnit(scope: Scope, unitId: string, input: { label: string; status: 'active' | 'vacant'; note?: string | null }) {
  const label = input.label.trim();
  if (!label) throw new DomainError('門牌不能空白');
  const unit = await getUnit(scope.communityId, unitId);
  if (label !== unit.label) {
    const [dup] = await db()
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(and(eq(schema.units.communityId, scope.communityId), eq(schema.units.label, label)))
      .limit(1);
    if (dup) throw new DomainError(`門牌「${label}」已經存在`);
  }
  await db()
    .update(schema.units)
    .set({ label, searchKey: toSearchKey(label), status: input.status, note: input.note?.trim() || null })
    .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, scope.communityId)));
  await audit(scope.actor, 'unit.update', {
    communityId: scope.communityId,
    entityType: 'unit',
    entityId: unitId,
    data: { from: unit.label, label, status: input.status },
  });
}

export async function deleteUnit(scope: Scope, unitId: string) {
  const unit = await getUnit(scope.communityId, unitId);
  const [p] = await db().select({ id: schema.parcels.id }).from(schema.parcels).where(eq(schema.parcels.unitId, unitId)).limit(1);
  if (p) throw new DomainError('這戶已有包裹紀錄，不能刪除。可以改成「空戶」');
  await db().delete(schema.units).where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, scope.communityId)));
  await audit(scope.actor, 'unit.delete', { communityId: scope.communityId, entityType: 'unit', entityId: unitId, data: { label: unit.label } });
}

export async function getUnit(communityId: string, unitId: string) {
  const [u] = await db()
    .select()
    .from(schema.units)
    .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, communityId)))
    .limit(1);
  if (!u) throw new DomainError('找不到這個戶別');
  return u;
}

export async function rotateBindCode(scope: Scope, unitId: string) {
  await getUnit(scope.communityId, unitId);
  const code = await newBindCode();
  await db()
    .update(schema.units)
    .set({ bindCode: code, bindCodeUpdatedAt: new Date() })
    .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, scope.communityId)));
  await audit(scope.actor, 'unit.rotate_code', { communityId: scope.communityId, entityType: 'unit', entityId: unitId });
  return code;
}

/** 遷出：移除這戶所有住戶並更換綁定碼，舊住戶就收不到新住戶的通知 */
export async function moveOut(scope: Scope, unitId: string) {
  const unit = await getUnit(scope.communityId, unitId);
  const removed = await db()
    .update(schema.residents)
    .set({ status: 'removed', removedAt: new Date(), tokenVersion: sql`${schema.residents.tokenVersion} + 1` })
    .where(and(eq(schema.residents.unitId, unitId), eq(schema.residents.communityId, scope.communityId), eq(schema.residents.status, 'active')))
    .returning({ id: schema.residents.id });
  const code = await newBindCode();
  await db().update(schema.units).set({ bindCode: code, bindCodeUpdatedAt: new Date() }).where(eq(schema.units.id, unitId));
  await audit(scope.actor, 'unit.move_out', {
    communityId: scope.communityId,
    entityType: 'unit',
    entityId: unitId,
    data: { label: unit.label, removedResidents: removed.length },
  });
  return { removed: removed.length };
}

export async function listUnits(communityId: string, opts: { q?: string; buildingId?: string; status?: 'active' | 'vacant' } = {}) {
  const conds = [eq(schema.units.communityId, communityId)];
  if (opts.q?.trim()) {
    const q = opts.q.trim();
    conds.push(or(ilike(schema.units.label, `%${q}%`), ilike(schema.units.searchKey, `%${toSearchKey(q)}%`))!);
  }
  if (opts.buildingId) conds.push(eq(schema.units.buildingId, opts.buildingId));
  if (opts.status) conds.push(eq(schema.units.status, opts.status));
  return db()
    .select({
      unit: schema.units,
      buildingName: schema.buildings.name,
      residentCount: sql<number>`(select count(*)::int from app.residents r where r.unit_id = ${schema.units.id} and r.status = 'active')`,
      waitingCount: sql<number>`(select coalesce(sum(p.quantity),0)::int from app.parcels p where p.unit_id = ${schema.units.id} and p.status = 'waiting')`,
    })
    .from(schema.units)
    .leftJoin(schema.buildings, eq(schema.units.buildingId, schema.buildings.id))
    .where(and(...conds))
    .orderBy(asc(schema.units.sortKey), asc(schema.units.label));
}

export async function listBuildings(communityId: string) {
  return db().select().from(schema.buildings).where(eq(schema.buildings.communityId, communityId)).orderBy(asc(schema.buildings.sortOrder));
}

/** 收件畫面的快速搜尋：輸入 A141、14-1、a 14 1 都能找到 */
export async function searchUnits(communityId: string, q: string, limit = 12) {
  const key = toSearchKey(q);
  if (!key) return [];
  return db()
    .select({ id: schema.units.id, label: schema.units.label, status: schema.units.status })
    .from(schema.units)
    .where(
      and(
        eq(schema.units.communityId, communityId),
        or(ilike(schema.units.searchKey, `${key}%`), ilike(schema.units.searchKey, `%${key}%`), ilike(schema.units.label, `%${q.trim()}%`)),
      ),
    )
    .orderBy(sql`case when ${schema.units.searchKey} = ${key} then 0 when ${schema.units.searchKey} like ${key + '%'} then 1 else 2 end`, asc(schema.units.sortKey))
    .limit(limit);
}

// ───────────────────────────── CSV 匯入匯出 ─────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // 防止 CSV 公式注入（Excel 會執行 = + - @ 開頭的儲存格）
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** CSV 欄位：門牌,棟別,樓層,戶號（第一列為標題） */
export function parseUnitsCsv(text: string): GeneratedUnit[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new DomainError('CSV 是空的');
  const header = rows[0].map((h) => h.trim());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h.toLowerCase()) || names.includes(h));
  const iLabel = idx(['門牌', 'label']);
  const iBuilding = idx(['棟別', 'building']);
  const iFloor = idx(['樓層', 'floor']);
  const iNumber = idx(['戶號', 'number']);
  if (iLabel < 0) throw new DomainError('CSV 第一列需要有「門牌」欄位');
  const out: GeneratedUnit[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const label = (r[iLabel] ?? '').trim();
    if (!label) return;
    if (seen.has(label)) throw new DomainError(`第 ${i + 2} 列：門牌「${label}」重複`);
    seen.add(label);
    const floorRaw = iFloor >= 0 ? (r[iFloor] ?? '').trim() : '';
    const floor = floorRaw ? Number(floorRaw.replace(/^B/i, '-')) : null;
    if (floorRaw && !Number.isFinite(floor)) throw new DomainError(`第 ${i + 2} 列：樓層「${floorRaw}」不是數字`);
    out.push({
      label,
      building: iBuilding >= 0 ? (r[iBuilding] ?? '').trim() : '',
      floor,
      number: iNumber >= 0 && (r[iNumber] ?? '').trim() ? r[iNumber].trim() : label,
    });
  });
  if (out.length > 3000) throw new DomainError('一次最多匯入 3000 戶');
  return out;
}

export async function exportUnitsCsv(communityId: string, includeCodes: boolean) {
  const rows = await listUnits(communityId);
  const header = ['門牌', '棟別', '樓層', '戶號', '狀態', '住戶數', ...(includeCodes ? ['綁定碼'] : [])];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.unit.label,
      r.buildingName ?? '',
      r.unit.floor ?? '',
      r.unit.number,
      r.unit.status === 'active' ? '使用中' : '空戶',
      r.residentCount,
      ...(includeCodes ? [r.unit.bindCode] : []),
    ]),
  ]);
}
