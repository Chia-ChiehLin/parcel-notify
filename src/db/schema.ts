import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * 所有 v2 資料表放在獨立的 `app` schema，
 * 不會和 v1（public schema 的 apartments / notifications）互相衝突。
 */
export const app = pgSchema('app');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

// ───────────────────────────── 方案與客戶 ─────────────────────────────

export type PlanFeatures = {
  email: boolean;
  photos: boolean;
  sms: boolean;
  ownLine: boolean;
};

export const plans = app.table('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  maxUnits: integer('max_units').notNull(),
  maxStaff: integer('max_staff').notNull(),
  monthlyPrice: integer('monthly_price').notNull().default(0),
  features: jsonb('features').$type<PlanFeatures>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const organizations = app.table('organizations', {
  id: id(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  note: text('note'),
  createdAt: createdAt(),
});

export type CommunityStatus = 'trial' | 'active' | 'suspended' | 'cancelled';
export type LineMode = 'shared' | 'own' | 'none';

export const communities = app.table(
  'communities',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    address: text('address'),
    timezone: text('timezone').notNull().default('Asia/Taipei'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: text('status').$type<CommunityStatus>().notNull().default('trial'),
    trialEndsAt: ts('trial_ends_at'),
    paidUntil: date('paid_until'),
    lineMode: text('line_mode').$type<LineMode>().notNull().default('shared'),
    /** 設定 JSON，格式見 src/domain/settings.ts */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    setupCompletedAt: ts('setup_completed_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('communities_org_idx').on(t.orgId)],
);

// ───────────────────────────── 帳號與權限 ─────────────────────────────

export const users = app.table('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
});

export type MembershipRole = 'org_admin' | 'community_admin' | 'staff';

export const memberships = app.table(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
    role: text('role').$type<MembershipRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('memberships_user_idx').on(t.userId),
    index('memberships_community_idx').on(t.communityId),
    uniqueIndex('memberships_unique').on(t.userId, t.orgId, t.communityId),
  ],
);

export const sessions = app.table(
  'sessions',
  {
    /** sha256(cookie token)，資料庫裡不存原始 token */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type AuthTokenPayload = {
  role?: MembershipRole;
  orgId?: string;
  communityId?: string;
  name?: string;
};

export const authTokens = app.table(
  'auth_tokens',
  {
    id: id(),
    kind: text('kind').$type<'invite' | 'reset'>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<AuthTokenPayload>().notNull().default({}),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_email_idx').on(t.email)],
);

export const loginAttempts = app.table(
  'login_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_key_idx').on(t.key, t.createdAt)],
);

// ───────────────────────────── 戶別與住戶 ─────────────────────────────

export const buildings = app.table(
  'buildings',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('buildings_unique').on(t.communityId, t.name)],
);

export const units = app.table(
  'units',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id').references(() => buildings.id, { onDelete: 'set null' }),
    floor: integer('floor'),
    number: text('number').notNull(),
    /** 顯示用門牌，例如 A-14-1 */
    label: text('label').notNull(),
    /** 搜尋用：去掉符號的大寫門牌，例如 A141 */
    searchKey: text('search_key').notNull(),
    sortKey: text('sort_key').notNull(),
    /** 住戶綁定碼（全平台唯一，可隨時換新） */
    bindCode: text('bind_code').notNull().unique(),
    bindCodeUpdatedAt: ts('bind_code_updated_at').notNull().defaultNow(),
    /** 最近一次遷出的時間；住戶端只可查閱本次入住期間收件的包裹。 */
    occupancyStartedAt: ts('occupancy_started_at'),
    status: text('status').$type<'active' | 'vacant'>().notNull().default('active'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('units_label_unique').on(t.communityId, t.label),
    index('units_sort_idx').on(t.communityId, t.sortKey),
    index('units_search_idx').on(t.communityId, t.searchKey),
  ],
);

export const lineChannels = app.table('line_channels', {
  id: id(),
  /** null 代表平台共用的官方帳號 */
  communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  channelId: text('channel_id'),
  basicId: text('basic_id'),
  displayName: text('display_name'),
  secretEnc: text('secret_enc').notNull(),
  tokenEnc: text('token_enc').notNull(),
  /** Webhook 網址中的隨機識別碼 */
  webhookKey: text('webhook_key').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  verifiedAt: ts('verified_at'),
  richMenuId: text('rich_menu_id'),
  createdAt: createdAt(),
});

export const residents = app.table(
  'residents',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull().default(''),
    lineUserId: text('line_user_id'),
    lineChannelId: uuid('line_channel_id').references(() => lineChannels.id, { onDelete: 'set null' }),
    lineFollowing: boolean('line_following').notNull().default(true),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    notifyLine: boolean('notify_line').notNull().default(true),
    notifyEmail: boolean('notify_email').notNull().default(false),
    emailFallbackOnly: boolean('email_fallback_only').notNull().default(false),
    verifiedEmail: text('verified_email'),
    emailVerifiedAt: ts('email_verified_at'),
    language: text('language').notNull().default('zh-TW'),
    /** 換掉這個數字就能讓舊的住戶連結全部失效 */
    tokenVersion: integer('token_version').notNull().default(1),
    status: text('status').$type<'active' | 'removed'>().notNull().default('active'),
    boundAt: ts('bound_at').notNull().defaultNow(),
    removedAt: ts('removed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('residents_unit_idx').on(t.unitId),
    index('residents_line_idx').on(t.lineChannelId, t.lineUserId),
    uniqueIndex('residents_unit_line_unique')
      .on(t.unitId, t.lineChannelId, t.lineUserId)
      .where(sql`status = 'active' and line_user_id is not null`),
  ],
);

// One outstanding, address-bound challenge per resident. Only a keyed digest is stored.
export const residentEmailChallenges = app.table('resident_email_challenges', {
  residentId: uuid('resident_id').primaryKey().references(() => residents.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  tries: integer('tries').notNull().default(0),
});

export const bindAttempts = app.table(
  'bind_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('bind_attempts_key_idx').on(t.key, t.createdAt)],
);

// ───────────────────────────── 包裹 ─────────────────────────────

export const PARCEL_CATEGORIES = ['cold', 'frozen', 'large', 'registered', 'document', 'fragile'] as const;
export type ParcelCategory = (typeof PARCEL_CATEGORIES)[number];
export type ParcelStatus = 'waiting' | 'picked_up' | 'returned' | 'cancelled';
export type NotifyStatus = 'pending' | 'sending' | 'sent' | 'partial' | 'failed' | 'no_recipient' | 'skipped';
export type PickupMethod = 'qr' | 'code' | 'proxy' | 'manual';

export const parcels = app.table(
  'parcels',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id'),
    carrier: text('carrier'),
    trackingNo: text('tracking_no'),
    categories: text('categories').array().$type<ParcelCategory[]>().notNull().default(sql`'{}'::text[]`),
    storageLocation: text('storage_location'),
    quantity: integer('quantity').notNull().default(1),
    note: text('note'),
    photoKey: text('photo_key'),
    pickupCode: text('pickup_code').notNull(),
    status: text('status').$type<ParcelStatus>().notNull().default('waiting'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    notifyStatus: text('notify_status').$type<NotifyStatus>().notNull().default('pending'),
    notifiedAt: ts('notified_at'),
    pickedUpAt: ts('picked_up_at'),
    pickedUpBy: uuid('picked_up_by').references(() => users.id, { onDelete: 'set null' }),
    pickupMethod: text('pickup_method').$type<PickupMethod>(),
    pickupResidentId: uuid('pickup_resident_id').references(() => residents.id, { onDelete: 'set null' }),
    pickupName: text('pickup_name'),
    signatureKey: text('signature_key'),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastRemindedAt: ts('last_reminded_at'),
    closedNote: text('closed_note'),
    closedAt: ts('closed_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('parcels_status_idx').on(t.communityId, t.status, t.receivedAt),
    index('parcels_unit_idx').on(t.unitId, t.status),
    index('parcels_tracking_idx').on(t.communityId, t.trackingNo),
    index('parcels_received_idx').on(t.communityId, t.receivedAt),
    uniqueIndex('parcels_pickup_code_unique').on(t.communityId, t.pickupCode).where(sql`status = 'waiting'`),
  ],
);

export const proxyCodes = app.table(
  'proxy_codes',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    residentId: uuid('resident_id').references(() => residents.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    proxyName: text('proxy_name'),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('proxy_codes_code_unique').on(t.communityId, t.code)],
);

// ───────────────────────────── 通知與用量 ─────────────────────────────

export type NotificationChannel = 'line' | 'email' | 'sms';
export type NotificationKind = 'arrival' | 'reminder' | 'pickup' | 'system';

export const notifications = app.table(
  'notifications',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    residentId: uuid('resident_id').references(() => residents.id, { onDelete: 'set null' }),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    kind: text('kind').$type<NotificationKind>().notNull(),
    parcelIds: uuid('parcel_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: text('status').$type<'sent' | 'failed'>().notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_community_idx').on(t.communityId, t.createdAt)],
);

export const usageCounters = app.table(
  'usage_counters',
  {
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    /** YYYY-MM（台灣時間） */
    month: text('month').notNull(),
    linePush: integer('line_push').notNull().default(0),
    email: integer('email').notNull().default(0),
    sms: integer('sms').notNull().default(0),
    parcels: integer('parcels').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.month] })],
);

// ───────────────────────────── 稽核、收款、檔案 ─────────────────────────────

export type ActorType = 'user' | 'resident' | 'system' | 'line';

export const auditLogs = app.table(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').$type<ActorType>().notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_community_idx').on(t.communityId, t.createdAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const billingRecords = app.table(
  'billing_records',
  {
    id: id(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    paidAt: date('paid_at').notNull(),
    method: text('method'),
    invoiceNo: text('invoice_no'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('billing_community_idx').on(t.communityId, t.periodEnd)],
);

/** 沒有設定 Vercel Blob 時（本機開發、測試）用資料庫存檔 */
export const files = app.table('files', {
  key: text('key').primaryKey(),
  communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});
