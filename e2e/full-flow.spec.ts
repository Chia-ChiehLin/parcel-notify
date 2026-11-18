import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { E2E_DATABASE_URL, E2E_LINE_SECRET, E2E_SECRET, E2E_SETUP_TOKEN } from '../playwright.config';

// 用和伺服器相同的 APP_SECRET 產生加密金鑰、住戶連結
process.env.APP_SECRET = E2E_SECRET;
process.env.DATABASE_URL = E2E_DATABASE_URL;

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
  await page.getByLabel('網址代號').pressSequentially('happy-garden');
  await expect(page.getByLabel('網址代號')).toHaveValue('happy-garden');
  const inviteEmail = page.getByLabel('Email（選填，之後也可以再邀請）');
  await inviteEmail.fill('manager@localhost');
  await page.getByRole('button', { name: '建立社區' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '請輸入有效的社區管理者 Email' })).toBeVisible();
  await expect(page.getByLabel('社區名稱')).toHaveValue('幸福花園社區');
  expect(await sql(`select id from app.communities where slug = 'happy-garden'`)).toHaveLength(0);
  await inviteEmail.fill('manager@example.com');
  await page.getByRole('button', { name: '建立社區' }).click();
  await expect(page.getByText('已建立社區「幸福花園社區」')).toBeVisible();
  const inviteUrl = await page.locator('input[readonly]').inputValue();
  expect(inviteUrl).toContain('/invite/');

  // 3. 產生戶別（預設 A、B 棟 1–16 樓每層 4 戶）
  await page.goto('/c/happy-garden/units');
  await expect(page.getByText('會產生 128 戶')).toBeVisible();
  await page.getByRole('button', { name: '產生戶別' }).click();
  await expect(page.getByText('已新增 128 戶')).toBeVisible();

  // 4. 儲存帳號，再讓模擬 LINE 對本機服務發送帶有正確簽章的驗證事件。
  await page.goto('/admin/line');
  await page.getByLabel(/Channel secret/).fill(E2E_LINE_SECRET);
  await page.getByLabel(/Channel access token/).fill('fake-token'.repeat(20));
  await expect(page.getByLabel(/Webhook 設定方式/)).toHaveValue('save');
  await page.getByRole('button', { name: '儲存帳號' }).click();
  await expect(page.getByText('已儲存帳號', { exact: true })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('共用 LINE 帳號已儲存，等待啟用 Webhook')).toBeVisible();
  await page.goto('/admin/line');
  await page.getByRole('button', { name: '測試並設定本站 Webhook' }).click();
  await expect.poll(async () => (await sql('select id from app.line_channels where is_active and verified_at is not null')).length).toBe(1);
  const [{ webhook_key: webhookKey }] = await sql<{ webhook_key: string }>('select webhook_key from app.line_channels where community_id is null');
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
  const signature = crypto.createHmac('sha256', E2E_LINE_SECRET).update(body).digest('base64');
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

  // 完成並通知（測試伺服器攔截 LINE 請求並模擬成功）
  await page.getByRole('button', { name: /完成並發送通知/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /已通知 1 筆/ })).toBeVisible();
  const [parcel] = await sql<{ notify_status: string }>(`select notify_status from app.parcels where pickup_code = $1`, [pickupCode]);
  expect(parcel.notify_status).toBe('sent');

  // 同戶第二件仍在櫃台。單件取件碼只應交付對應的包裹。
  await page.getByLabel('搜尋戶號').fill('A141');
  await page.getByRole('button', { name: 'A-14-1' }).click();
  await page.getByRole('button', { name: /^登記 A-14-1/ }).click();
  await expect(page.getByText('待通知', { exact: true })).toBeVisible();
  const [otherParcel] = await sql<{ pickup_code: string }>(
    `select pickup_code from app.parcels where unit_id = $1 and pickup_code <> $2`,
    [unit.id, pickupCode],
  );

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
  await expect(page.getByText(otherParcel.pickup_code, { exact: true })).toBeVisible();
  await expect(page.getByText('黑貓宅急便', { exact: true })).toBeVisible();

  await page.goto(page.url() + '/settings');
  await page.getByRole('checkbox', { name: '用 Email 通知我' }).check();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('resident@example.test');
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(page.getByText('驗證碼已寄出，15 分鐘內有效。', { exact: true })).toBeVisible();
  const mail = await readFile('test-results/resident-verification.txt', 'utf8');
  expect(mail).not.toContain('A-14-1');
  expect(mail).not.toContain('/r/');
  const verificationCode = mail.match(/驗證碼：([A-Z2-9]{8})/)?.[1];
  expect(verificationCode).toBeTruthy();
  await page.getByLabel('Email 驗證碼', { exact: false }).fill(verificationCode!);
  await page.getByRole('button', { name: '確認信箱', exact: true }).click();
  await expect(page.getByText('信箱已驗證', { exact: true })).toBeVisible();

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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '開啟選單' }).click();
  const menu = page.getByRole('dialog', { name: '導覽選單' });
  await expect(menu.getByRole('link', { name: '開通設定' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole('button', { name: '開啟選單' })).toBeFocused();
  const exports = ['/c/happy-garden/parcels/export', '/c/happy-garden/units/export?codes=1'];
  for (const path of exports) {
    const csv = await page.request.get(path);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('A-14-1');
  }
  expect(await sql("select id from app.audit_logs where action in ('unit.export','parcel.export')")).toHaveLength(2);
  await sql("update app.memberships set role = 'staff' where user_id = (select id from app.users where email = $1)", ['manager@example.com']);
  for (const path of exports) {
    const denied = await page.request.get(path, { maxRedirects: 0 });
    expect(denied.status()).toBe(307);
    expect(denied.headers().location).toContain('denied=1');
  }
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

test('未登入可從登入頁了解產品，測試環境不開放搜尋收錄', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/product$/);
  await page.getByRole('link', { name: '管理室登入' }).click();
  await page.getByRole('link', { name: '認識包裹管理服務' }).click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/包裹到管理室/);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('link', { name: '管理室登入' })).toHaveAttribute('href', '/login');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain('<loc>');
});
