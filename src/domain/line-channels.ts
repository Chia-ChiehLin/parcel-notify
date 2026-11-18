import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db';
import { lineGateway, type LineCreds } from '@/channels/gateway';
import { decrypt, encrypt, randomToken } from '@/lib/crypto';
import { appUrl } from '@/lib/env';
import { audit, type Actor } from './audit';
import { DomainError } from './types';

export type ChannelRow = typeof schema.lineChannels.$inferSelect;
export type ResolvedChannel = { channel: ChannelRow; creds: LineCreds };

export function credsOf(channel: ChannelRow): LineCreds {
  return { accessToken: decrypt(channel.tokenEnc), secret: decrypt(channel.secretEnc) };
}

export function webhookUrlFor(channel: Pick<ChannelRow, 'webhookKey'>) {
  return `${appUrl()}/api/line/webhook/${channel.webhookKey}`;
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

export type ConfigureResult = {
  channel: ChannelRow;
  webhookUrl: string;
  webhookTest: { success: boolean; detail?: string } | null;
};

/**
 * 設定 LINE 官方帳號：驗證金鑰 → 加密保存 → 自動設定 Webhook 網址並測試。
 * communityId 為 null 時設定的是平台共用帳號。
 */
export async function configureChannel(
  actor: Actor,
  input: { communityId: string | null; name: string; channelSecret: string; accessToken: string },
): Promise<ConfigureResult> {
  const secret = input.channelSecret.trim();
  const accessToken = input.accessToken.trim();
  if (!/^[0-9a-f]{32}$/i.test(secret)) throw new DomainError('Channel secret 格式不正確（應為 32 個英數字）');
  if (accessToken.length < 100) throw new DomainError('Channel access token 格式不正確，請複製「長期」的 access token');
  const creds = { secret, accessToken };

  let bot: { basicId: string; displayName: string; userId: string };
  try {
    bot = await lineGateway().getBotInfo(creds);
  } catch {
    throw new DomainError('無法用這組 access token 連上 LINE，請確認複製的是正確且未過期的 Channel access token');
  }

  const existing = input.communityId ? await getOwnChannel(input.communityId) : await getSharedChannelAny();
  const values = {
    name: input.name.trim() || bot.displayName,
    basicId: bot.basicId,
    displayName: bot.displayName,
    channelId: bot.userId,
    secretEnc: encrypt(secret),
    tokenEnc: encrypt(accessToken),
    isActive: true,
    verifiedAt: new Date(),
  };
  let channel: ChannelRow;
  if (existing) {
    [channel] = await db().update(schema.lineChannels).set(values).where(eq(schema.lineChannels.id, existing.id)).returning();
  } else {
    [channel] = await db()
      .insert(schema.lineChannels)
      .values({ ...values, communityId: input.communityId, webhookKey: randomToken(18) })
      .returning();
  }

  const url = webhookUrlFor(channel);
  let webhookTest: ConfigureResult['webhookTest'] = null;
  try {
    await lineGateway().setWebhook(creds, url);
    webhookTest = await lineGateway().testWebhook(creds, url);
  } catch (e) {
    webhookTest = { success: false, detail: e instanceof Error ? e.message : String(e) };
  }
  await audit(actor, 'line.configure', {
    communityId: input.communityId,
    entityType: 'line_channel',
    entityId: channel.id,
    data: { basicId: bot.basicId, displayName: bot.displayName, webhookOk: webhookTest?.success ?? false },
  });
  return { channel, webhookUrl: url, webhookTest };
}

async function getSharedChannelAny() {
  const [c] = await db().select().from(schema.lineChannels).where(isNull(schema.lineChannels.communityId)).limit(1);
  return c ?? null;
}

export async function getChannelQuota(resolved: ResolvedChannel) {
  try {
    return await lineGateway().getQuota(resolved.creds);
  } catch {
    return null;
  }
}

/** 加好友連結與綁定碼 QR：掃描後開啟官方帳號聊天室並自動帶入綁定碼 */
export function lineAddFriendUrl(basicId: string) {
  return `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
}

export function lineBindUrl(basicId: string, bindCode: string) {
  return `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(bindCode)}`;
}
