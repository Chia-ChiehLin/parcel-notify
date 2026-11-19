import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailGateway, lineGateway, resetGateways, setGateways } from '@/channels/gateway';

const previous = { line: lineGateway(), email: emailGateway() };
const lookup = '/v2/bot/user/all/richmenu';
const create = '/v2/bot/richmenu';
const candidate = 'richmenu-new-test';
const upload = create + '/' + candidate + '/content';
const activate = lookup + '/' + candidate;

function lineResponses(lookups: (number | string | null)[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: URL, options: RequestInit = {}) => {
    const method = options.method ?? 'GET';
    const { pathname, hostname } = new URL(input);
    if (!['api.line.me', 'api-data.line.me'].includes(hostname)) throw new Error('Unexpected host');
    calls.push(method + ' ' + pathname);
    if (method === 'GET' && pathname === lookup) {
      const response = lookups.shift();
      if (response === undefined) throw new Error('Unexpected lookup');
      if (typeof response === 'number') return Response.json({}, { status: response });
      return Response.json(response ? { richMenuId: response } : {});
    }
    if (method === 'POST' && pathname === create) return Response.json({ richMenuId: candidate });
    if (method === 'POST' && (pathname === upload || pathname === activate)) return Response.json({});
    throw new Error('Unexpected LINE request');
  });
  return calls;
}

function install(knownId: string | null) {
  return lineGateway().createRichMenu(
    { accessToken: 'mock', secret: 'mock' },
    { size: { width: 2500, height: 843 }, name: 'fixture', selected: true, chatBarText: 'Open', areas: [] },
    Buffer.from('mock image'), 'image/png', knownId,
  );
}

describe('LINE 預設圖文選單', () => {
  beforeEach(() => resetGateways());
  afterEach(() => { vi.unstubAllGlobals(); setGateways(previous); });

  it.each([404, 'richmenu-owned'])('沒有預設或讀到本地已知選單時，上傳後再次確認再啟用 (%s)', async (current) => {
    const calls = lineResponses([current, current]);
    await expect(install(current === 404 ? null : 'richmenu-owned')).resolves.toBe(candidate);
    expect(calls).toEqual(['GET ' + lookup, 'POST ' + create, 'POST ' + upload, 'GET ' + lookup, 'POST ' + activate]);
  });

  it.each([
    ['richmenu-foreign', '其他服務'],
    [403, '其他管道'],
    [500, '無法向 LINE 確認'],
    [null, '未提供有效'],
  ] as const)('遇到既有外部選單或無法判讀時不寫入 (%s)', async (reply, message) => {
    const calls = lineResponses([reply]);
    await expect(install('richmenu-owned')).rejects.toThrow(message);
    expect(calls).toEqual(['GET ' + lookup]);
  });

  it.each(['richmenu-foreign', 503])('上傳期間預設選單變動或讀取失敗，終止切換 (%s)', async (reply) => {
    const calls = lineResponses([404, reply]);
    await expect(install(null)).rejects.toThrow();
    expect(calls).toEqual(['GET ' + lookup, 'POST ' + create, 'POST ' + upload, 'GET ' + lookup]);
  });
});
