// This module is loaded only by the Playwright web server. Keep all test notifications local.
import { mkdir, writeFile } from 'node:fs/promises';

const fetchFromNetwork = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fetchFromNetwork(input, options);
  if (url.origin === 'https://api.line.me') {
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
