import { after } from 'next/server';
import { validateSignature, type webhook } from '@line/bot-sdk';
import { credsOf, getChannelByWebhookKey } from '@/domain/line-channels';
import { handleLineEvents } from '@/line/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * LINE Webhook。每個官方帳號有自己的網址（key 是隨機產生的），
 * 用該帳號的 Channel secret 驗證簽章後才處理。
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const channel = await getChannelByWebhookKey(key);
  if (!channel) return new Response('not found', { status: 404 });

  const signature = req.headers.get('x-line-signature');
  const body = await req.text();
  const creds = credsOf(channel);
  if (!signature || !validateSignature(body, creds.secret, signature)) {
    return new Response('signature validation failed', { status: 401 });
  }

  let events: webhook.Event[] = [];
  try {
    const request = JSON.parse(body) as webhook.CallbackRequest;
    if (!Array.isArray(request?.events)) return new Response('invalid body', { status: 400 });
    events = request.events;
  } catch {
    return new Response('invalid body', { status: 400 });
  }

  // 先回 200 給 LINE（避免逾時重送），回應後再處理事件
  if (events.length && !channel.isActive) return new Response('channel pending', { status: 409 });
  if (events.length) after(() => handleLineEvents(channel, creds, events));
  return new Response(null, { status: 200 });
}

export function GET() {
  return new Response('LINE webhook endpoint', { status: 200 });
}
