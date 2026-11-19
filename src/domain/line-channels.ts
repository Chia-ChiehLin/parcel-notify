import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { lineGateway, LineSetupError, type LineCreds } from '@/channels/gateway';
import { decrypt, encrypt, randomToken } from '@/lib/crypto';
import { appUrl } from '@/lib/env';
import { audit, type Actor } from './audit';
import { DomainError } from './types';

export type ChannelRow = typeof schema.lineChannels.$inferSelect;
export type ResolvedChannel = { channel: ChannelRow; creds: LineCreds };

export function credsOf(channel: ChannelRow): LineCreds {
  try {
    return { accessToken: decrypt(channel.tokenEnc), secret: decrypt(channel.secretEnc) };
  } catch {
    throw new DomainError('本站無法解密已儲存的 LINE 憑證，請由服務商核對部署的 APP_SECRET 與資料庫是否配對。');
  }
}

export function webhookUrlFor(channel: Pick<ChannelRow, 'webhookKey'>) {
  return `${appUrl()}/api/line/webhook/${channel.webhookKey}`;
}

function endpointHost(endpoint: string) {
  return URL.canParse(endpoint) ? new URL(endpoint).hostname : '未知網域';
}

export async function getChannelByWebhookKey(key: string) {
  const [c] = await db().select().from(schema.lineChannels).where(eq(schema.lineChannels.webhookKey, key)).limit(1);
  return c ?? null;
}

export async function getSharedChannel() {
  const [c] = await db()
    .select()
    .from(schema.lineChannels)
    .where(and(isNull(schema.lineChannels.communityId), eq(schema.lineChannels.isActive, true)))
    .limit(1);
  return c ?? null;
}

export async function getOwnChannel(communityId: string) {
  const [c] = await db().select().from(schema.lineChannels).where(eq(schema.lineChannels.communityId, communityId)).limit(1);
  return c ?? null;
}

/** 社區目前使用的 LINE 頻道（依 lineMode 決定共用或自有） */
export async function resolveCommunityChannel(community: { id: string; lineMode: string }): Promise<ResolvedChannel | null> {
  let channel: ChannelRow | null = null;
  if (community.lineMode === 'shared') channel = await getSharedChannel();
  else if (community.lineMode === 'own') channel = await getOwnChannel(community.id);
  if (!channel || !channel.isActive) return null;
  return { channel, creds: credsOf(channel) };
}

/** 這個頻道是否可以服務這個社區（防止 A 社區的綁定碼在 B 社區的官方帳號被使用） */
export function channelServesCommunity(channel: ChannelRow, community: { id: string; lineMode: string }) {
  if (community.lineMode === 'shared') return channel.communityId === null;
  if (community.lineMode === 'own') return channel.communityId === community.id;
  return false;
}

export type WebhookSetup = {
  state: 'saved' | 'waiting' | 'enable' | 'ready' | 'unknown';
  message: string;
};

function checkDestination(current: { endpoint: string } | null, expected: string) {
  if (current?.endpoint && current.endpoint !== expected) {
    throw new DomainError(`Webhook 已指向其他網址（${endpointHost(current.endpoint)}）。請先向該服務的負責人確認用途。`);
  }
}

function setupError(stage: string, error: unknown) {
  return new DomainError(`${stage}時，${error instanceof LineSetupError ? error.message : '未能取得 LINE API 的確認，請稍後重試。'}`);
}

async function currentWebhook(creds: LineCreds) {
  try {
    return await lineGateway().getWebhook(creds);
  } catch (error) {
    throw setupError('讀取 LINE Webhook 設定', error);
  }
}

