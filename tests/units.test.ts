import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { createUnits, generateUnitList, moveOut, parseCsv, parseUnitsCsv, searchUnits, toCsv, toSearchKey } from '@/domain/units';
import { bindByCode } from '@/domain/residents';
import { makeCommunity } from './helpers';

describe('戶別產生器', () => {
  it('依棟別、樓層、每層戶數產生門牌，並跳過指定樓層', () => {
    const list = generateUnitList({ buildings: ['A', 'B'], floorFrom: 1, floorTo: 16, unitsPerFloor: 4, pattern: '{b}-{f}-{u}', skipFloors: [4] });
    expect(list).toHaveLength(2 * 15 * 4);
    expect(list[0].label).toBe('A-1-1');
    expect(list.some((u) => u.floor === 4)).toBe(false);
    expect(list.at(-1)!.label).toBe('B-16-4');
  });

  it('地下室與兩位數戶號格式', () => {
    const list = generateUnitList({ buildings: ['A'], floorFrom: -1, floorTo: 2, unitNumbers: ['1', '2'], pattern: '{b}{f}{uu}' });
    expect(list.map((u) => u.label)).toEqual(['AB101', 'AB102', 'A101', 'A102', 'A201', 'A202']);
  });

  it('多棟但格式沒有棟別時拒絕（避免門牌重複）', () => {
    expect(() => generateUnitList({ buildings: ['A', 'B'], floorFrom: 1, floorTo: 2, unitsPerFloor: 2, pattern: '{f}-{u}' })).toThrow('{b}');
  });

  it('搜尋代號：A-14-1、a 14 1、A棟14樓之1 都能用 A141 找到', async () => {
    expect(toSearchKey('A-14-1')).toBe('A141');
    expect(toSearchKey('a 14 1')).toBe('A141');
    expect(toSearchKey('A棟14樓之1')).toBe('A141');
    const { community } = await makeCommunity();
    const r = await searchUnits(community.id, 'a21');
    expect(r[0].label).toBe('A-2-1');
  });

  it('方案戶數上限', async () => {
    const { scope } = await makeCommunity({ planCode: 'basic' }); // 150 戶上限，已有 12 戶
    const big = generateUnitList({ buildings: ['C'], floorFrom: 1, floorTo: 50, unitsPerFloor: 3, pattern: '{b}-{f}-{u}' });
    await expect(createUnits(scope, big)).rejects.toThrow('戶數上限');
  });

  it('遷出會移除住戶、換新綁定碼，舊碼不能再用', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const u = unit('A-1-1');
    await bindByCode({ channel: channel!, lineUserId: 'U-old', code: u.bindCode });
    const res = await moveOut(scope, u.id);
    expect(res.removed).toBe(1);
    const [after] = await db().select().from(schema.units).where(eq(schema.units.id, u.id));
    expect(after.bindCode).not.toBe(u.bindCode);
    expect((await bindByCode({ channel: channel!, lineUserId: 'U-new', code: u.bindCode })).status).toBe('bad_code');
  });
});

describe('CSV', () => {
  it('解析含引號、逗號、BOM 的 CSV', () => {
    expect(parseCsv('﻿門牌,備註\r\n"A-1-1","有,逗號"\n"B-2-""3""",x\n')).toEqual([
      ['門牌', '備註'],
      ['A-1-1', '有,逗號'],
      ['B-2-"3"', 'x'],
    ]);
  });

  it('匯入戶別 CSV，重複門牌回報列號', () => {
    expect(parseUnitsCsv('門牌,棟別,樓層,戶號\nA-1-1,A,1,1\nB1-1,B,-1,1').map((u) => [u.label, u.floor])).toEqual([
      ['A-1-1', 1],
      ['B1-1', -1],
    ]);
    expect(() => parseUnitsCsv('門牌\nA\nA')).toThrow('第 3 列');
  });

  it('匯出時防止公式注入', () => {
    const csv = toCsv([['=HYPERLINK("x")', '+1', 'ok']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+1");
  });
});

describe('戶別與入住期間的一致性', () => {
  it('同一份門牌重複送出會合併，同一戶只有一個綁定碼', async () => {
    const { scope } = await makeCommunity();
    const list = generateUnitList({ buildings: ['C'], floorFrom: 1, floorTo: 3, unitsPerFloor: 2, pattern: '{b}-{f}-{u}' });
    const results = await Promise.all([createUnits(scope, list), createUnits(scope, list)]);
    expect(results.map((row) => row.created).sort()).toEqual([0, 6]);
    expect(results.map((row) => row.skipped).sort()).toEqual([0, 6]);
  });

  it('不同批次同時匯入只接受不超出方案的一批', async () => {
    const { scope } = await makeCommunity({ planCode: 'basic' });
    const batch = (name: string) => generateUnitList({ buildings: [name], floorFrom: 1, floorTo: 40, unitsPerFloor: 2, pattern: '{b}-{f}-{u}' });
    const results = await Promise.allSettled([createUnits(scope, batch('C')), createUnits(scope, batch('D'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const units = await db().select({ id: schema.units.id }).from(schema.units).where(eq(schema.units.communityId, scope.communityId));
    expect(units).toHaveLength(92);
  });

  it('遷出與 LINE 綁定一起處理時，最後只保留空戶與新的綁定碼', async () => {
    const { scope, channel, unit } = await makeCommunity();
    const previous = unit('A-1-1');
    await Promise.all([bindByCode({ channel: channel!, lineUserId: 'U-a', code: previous.bindCode }), moveOut(scope, previous.id)]);
    const [updated] = await db().select().from(schema.units).where(eq(schema.units.id, previous.id));
    const members = await db().select().from(schema.residents).where(eq(schema.residents.unitId, previous.id));
    expect(members.filter((r) => r.status === 'active')).toHaveLength(0);
    expect(updated.status).toBe('vacant');
    expect(updated.occupancyStartedAt).toBeInstanceOf(Date);
    expect(updated.bindCode).not.toBe(previous.bindCode);
  });

  it('匯出地下樓層仍為數值，試算表公式形狀的字串保留為文字', () => {
    const csv = toCsv([[-2, '  +1', '＠住戶']]);
    expect(parseCsv(csv)).toEqual([['-2', "'  +1", "'＠住戶"]]);
  });
});
