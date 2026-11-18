/**
 * 對外服務的介面。正式環境呼叫真的 LINE / Resend；測試時換成假的，記錄送出的內容。
 */
import type { messagingApi } from '@line/bot-sdk';

export type LineCreds = { accessToken: string; secret: string };
export type LineMessage = messagingApi.Message;

export interface LineGateway {
  push(creds: LineCreds, to: string, messages: LineMessage[]): Promise<void>;
  reply(creds: LineCreds, replyToken: string, messages: LineMessage[]): Promise<void>;
  getBotInfo(creds: LineCreds): Promise<{ basicId: string; displayName: string; userId: string }>;
  getWebhook(creds: LineCreds): Promise<{ endpoint: string; active: boolean } | null>;
  setWebhook(creds: LineCreds, url: string): Promise<void>;
  testWebhook(creds: LineCreds, url: string): Promise<{ success: boolean; statusCode: number }>;
  getProfile(creds: LineCreds, userId: string): Promise<{ displayName: string } | null>;
  getQuota(creds: LineCreds): Promise<{ limit: number | null; used: number }>;
  createRichMenu(creds: LineCreds, menu: messagingApi.RichMenuRequest, image: Buffer, contentType: string): Promise<string>;
}

export type EmailMessage = { to: string; subject: string; html: string; text: string };

export interface EmailGateway {
  isConfigured(): boolean;
  send(msg: EmailMessage): Promise<void>;
}

// ───────────────────────────── 真實實作 ─────────────────────────────

// The SDK setup methods do not expose AbortSignal. Bound every account setup request, including response-body reads.
function lineSetupRequest(creds: LineCreds, path: 'info' | 'channel/webhook/endpoint' | 'channel/webhook/test', method = 'GET', endpoint?: string) {
  return fetch(`https://api.line.me/v2/bot/${path}`, {
    method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8_000),
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    body: endpoint === undefined ? undefined : JSON.stringify({ endpoint }),
  });
}

const realLine: LineGateway = {
  async push(creds, to, messages) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    await client.pushMessage({ to, messages });
  },
  async reply(creds, replyToken, messages) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    await client.replyMessage({ replyToken, messages });
  },
  async getBotInfo(creds) {
    const response = await lineSetupRequest(creds, 'info');
    if (!response.ok) throw new Error('LINE account info unavailable');
    const { basicId, displayName, userId } = await response.json() as messagingApi.BotInfoResponse;
    if (!basicId || !displayName || !userId) throw new Error('Invalid LINE account info');
    return { basicId, displayName, userId };
  },
  async getWebhook(creds) {
    const response = await lineSetupRequest(creds, 'channel/webhook/endpoint');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('LINE webhook unavailable');
    const result = await response.json() as messagingApi.GetWebhookEndpointResponse;
    if (typeof result.endpoint !== 'string' || typeof result.active !== 'boolean') throw new Error('Invalid LINE webhook response');
    return result;
  },
  async setWebhook(creds, url) {
    const response = await lineSetupRequest(creds, 'channel/webhook/endpoint', 'PUT', url);
    if (!response.ok) throw new Error('LINE webhook update not confirmed');
  },
  async testWebhook(creds, url) {
    const response = await lineSetupRequest(creds, 'channel/webhook/test', 'POST', url);
    if (!response.ok) throw new Error('LINE webhook test unavailable');
    const result = await response.json() as messagingApi.TestWebhookEndpointResponse;
    return { success: result.success === true, statusCode: result.statusCode };
  },
  async getProfile(creds, userId) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    try {
      const p = await client.getProfile(userId);
      return { displayName: p.displayName };
    } catch {
      return null;
    }
  },
  async getQuota(creds) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    const [quota, used] = await Promise.all([client.getMessageQuota(), client.getMessageQuotaConsumption()]);
    return { limit: quota.type === 'limited' ? quota.value ?? null : null, used: used.totalUsage ?? 0 };
  },
  async createRichMenu(creds, menu, image, contentType) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken: creds.accessToken });
    const { richMenuId } = await client.createRichMenu(menu);
    await blob.setRichMenuImage(richMenuId, new Blob([new Uint8Array(image)], { type: contentType }));
    await client.setDefaultRichMenu(richMenuId);
    return richMenuId;
  },
};

const realEmail: EmailGateway = {
  isConfigured() {
    return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
  },
  async send(msg) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Email 發送失敗（${res.status}）`);
    }
  },
};

let line: LineGateway = realLine;
let email: EmailGateway = realEmail;

export function lineGateway() {
  return line;
}
export function emailGateway() {
  return email;
}

/** 測試用 */
export function setGateways(g: { line?: LineGateway; email?: EmailGateway }) {
  if (g.line) line = g.line;
  if (g.email) email = g.email;
}
export function resetGateways() {
  line = realLine;
  email = realEmail;
}
