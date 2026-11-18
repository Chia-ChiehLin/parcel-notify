import { describe, expect, it } from 'vitest';
import type { webhook } from '@line/bot-sdk';
import { db, schema } from '@/db';
import { configureChannel, credsOf, getSavedSharedChannel, getSharedChannel, initializeSavedWebhook, webhookUrlFor } from '@/domain/line-channels';
import { registerParcels } from '@/domain/parcels';
import { handleLineEvents } from '@/line/webhook';
import { ADMIN, fakes, makeCommunity, TEST_SECRET, TEST_TOKEN } from './helpers';

function textEvent(userId: string, text: string, replyToken = `rt-${Math.random()}`): webhook.Event {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    webhookEventId: 'e',
    deliveryContext: { isRedelivery: false },
    source: { type: 'user', userId },
    replyToken,
    message: { type: 'text', id: '1', text, quoteToken: 'q' },
  } as webhook.Event;
}

describe('LINE webhook 處理', () => {
  it('加好友 → 歡迎訊息；輸入綁定碼 → 綁定成功；查詢我的包裹 → 回覆卡片（不推播）', async () => {
    const { channel, unit, scope } = await makeCommunity();
    const creds = credsOf(channel!);
    const u = unit('B-3-1');

    await handleLineEvents(channel!, creds, [
      { type: 'follow', mode: 'active', timestamp: 0, webhookEventId: 'f', deliveryContext: { isRedelivery: false }, source: { type: 'user', userId: 'U-new' }, replyToken: 'rt-follow', follow: { isUnblocked: false } } as webhook.Event,
    ]);
    expect(JSON.stringify(fakes.replies()[0].messages)).toContain('8 碼綁定碼');

    await handleLineEvents(channel!, creds, [textEvent('U-new', u.bindCode.toLowerCase())]);
    expect(JSON.stringify(fakes.replies()[1].messages)).toContain('綁定成功');
    const residents = await db().select().from(schema.residents);
    expect(residents).toHaveLength(1);
    expect(residents[0].displayName).toBe('User -new');

    await registerParcels(scope, [{ unitId: u.id, carrier: '黑貓宅急便' }], { notify: false });
    await handleLineEvents(channel!, creds, [textEvent('U-new', '我的包裹')]);
    const reply = fakes.replies()[2];
    expect(reply.messages[0].type).toBe('flex');
    expect(JSON.stringify(reply.messages)).toContain('黑貓宅急便');
    expect(fakes.pushes()).toHaveLength(0);
  });

  it('未綁定的使用者傳其他訊息會收到綁定說明；群組訊息不處理', async () => {
    const { channel } = await makeCommunity();
    await handleLineEvents(channel!, credsOf(channel!), [textEvent('U-stranger', '你好')]);
    expect(JSON.stringify(fakes.replies()[0].messages)).toContain('還沒有綁定');

    await handleLineEvents(channel!, credsOf(channel!), [{ ...textEvent('U-g', '我的包裹'), source: { type: 'group', groupId: 'G1', userId: 'U-g' } } as webhook.Event]);
    expect(fakes.replies()).toHaveLength(1);
  });

  it('封鎖官方帳號後不再推播', async () => {
    const { channel, unit, scope } = await makeCommunity();
    const u = unit('A-1-2');
    await handleLineEvents(channel!, credsOf(channel!), [textEvent('U-block', u.bindCode)]);
    await handleLineEvents(channel!, credsOf(channel!), [
      { type: 'unfollow', mode: 'active', timestamp: 0, webhookEventId: 'u', deliveryContext: { isRedelivery: false }, source: { type: 'user', userId: 'U-block' } } as webhook.Event,
    ]);
    const res = await registerParcels(scope, [{ unitId: u.id }], { notify: true });
    expect(fakes.pushes()).toHaveLength(0);
    expect(res.notifications[0].status).toBe('no_recipient');
  });
});

it('檢查既有官方帳號時保留其他系統正在使用的 Webhook', async () => {
  const { configureChannel, verifyInstalledWebhook } = await import('@/domain/line-channels');
  const { TEST_TOKEN, TEST_SECRET, ADMIN } = await import('./helpers');
  const { channel } = await makeCommunity();
  await verifyInstalledWebhook(channel!);
  const other = 'https://prior.example.test/old-webhook';
  fakes.endpoints.set(TEST_TOKEN, other);
  await expect(verifyInstalledWebhook(channel!)).rejects.toThrow('另一個服務');
  await expect(configureChannel(ADMIN, { communityId: null, name: '共用帳號', accessToken: TEST_TOKEN, channelSecret: TEST_SECRET })).rejects.toThrow('其他網址');
  expect(fakes.endpoints.get(TEST_TOKEN)).toBe(other);
});

