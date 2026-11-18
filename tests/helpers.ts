import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db, schema } from '@/db';
import { setGateways, type EmailGateway, type EmailMessage, type LineGateway, type LineMessage } from '@/channels/gateway';
import type { Actor } from '@/domain/audit';
import { createCommunity, updateCommunitySettings } from '@/domain/communities';
import { configureChannel } from '@/domain/line-channels';
import { createUnits, generateUnitList } from '@/domain/units';
import type { CommunitySettings } from '@/domain/settings';

export const ADMIN: Actor = { type: 'user', id: null, name: '測試管理員' };

type Sent = { kind: 'push' | 'reply'; to: string; messages: LineMessage[] };

/** 假的 LINE / Email：記錄送出的訊息，可以設定讓某些收件人失敗 */
export const fakes = {
  line: [] as Sent[],
  email: [] as EmailMessage[],
  failLineFor: new Set<string>(),
  emailConfigured: true,
  webhookUrl: '' as string,
  endpoints: new Map<string, string>(),
  webhookCalls: [] as { op: 'get' | 'set' | 'test'; url?: string }[],
  webhookResult: { success: true, statusCode: 200 },
  webhookActive: true,
  afterCandidateTest: undefined as undefined | ((token: string) => void),
  reset() {
    this.line = [];
    this.email = [];
    this.failLineFor = new Set();
    this.emailConfigured = true;
    this.webhookUrl = '';
    this.endpoints.clear();
    this.webhookCalls = [];
    this.webhookResult = { success: true, statusCode: 200 };
    this.webhookActive = true;
    this.afterCandidateTest = undefined;
  },
  pushes() {
    return this.line.filter((s) => s.kind === 'push');
  },
  replies() {
    return this.line.filter((s) => s.kind === 'reply');
  },
};

const fakeLine: LineGateway = {
  async push(_c, to, messages) {
    if (fakes.failLineFor.has(to)) throw new Error('LINE push failed (fake)');
    fakes.line.push({ kind: 'push', to, messages });
  },
  async reply(_c, replyToken, messages) {
    fakes.line.push({ kind: 'reply', to: replyToken, messages });
  },
  async getBotInfo(creds) {
    if (creds.accessToken.startsWith('bad')) throw new Error('401');
    return { basicId: '@testbot', displayName: '測試官方帳號', userId: 'U' + createHash('sha256').update(creds.accessToken).digest('hex').slice(0, 32) };
  },
  async getWebhook(creds) {
    fakes.webhookCalls.push({ op: 'get' });
    const endpoint = fakes.endpoints.get(creds.accessToken);
    return endpoint ? { endpoint, active: fakes.webhookActive } : null;
  },
  async setWebhook(creds, url) {
    fakes.webhookCalls.push({ op: 'set', url });
    fakes.endpoints.set(creds.accessToken, url);
    fakes.webhookUrl = url;
  },
  async testWebhook(creds, url) {
    fakes.webhookCalls.push({ op: 'test', url });
    fakes.afterCandidateTest?.(creds.accessToken);
    return fakes.webhookResult;
  },
  async getProfile(_c, userId) {
    return { displayName: `User ${userId.slice(-4)}` };
  },
  async getQuota() {
    return { limit: 200, used: 10 };
  },
  async createRichMenu() {
    return 'richmenu-test';
  },
};

const fakeEmail: EmailGateway = {
  isConfigured: () => fakes.emailConfigured,
  async send(msg) {
    fakes.email.push(msg);
  },
};

setGateways({ line: fakeLine, email: fakeEmail });

export const TEST_SECRET = '0123456789abcdef0123456789abcdef';
export const TEST_TOKEN = 'T'.repeat(150);

/** 建立一個有 A/B 棟、1–3 樓、每層 2 戶的測試社區，並設定共用 LINE 帳號 */
export async function makeCommunity(opts: { slug?: string; settings?: Partial<CommunitySettings>; planCode?: string; withChannel?: boolean } = {}) {
  const [plan] = await db()
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, opts.planCode ?? 'pro'));
  const community = await createCommunity(ADMIN, {
    name: `測試社區 ${opts.slug ?? 'a'}`,
    slug: opts.slug ?? 'test-a',
    planId: plan.id,
    trialDays: 30,
    lineMode: 'shared',
  });
  const scope = { communityId: community.id, actor: ADMIN };
  await createUnits(scope, generateUnitList({ buildings: ['A', 'B'], floorFrom: 1, floorTo: 3, unitsPerFloor: 2, pattern: '{b}-{f}-{u}' }));
  if (opts.settings) await updateCommunitySettings(ADMIN, community.id, opts.settings);
  let channel = null;
  if (opts.withChannel !== false) {
    const existing = await db().select().from(schema.lineChannels);
    channel = existing.find((c) => c.communityId === null) ?? (await configureChannel(ADMIN, { communityId: null, name: '共用帳號', channelSecret: TEST_SECRET, accessToken: TEST_TOKEN, setupWebhook: true })).channel;
  }
  const [fresh] = await db().select().from(schema.communities).where(eq(schema.communities.id, community.id));
  const units = await db().select().from(schema.units).where(eq(schema.units.communityId, community.id));
  const unit = (label: string) => units.find((u) => u.label === label)!;
  return { community: fresh, scope, channel, units, unit };
}
