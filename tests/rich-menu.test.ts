import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailGateway, lineGateway, resetGateways, setGateways } from '@/channels/gateway';
import { configureChannel } from '@/domain/line-channels';
import { installRichMenu } from '@/line/rich-menu';
import { ADMIN, TEST_SECRET, TEST_TOKEN } from './helpers';

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

  it('不連外下載字型或圖示，即可從正式入口上傳符合 LINE 規格的隨版 PNG', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('測試停用對外連線'));
    vi.stubGlobal('fetch', fetch);
    setGateways(previous);
    const { channel } = await configureChannel(ADMIN, {
      communityId: null, name: '共用帳號', channelSecret: TEST_SECRET, accessToken: TEST_TOKEN, setupWebhook: true,
    });
    const upload = vi.fn(previous.line.createRichMenu.bind(previous.line));
    setGateways({ line: { ...previous.line, createRichMenu: upload }, email: previous.email });
    await installRichMenu(ADMIN, channel);
    expect(upload).toHaveBeenCalledTimes(1);
    const [, menu, image, contentType] = upload.mock.calls[0];
    expect(contentType).toBe('image/png');
    expect(image.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([2500, 843]);
    expect(image.length).toBeLessThan(1_000_000);
    expect(menu.areas?.map((area) => area.bounds)).toEqual([0, 625, 1250, 1875].map((x) => ({ x, y: 0, width: 625, height: 843 })));
    expect(fetch).not.toHaveBeenCalled();
  });
});
