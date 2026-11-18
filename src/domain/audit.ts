import { db, schema, type DB } from '@/db';
import type { ActorType } from '@/db/schema';

export type Actor = {
  type: ActorType;
  id?: string | null;
  name?: string | null;
  ip?: string | null;
};

export const SYSTEM_ACTOR: Actor = { type: 'system', name: '系統' };

export async function audit(
  actor: Actor,
  action: string,
  opts: {
    communityId?: string | null;
    entityType?: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  } = {},
  database: Pick<DB, 'insert'> = db(),
) {
  await database
    .insert(schema.auditLogs)
    .values({
      communityId: opts.communityId ?? null,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorName: actor.name ?? null,
      action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      data: opts.data,
      ip: actor.ip ?? null,
    });
}

/** 稽核紀錄的中文說明，給後台顯示用 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'community.create': '建立社區',
  'community.update': '修改社區資料',
  'community.settings': '修改社區設定',
  'community.status': '變更社區狀態',
  'community.platform_access': '平台管理員進入社區後台',
  'unit.export': '匯出戶別紀錄',
  'parcel.export': '匯出包裹紀錄',
  'unit.generate': '批次產生戶別',
  'unit.import': '匯入戶別',
  'unit.create': '新增戶別',
  'unit.update': '修改戶別',
  'unit.delete': '刪除戶別',
  'unit.rotate_code': '更換綁定碼',
  'unit.move_out': '遷出重設',
  'resident.bind': '住戶綁定',
  'resident.remove': '移除住戶',
  'resident.update_email': '變更住戶通知信箱',
  'resident.email_verified': '驗證住戶信箱',
  'resident.update': '修改住戶',
  'resident.set_primary': '設定主要聯絡人',
  'parcel.receive': '登記包裹',
  'parcel.update': '修改包裹',
  'parcel.pickup': '交付包裹',
  'parcel.return': '退件',
  'parcel.cancel': '取消登記',
  'parcel.notify': '發送通知',
  'parcel.remind': '逾期提醒',
  'proxy.create': '建立代領碼',
  'staff.invite': '邀請人員',
  'staff.remove': '移除人員',
  'staff.role': '變更人員角色',
  'line.configure': '設定 LINE 官方帳號',
  'line.rich_menu': '建立圖文選單',
  'billing.record': '新增收款紀錄',
  'user.login': '登入',
  'user.password_reset': '重設密碼',
  'retention.purge': '清除過期資料',
};
