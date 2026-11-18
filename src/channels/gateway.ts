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
  setWebhook(creds: LineCreds, url: string): Promise<void>;
  testWebhook(creds: LineCreds, url: string): Promise<{ success: boolean; detail?: string }>;
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
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    const info = await client.getBotInfo();
    return { basicId: info.basicId, displayName: info.displayName, userId: info.userId };
  },
  async setWebhook(creds, url) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    await client.setWebhookEndpoint({ endpoint: url });
  },
  async testWebhook(creds, url) {
    const { messagingApi } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    const res = await client.testWebhookEndpoint({ endpoint: url });
    return { success: res.success ?? false, detail: res.detail ?? res.reason };
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
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Email 發送失敗（${res.status}）${body.slice(0, 200)}`);
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
