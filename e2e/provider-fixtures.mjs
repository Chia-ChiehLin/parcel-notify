// This module is loaded only by the Playwright web server. Keep all test notifications local.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

const fetchFromNetwork = globalThis.fetch;
let webhookEndpoint = '';
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fetchFromNetwork(input, options);
  if (url.origin === 'https://api.line.me') {
    if (url.pathname === '/v2/bot/info') return Response.json({ basicId: '@e2etest', displayName: '測試共用帳號', userId: 'U-e2e-bot' });
    if (url.pathname === '/v2/bot/message/quota') return Response.json({ type: 'limited', value: 200 });
    if (url.pathname === '/v2/bot/message/quota/consumption') return Response.json({ totalUsage: 0 });
    if (url.pathname === '/v2/bot/channel/webhook/endpoint') {
      if (options?.method === 'PUT') {
        webhookEndpoint = JSON.parse(options.body).endpoint;
        return Response.json({});
      }
      return Response.json({ endpoint: webhookEndpoint, active: Boolean(webhookEndpoint) });
    }
    if (url.pathname === '/v2/bot/channel/webhook/test') {
      const endpoint = new URL(JSON.parse(options.body).endpoint);
      if (endpoint.origin !== 'http://127.0.0.1:3100' || !endpoint.pathname.startsWith('/api/line/webhook/')) {
        throw new Error('測試 Webhook 必須在本機測試站');
      }
      const body = JSON.stringify({ destination: 'U-e2e-bot', events: [] });
      const signature = createHmac('sha256', process.env.E2E_LINE_SECRET).update(body).digest('base64');
      const response = await fetchFromNetwork(endpoint, { method: 'POST', body, redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-line-signature': signature } });
      return Response.json({ success: response.status === 200, statusCode: response.status });
    }
    if (url.pathname === '/v2/bot/profile/U-e2e-resident') return Response.json({ displayName: '測試住戶' });
    if (url.pathname === '/v2/bot/message/reply') return Response.json({});
    if (url.pathname === '/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      if (body.to === 'U-e2e-resident' && body.messages?.length === 1) return Response.json({});
    }
  }
  if (url.href === 'https://api.resend.com/emails') {
    const email = JSON.parse(options.body);
    if (email.to?.[0] === 'resident@example.test' && email.subject === '確認通知用 Email 地址') {
      await mkdir('test-results', { recursive: true });
      await writeFile('test-results/resident-verification.txt', email.text, { mode: 0o600 });
      return Response.json({ id: 'test-verification' });
    }
    if (email.to?.[0] === 'manager@example.com') return Response.json({ id: 'test-invitation' });
  }
  throw new Error('端對端測試僅允許已設定的模擬外部服務請求');
};
