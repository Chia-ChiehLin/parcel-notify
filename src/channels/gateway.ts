/**
 * 對外服務的介面。正式環境呼叫真的 LINE / Resend；測試時換成假的，記錄送出的內容。
 */
import type { messagingApi } from '@line/bot-sdk';
import { DomainError } from '@/domain/types';
import { z } from 'zod';

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
  createRichMenu(creds: LineCreds, menu: messagingApi.RichMenuRequest, image: Buffer, contentType: string, knownDefaultId: string | null): Promise<string>;
}

export type EmailMessage = { to: string; subject: string; html: string; text: string };

export interface EmailGateway {
  isConfigured(): boolean;
  send(msg: EmailMessage): Promise<void>;
}

// ───────────────────────────── 真實實作 ─────────────────────────────

/** 僅保存可顯示的診斷文字，LINE 回應內文可能包含敏感資料。 */
export class LineSetupError extends Error {}

function transportError(error: unknown) {
  const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return new LineSetupError(timeout ? '等待 LINE API 回應逾時，請稍後重試。' : '連線到 LINE API 時中斷，請稍後重試。');
}

type SetupPath = 'info' | 'channel/webhook/endpoint' | 'channel/webhook/test' | 'message/quota' | 'message/quota/consumption';

async function lineSetupRequest(creds: LineCreds, path: SetupPath, method = 'GET', endpoint?: string) {
  let response: Response;
  try {
    response = await fetch(`https://api.line.me/v2/bot/${path}`, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
      body: endpoint === undefined ? undefined : JSON.stringify({ endpoint }),
    });
  } catch (error) {
    throw transportError(error);
  }
  const status = response.status;
  if (response.ok || (method === 'GET' && path === 'channel/webhook/endpoint' && status === 404)) return response;
  if (status === 401 || status === 403) {
    throw new LineSetupError(`LINE API 拒絕存取（HTTP ${status}），請核對這個官方帳號的 Channel access token 與權限。`);
  }
  if (status === 429) throw new LineSetupError('LINE API 已達查詢頻率上限（HTTP 429），請稍候再試。');
  if (status >= 500 || status === 408) throw new LineSetupError(`LINE API 暫時無法完成請求（HTTP ${status}），請稍後重試。`);
  throw new LineSetupError(`LINE API 回應 HTTP ${status}，請核對此帳號的 Messaging API 設定。`);
}

async function readLineJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw transportError(error);
    throw new LineSetupError('LINE API 回應格式異常，請稍後重試。');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new LineSetupError('LINE API 回應格式異常，請稍後重試。');
  return result.data;
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
    return readLineJson(response, z.object({ basicId: z.string().min(1), displayName: z.string().min(1), userId: z.string().min(1) }));
  },
  async getWebhook(creds) {
    const response = await lineSetupRequest(creds, 'channel/webhook/endpoint');
    if (response.status === 404) {
      await readLineJson(response, z.object({ message: z.string().trim().min(1) }));
      return null;
    }
    return readLineJson(response, z.object({ endpoint: z.string(), active: z.boolean() })
      .refine((value) => value.endpoint !== '' || !value.active));
  },
  async setWebhook(creds, url) {
    await lineSetupRequest(creds, 'channel/webhook/endpoint', 'PUT', url);
  },
  async testWebhook(creds, url) {
    const response = await lineSetupRequest(creds, 'channel/webhook/test', 'POST', url);
    return readLineJson(response, z.object({
      success: z.boolean(),
      statusCode: z.number().int().max(599).refine((value) => value <= 0 || value >= 100),
    }));
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
    const count = z.number().int().nonnegative();
    const [quota, usage] = await Promise.all([
      lineSetupRequest(creds, 'message/quota').then((r) => readLineJson(r, z.discriminatedUnion('type', [
        z.object({ type: z.literal('limited'), value: count }), z.object({ type: z.literal('none') }),
      ]))),
      lineSetupRequest(creds, 'message/quota/consumption').then((r) => readLineJson(r, z.object({ totalUsage: count }))),
    ]);
    return { limit: quota.type === 'limited' ? quota.value : null, used: usage.totalUsage };
  },
  async createRichMenu(creds, menu, image, contentType, knownDefaultId) {
    const { messagingApi, HTTPFetchError } = await import('@line/bot-sdk');
    const client = new messagingApi.MessagingApiClient({ channelAccessToken: creds.accessToken });
    const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken: creds.accessToken });
    const checkDefault = async () => {
      let current;
      try {
        current = await client.getDefaultRichMenuId();
      } catch (error) {
        if (error instanceof HTTPFetchError && error.status === 404) return;
        if (error instanceof HTTPFetchError && error.status === 403) {
          throw new DomainError('LINE 回報預設圖文選單由其他管道管理。請在 LINE Official Account Manager 核對目前顯示的選單；系統已保留原設定。');
        }
        throw new DomainError('無法向 LINE 確認目前的預設圖文選單，已停止設定。請確認帳號權限後再試。');
      }
      if (!current?.richMenuId || typeof current.richMenuId !== 'string') {
        throw new DomainError('LINE 未提供有效的預設圖文選單資料，已停止設定。請稍後重試。');
      }
      if (current.richMenuId !== knownDefaultId) {
        throw new DomainError('LINE 正使用其他服務的預設圖文選單，已保留原設定。請先與官方帳號管理者確認用途。');
      }
    };
    await checkDefault();
    const { richMenuId } = await client.createRichMenu(menu);
    await blob.setRichMenuImage(richMenuId, new Blob([new Uint8Array(image)], { type: contentType }));
    // The account owner may have changed the default during the image upload.
    await checkDefault();
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
