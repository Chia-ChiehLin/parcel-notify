import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lineGateway, resetGateways, setGateways } from '@/channels/gateway';
import { channelQuotaSummary, verifyInstalledWebhook, webhookUrlFor, type ChannelRow } from '@/domain/line-channels';
import { encrypt } from '@/lib/crypto';
import { resetEnvCache } from '@/lib/env';

const previousGateway = lineGateway();
const fetchMock = vi.fn<typeof fetch>();
let channel: ChannelRow;

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused.invalid/test');
  vi.stubEnv('APP_SECRET', 'synthetic-diagnostic-secret-for-local-tests');
  vi.stubEnv('APP_URL', 'https://staging.example.test');
  resetEnvCache();
  resetGateways();
  vi.stubGlobal('fetch', fetchMock);
  channel = {
    id: 'test', communityId: null, name: '模擬頻道', basicId: null, channelId: null, displayName: null,
    webhookKey: 'test-callback', tokenEnc: encrypt('synthetic-token'), secretEnc: encrypt('synthetic-signing-key'),
    isActive: true, verifiedAt: null, richMenuId: null, createdAt: new Date(),
  };
});
afterEach(() => {
  setGateways({ line: previousGateway });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetEnvCache();
  fetchMock.mockReset();
});

it.each([
  [401, 'Channel access token'], [403, '權限'], [429, '頻率上限'], [503, '暫時無法完成'],
] as const)('讀取 Webhook 設定的 HTTP %s 產生具體、安全的指引', async (status, expected) => {
  fetchMock.mockResolvedValueOnce(new Response('private-response-body', { status }));
  const result = verifyInstalledWebhook(channel);
  await expect(result).rejects.toThrow('讀取 LINE Webhook 設定');
  await expect(result).rejects.toThrow(expected);
  await expect(result).rejects.not.toThrow('private-response-body');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('分辨測試 API 的逾時與本站 Webhook 拒絕存取', async () => {
  const current = { endpoint: webhookUrlFor(channel), active: true };
  fetchMock.mockResolvedValueOnce(Response.json(current))
    .mockRejectedValueOnce(new DOMException('internal details', 'TimeoutError'));
  await expect(verifyInstalledWebhook(channel)).rejects.toThrow(/請 LINE 測試本站網址.*逾時/);
  fetchMock.mockResolvedValueOnce(Response.json(current))
    .mockResolvedValueOnce(Response.json({ success: false, statusCode: 401 }));
  await expect(verifyInstalledWebhook(channel)).rejects.toThrow(/本站拒絕.*401.*部署存取保護/);
  expect(fetchMock.mock.calls.map(([, options]) => options?.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
});

it('讀取失敗、非標準 404 與不完整測試結果均能辨識', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('network details'));
  await expect(verifyInstalledWebhook(channel)).rejects.toThrow('連線到 LINE API 時中斷');
  fetchMock.mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 404 }));
  await expect(verifyInstalledWebhook(channel)).rejects.toThrow('回應格式異常');
  fetchMock.mockResolvedValueOnce(Response.json({ endpoint: webhookUrlFor(channel), active: true }))
    .mockResolvedValueOnce(Response.json({ success: true }));
  await expect(verifyInstalledWebhook(channel)).rejects.toThrow(/請 LINE 測試本站網址.*回應格式異常/);
});

it('配額能區分暫時性失敗、缺少用量資料和確實取得的用量', async () => {
  const limit = () => Response.json({ type: 'limited', value: 200 });
  fetchMock.mockResolvedValueOnce(limit()).mockResolvedValueOnce(new Response('', { status: 502 }));
  expect(await channelQuotaSummary(channel)).toMatch(/查詢訊息用量.*502.*稍後重試/);
  fetchMock.mockResolvedValueOnce(limit()).mockResolvedValueOnce(Response.json({}));
  expect(await channelQuotaSummary(channel)).toContain('回應格式異常');
  fetchMock.mockResolvedValueOnce(limit()).mockResolvedValueOnce(Response.json({ totalUsage: 1 }));
  expect(await channelQuotaSummary(channel)).toBe('1 / 200 則');
});