describe('儲存 LINE 帳號及啟用本站 Webhook', () => {
  const input = { communityId: null, name: '模擬品牌', accessToken: TEST_TOKEN, channelSecret: TEST_SECRET };

  it('受保護預覽可僅儲存；公開站用原憑證驗證候選網址，啟用後才能提供服務', async () => {
    const saved = await configureChannel(ADMIN, input);
    const url = webhookUrlFor(saved.channel);
    expect(saved.setup.state).toBe('saved');
    expect(fakes.webhookCalls).toEqual([{ op: 'get' }]);
    expect(await getSharedChannel()).toBeNull();
    expect((await getSavedSharedChannel())?.secretEnc).not.toBe(TEST_SECRET);
    fakes.webhookCalls = [];
    fakes.webhookActive = false;
    expect((await initializeSavedWebhook(ADMIN, null)).state).toBe('enable');
    expect(fakes.webhookCalls).toEqual([{ op: 'get' }, { op: 'test', url }, { op: 'get' }, { op: 'set', url }, { op: 'get' }]);
    expect(await getSharedChannel()).toBeNull();
    fakes.webhookCalls = [];
    fakes.webhookActive = true;
    expect((await initializeSavedWebhook(ADMIN, null)).state).toBe('ready');
    expect(fakes.webhookCalls.map((c) => c.op)).toEqual(['get', 'test', 'get']);
    expect((await getSharedChannel())?.id).toBe(saved.channel.id);
    expect(fakes.pushes()).toHaveLength(0);
  });

  it.each([{ success: false, statusCode: 401 }, { success: true, statusCode: 302 }, { success: false, statusCode: 0 }])('候選網址測試回覆 %j 時保留已儲存帳號，無寫入', async (response) => {
    fakes.webhookResult = response;
    const result = await configureChannel(ADMIN, { ...input, setupWebhook: true });
    expect(result.setup.state).toBe('waiting');
    expect(fakes.webhookCalls.map((c) => c.op)).toEqual(['get', 'get', 'test']);
    expect(await getSavedSharedChannel()).toBeTruthy();
    expect(await getSharedChannel()).toBeNull();
    expect(fakes.endpoints.size).toBe(0);
  });

  it('驗證期間若管理者填了另一個服務的網址，保留對方設定', async () => {
    const other = 'https://prior.example.test/hook';
    fakes.afterCandidateTest = (token) => fakes.endpoints.set(token, other);
    const result = await configureChannel(ADMIN, { ...input, setupWebhook: true });
    expect(result.setup.state).toBe('waiting');
    expect(fakes.endpoints.get(TEST_TOKEN)).toBe(other);
    expect(fakes.webhookCalls.filter((c) => c.op === 'set')).toHaveLength(0);
  });

  it('同一帳號並行儲存只建立一個 callback，其他社區無法佔用已儲存的 bot', async () => {
    const { community } = await makeCommunity({ withChannel: false });
    const [a,b] = await Promise.all([configureChannel(ADMIN, input), configureChannel(ADMIN, input)]);
    expect(a.channel.id).toBe(b.channel.id);
    expect(a.channel.webhookKey).toBe(b.channel.webhookKey);
    await expect(configureChannel(ADMIN, { ...input, communityId: community.id })).rejects.toThrow('其他社區');
    await expect(configureChannel(ADMIN, { ...input, accessToken: TEST_TOKEN + 'different' })).rejects.toThrow('不同的官方帳號');
    const rows = await db().select().from(schema.lineChannels);
    expect(rows).toHaveLength(1);
    expect(fakes.webhookCalls.some((c) => c.op === 'set')).toBe(false);
  });
  it('啟用中帳號填錯 secret 時，保留舊的簽章憑證、token 與 LINE 網址', async () => {
    await configureChannel(ADMIN, { ...input, setupWebhook: true });
    const previous = await getSharedChannel();
    fakes.webhookCalls = [];
    for (const setupWebhook of [false, true]) {
      await expect(configureChannel(ADMIN, { ...input, channelSecret: 'f'.repeat(32), setupWebhook })).rejects.toThrow('已保留原設定');
    }
    const current = await getSharedChannel();
    expect(current).toEqual(previous);
    expect(fakes.webhookCalls).toHaveLength(0);
    expect(fakes.endpoints.get(TEST_TOKEN)).toBe(webhookUrlFor(previous!));
  });

});
