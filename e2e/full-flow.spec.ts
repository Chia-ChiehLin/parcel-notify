import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { E2E_DATABASE_URL, E2E_SECRET, E2E_SETUP_TOKEN } from '../playwright.config';

// 用和伺服器相同的 APP_SECRET 產生加密金鑰、住戶連結
process.env.APP_SECRET = E2E_SECRET;
process.env.DATABASE_URL = E2E_DATABASE_URL;

const LINE_SECRET = '0123456789abcdef0123456789abcdef';

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

test.describe.configure({ mode: 'serial' });

test('平台開通社區 → 產生戶別 → LINE 綁定 → 收件 → 交付 → 住戶頁面', async ({ page, request }) => {
  // 1. 建立平台管理員
  await page.goto('/setup');
  await page.getByLabel('設定碼').fill(E2E_SETUP_TOKEN);
  await page.getByLabel('你的姓名').fill('服務商');
  await page.locator('input[name=email]').fill('owner@example.com');
  await page.locator('input[name=password]').fill('Owner12345');
  await page.getByLabel('再輸入一次').fill('Owner12345');
  await page.getByRole('button', { name: '建立' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: '平台總覽' })).toBeVisible();

  // 已建立後 /setup 不再存在
  expect((await request.get('/setup')).status()).toBe(404);

  // 2. 開通社區
  await page.goto('/admin/communities/new');
  await page.getByLabel('社區名稱').fill('幸福花園社區');
  await page.getByLabel('網址代號').fill('happy-garden');
  await page.getByLabel('Email（選填，之後也可以再邀請）').fill('manager@example.com');
  await page.getByRole('button', { name: '建立社區' }).click();
  await expect(page.getByText('已建立社區「幸福花園社區」')).toBeVisible();
  const inviteUrl = await page.locator('input[readonly]').inputValue();
  expect(inviteUrl).toContain('/invite/');

  // 3. 產生戶別（預設 A、B 棟 1–16 樓每層 4 戶）
  await page.goto('/c/happy-garden/units');
  await expect(page.getByText('會產生 128 戶')).toBeVisible();
  await page.getByRole('button', { name: '產生戶別' }).click();
  await expect(page.getByText('已新增 128 戶')).toBeVisible();

  // 4. 設定共用 LINE 帳號（直接寫入資料庫，因為測試環境不能連 LINE）
  const { encrypt } = await import('../src/lib/crypto');
  const webhookKey = crypto.randomBytes(12).toString('hex');
  await sql(
    `insert into app.line_channels (community_id, name, basic_id, display_name, secret_enc, token_enc, webhook_key, verified_at)
     values (null, '測試共用帳號', '@e2etest', '測試共用帳號', $1, $2, $3, now())`,
    [encrypt(LINE_SECRET), encrypt('fake-token'.repeat(20)), webhookKey],
  );
  const [unit] = await sql<{ id: string; bind_code: string }>(`select id, bind_code from app.units where label = 'A-14-1'`);

  // 4a. 簽章錯誤 → 401
  const bad = await request.post(`/api/line/webhook/${webhookKey}`, { data: '{"events":[]}', headers: { 'content-type': 'application/json', 'x-line-signature': 'bad' } });
  expect(bad.status()).toBe(401);

  // 4b. 住戶傳綁定碼 → 綁定
  const body = JSON.stringify({
    destination: 'x',
    events: [
      {
        type: 'message',
        mode: 'active',
        timestamp: Date.now(),
        webhookEventId: 'e1',
        deliveryContext: { isRedelivery: false },
        source: { type: 'user', userId: 'U-e2e-resident' },
        replyToken: 'reply-token',
        message: { type: 'text', id: '1', text: unit.bind_code, quoteToken: 'q' },
      },
    ],
  });
  const signature = crypto.createHmac('sha256', LINE_SECRET).update(body).digest('base64');
  const ok = await request.post(`/api/line/webhook/${webhookKey}`, { data: body, headers: { 'content-type': 'application/json', 'x-line-signature': signature } });
  expect(ok.status()).toBe(200);
  await expect.poll(async () => (await sql(`select id from app.residents where line_user_id = 'U-e2e-resident'`)).length, { timeout: 10_000 }).toBe(1);

  // 5. 收件登記
  await page.goto('/c/happy-garden/receive');
  await page.getByPlaceholder('輸入戶號，例如 A141 或 14-1').fill('A141');
  await page.getByRole('button', { name: 'A-14-1' }).click();
  await page.getByRole('button', { name: '黑貓宅急便' }).click();
  await page.getByRole('button', { name: '冷凍', exact: true }).click();
  await page.getByRole('button', { name: '冷凍櫃' }).click();
  await page.getByRole('button', { name: /^登記 A-14-1/ }).click();
  await expect(page.getByText(/A-14-1 已登記，取件碼 \d{6}/)).toBeVisible();
  const flash = await page.getByText(/取件碼 \d{6}/).first().textContent();
  const pickupCode = flash!.match(/\d{6}/)![0];

  // 完成並通知（測試環境的假 token 會讓 LINE 推播失敗，但流程要完成並記錄）
  await page.getByRole('button', { name: /完成並發送通知/ }).click();
  await expect(page.getByText(/已通知 1 戶/)).toBeVisible();
  const [parcel] = await sql<{ notify_status: string }>(`select notify_status from app.parcels where pickup_code = $1`, [pickupCode]);
  expect(['sent', 'failed']).toContain(parcel.notify_status);

  // 6. 交付：輸入取件碼
  await page.goto('/c/happy-garden/pickup');
  await page.getByPlaceholder('掃描住戶 QR，或輸入取件碼／代領碼／門牌').fill(pickupCode);
  await page.getByRole('button', { name: '查詢' }).click();
  await expect(page.getByText('A-14-1').first()).toBeVisible();
  await expect(page.getByText('冷凍櫃')).toBeVisible();
  await page.getByRole('button', { name: '確認交付 1 件' }).click();
  await expect(page.getByText('A-14-1：已交付 1 件')).toBeVisible();

  // 7. 包裹紀錄
  await page.goto('/c/happy-garden/parcels?status=picked_up');
  await expect(page.getByRole('link', { name: 'A-14-1' })).toBeVisible();

  // 8. 住戶頁面（從 LINE 連結開啟）
  const { residentToken } = await import('../src/domain/tokens');
  const [resident] = await sql<{ id: string; token_version: number }>(`select id, token_version from app.residents where line_user_id = 'U-e2e-resident'`);
  await page.goto(`/r/${residentToken({ id: resident.id, tokenVersion: resident.token_version })}`);
  await expect(page.getByRole('heading', { name: 'A-14-1' })).toBeVisible();
  await expect(page.getByText('目前沒有待領取的包裹')).toBeVisible();
  await expect(page.getByText('黑貓宅急便')).toBeVisible();

  // 竄改的連結無效
  await page.goto('/r/abc.def');
  await expect(page.getByText('這個連結已失效')).toBeVisible();

  // 9. 接受社區管理者邀請
  await page.context().clearCookies();
  await page.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByLabel('你的姓名').fill('王總幹事');
  await page.locator('input[name=password]').fill('Manager123');
  await page.getByRole('button', { name: '建立帳號並加入' }).click();
  await expect(page).toHaveURL(/\/c\/happy-garden$/);
  await expect(page.getByRole('heading', { name: '總覽' })).toBeVisible();
});

test('未登入不能進後台；cron 需要密碼', async ({ page, request }) => {
  await page.goto('/c/happy-garden');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
  expect((await request.get('/api/cron/daily')).status()).toBe(401);
  const cron = await request.get('/api/cron/daily', { headers: { authorization: 'Bearer e2e-cron' } });
  expect(cron.status()).toBe(200);
  expect((await cron.json()).ok).toBe(true);
});