async function testSiteWebhook(creds: LineCreds, url: string) {
  let result;
  try {
    result = await lineGateway().testWebhook(creds, url);
  } catch (error) {
    throw setupError('請 LINE 測試本站網址', error);
  }
  const status = result.statusCode;
  if (result.success && status === 200) return;
  if (status <= 0) throw new DomainError('LINE 測試時未收到本站的 HTTP 回應，請確認網址可由外部連線後重試。');
  if (status === 401 || status === 403) {
    throw new DomainError(`LINE 測試時，本站拒絕了驗證請求（HTTP ${status}）。請核對部署存取保護與此官方帳號的 Channel secret。`);
  }
  throw new DomainError(`LINE 測試本站網址未通過（本站回應 HTTP ${status}）。請核對 Webhook 路徑、部署狀態後重試。`);
}

/** Verify the candidate first. LINE does not offer a compare-and-swap, so re-read the current endpoint immediately before a write. */
async function installCandidate(channel: ChannelRow): Promise<WebhookSetup> {
  const creds = credsOf(channel);
  const url = webhookUrlFor(channel);
  try {
    checkDestination(await currentWebhook(creds), url);
    await testSiteWebhook(creds, url);
    const latest = await currentWebhook(creds);
    checkDestination(latest, url);
    if (latest?.endpoint === url) {
      return webhookStatus(latest.active);
    }
  } catch (error) {
    return { state: 'waiting', message: (error instanceof DomainError ? error.message : 'LINE 候選網址測試未完成。') + ' 此次未切換 Webhook。' };
  }
  try {
    await lineGateway().setWebhook(creds, url);
  } catch {
    // LINE may have applied a request despite a timeout. Read back its state before reporting success.
  }
  try {
    const installed = await currentWebhook(creds);
    if (installed?.endpoint === url) return webhookStatus(installed.active);
    if (!installed?.endpoint) return { state: 'waiting', message: 'LINE 尚未設定本站網址。請稍後用已儲存的帳號重試。' };
  } catch { /* Status is unknown until LINE can confirm the write. */ }
  return { state: 'unknown', message: '候選網址已通過測試，目前無法確認 LINE 採用的網址。請先在 LINE Developers 核對，再重新檢查。' };
}

function webhookStatus(active: boolean): WebhookSetup {
  return active
    ? { state: 'ready', message: 'LINE 已確認本站 Webhook 網址且已開啟事件接收。請用測試住戶實機綁定、收件並領件。' }
    : { state: 'enable', message: 'LINE 已採用本站網址。請在 Messaging API 開啟 Use webhook，再按「測試並設定本站 Webhook」。' };
}

export async function initializeSavedWebhook(actor: Actor, communityId: string | null): Promise<WebhookSetup> {
  return db().transaction(async (tx) => {
    const scope = communityId ? eq(schema.lineChannels.communityId, communityId) : isNull(schema.lineChannels.communityId);
    const [channel] = await tx.select().from(schema.lineChannels).where(scope).limit(1).for('update');
    if (!channel) throw new DomainError('請先儲存 LINE 官方帳號。');
    const result = await installCandidate(channel);
    if (result.state === 'ready') {
      await tx.update(schema.lineChannels).set({ isActive: true, verifiedAt: new Date() }).where(eq(schema.lineChannels.id, channel.id));
    }
    await audit(actor, 'line.webhook', { communityId, entityType: 'line_channel', entityId: channel.id, data: { result: result.state } }, tx);
    return result;
  });
}

/** Save credentials before testing so LINE can authenticate an empty, signed verification event at the candidate URL. */
export async function configureChannel(
  actor: Actor,
  input: { communityId: string | null; name: string; channelSecret: string; accessToken: string; setupWebhook?: boolean },
) {
  const secret = input.channelSecret.trim();
  const accessToken = input.accessToken.trim();
  if (!/^[0-9a-f]{32}$/i.test(secret)) throw new DomainError('Channel secret 格式不正確（應為 32 個十六進位字元）');
  if (accessToken.length < 100) throw new DomainError('Channel access token 格式不正確，請複製「長期」的 access token');
  const creds = { secret, accessToken };
  let bot: { basicId: string; displayName: string; userId: string };
  try {
    bot = await lineGateway().getBotInfo(creds);
  } catch (error) {
    throw setupError('讀取 LINE 官方帳號資料', error);
  }

  const channel = await db().transaction(async (tx) => {
    // Serialize concurrent first registrations of the same LINE bot or tenant slot.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bot.userId}, 51))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.communityId ?? 'shared'}, 52))`);
    const scope = input.communityId ? eq(schema.lineChannels.communityId, input.communityId) : isNull(schema.lineChannels.communityId);
    const [existing] = await tx.select().from(schema.lineChannels).where(scope).limit(1).for('update');
    if (existing?.channelId && existing.channelId !== bot.userId) {
      throw new DomainError('這組金鑰屬於不同的官方帳號。更換帳號需要另外安排住戶重新綁定。');
    }
    if (existing?.isActive && credsOf(existing).secret !== secret) {
      throw new DomainError('已啟用帳號的 Channel secret 與現有憑證不同，已保留原設定。請核對 Basic ID 與金鑰。若需輪替，請與服務商安排維護時段及恢復驗證。');
    }
    const used = await tx.select({ id: schema.lineChannels.id }).from(schema.lineChannels).where(eq(schema.lineChannels.channelId, bot.userId));
    if (used.some((row) => row.id !== existing?.id)) throw new DomainError('此官方帳號已由平台或其他社區使用。請選擇專用的官方帳號。');
    const webhookKey = existing?.webhookKey ?? randomToken(18);
    checkDestination(await currentWebhook(creds), webhookUrlFor({ webhookKey }));
    const values = { name: input.name.trim() || bot.displayName, basicId: bot.basicId, displayName: bot.displayName,
      channelId: bot.userId, secretEnc: encrypt(secret), tokenEnc: encrypt(accessToken) };
    const [saved] = existing
      ? await tx.update(schema.lineChannels).set(values).where(eq(schema.lineChannels.id, existing.id)).returning()
      : await tx.insert(schema.lineChannels).values({ ...values, communityId: input.communityId, webhookKey, isActive: false }).returning();
    await audit(actor, 'line.configure', { communityId: input.communityId, entityType: 'line_channel', entityId: saved.id, data: { basicId: bot.basicId } }, tx);
    return saved;
  });

  const setup: WebhookSetup = input.setupWebhook
    ? await initializeSavedWebhook(actor, input.communityId)
    : { state: 'saved', message: '此次僅儲存憑證。請在 LINE 能連入的網站按「測試並設定本站 Webhook」。' };
  return { channel: setup.state === 'ready' ? { ...channel, isActive: true } : channel, setup };
}

export async function getSavedSharedChannel() {
  const [c] = await db().select().from(schema.lineChannels).where(isNull(schema.lineChannels.communityId)).limit(1);
  return c ?? null;
}

export async function channelQuotaSummary(channel: ChannelRow): Promise<string> {
  try {
    const quota = await lineGateway().getQuota(credsOf(channel));
    return `${quota.used} / ${quota.limit ?? '無上限'} 則`;
  } catch (error) {
    if (error instanceof DomainError) return error.message;
    return setupError('查詢訊息用量', error).message;
  }
}

/** 加好友連結與綁定碼 QR：掃描後開啟官方帳號聊天室並自動帶入綁定碼 */
export function lineAddFriendUrl(basicId: string) {
  return `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
}

export function lineBindUrl(basicId: string, bindCode: string) {
  return `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(bindCode)}`;
}

/** 讓 LINE 向已設定的網址發出驗證請求，不更改網址或向住戶推播。 */
export async function verifyInstalledWebhook(channel: ChannelRow) {
  const creds = credsOf(channel);
  const expected = webhookUrlFor(channel);
  const current = await currentWebhook(creds);
  if (!current?.endpoint) throw new DomainError('LINE 尚未設定 Webhook 網址。');
  if (current.endpoint !== expected) throw new DomainError(`LINE 目前指向另一個服務網址（${endpointHost(current.endpoint)}）。請先確認原系統用途。`);
  if (!current.active) throw new DomainError('請到 LINE Developers 的 Messaging API 設定開啟 Use webhook。');
  await testSiteWebhook(creds, expected);
}
