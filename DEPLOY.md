# 部署 v2 到 Vercel

這份說明的前提：Vercel 專案 `parcel-notify` 和 Neon 資料庫已經建立好，`DATABASE_URL` 已經自動設定。

## 步驟 1：新增環境變數

到 Vercel → parcel-notify → **Settings → Environment Variables**，新增下面這些。
Environments 請勾選 **Production** 和 **Preview**。

| Key | 值 | 必填 |
|---|---|---|
| `APP_SECRET` | 在終端機執行 `openssl rand -hex 32` 產生的亂數。**設定後不要再改** | ✅ |
| `SETUP_TOKEN` | 再執行一次 `openssl rand -hex 16` 產生，建立平台管理員時要輸入 | ✅（建好管理員後可刪除） |
| `CRON_SECRET` | 再執行一次 `openssl rand -hex 32` 產生，給每日排程用 | ✅ |
| `BRAND_NAME` | 產品名稱，例如「社區包裹通」 | 選填 |
| `RESEND_API_KEY`、`EMAIL_FROM` | Email 通知，到 [resend.com](https://resend.com) 申請 | 選填 |

> v1 用的 `ADMIN_USER`、`ADMIN_PASS`、`CHANNEL_ACCESS_TOKEN`、`CHANNEL_SECRET` 在 v2 已經不用了。v2 的 LINE 金鑰改成在後台設定，並且加密存在資料庫。

## 步驟 2：（選填）建立照片儲存空間

Vercel → parcel-notify → **Storage → Create → Blob**，建立後連結到這個專案，`BLOB_READ_WRITE_TOKEN` 會自動加入。
沒有設定時，照片會存在資料庫裡，只適合少量使用。

## 步驟 3：部署並建立平台管理員

1. 重新部署：推送程式碼到 GitHub，或在 Vercel 按 Redeploy。
   - 部署時會自動執行資料庫 migration（建立 `app` schema 的資料表）。
2. 打開 `https://你的網址/setup`，輸入 `SETUP_TOKEN` 的值，然後建立你的平台管理員帳號。
3. 登入後到 **共用 LINE 帳號** 頁面，貼上官方帳號的 Channel secret 和 access token。
   - 系統會自動設定好 Webhook，再按「建立圖文選單」。

## 步驟 4：開通第一個社區

1. 平台總後台 → **開通新社區**，填寫社區資料並邀請社區管理者。
2. 進入社區後台，照「開通設定」頁面的步驟完成：
   1. 管理室資訊
   2. 產生戶別
   3. 邀請警衛
   4. 列印綁定卡
   5. 登記第一件包裹

## 正式上線前的檢查清單

- [ ] **升級 Vercel Pro。** Hobby 方案禁止商業使用。
- [ ] 確認 LINE 官方帳號的訊息方案夠用。免費方案每月只有 200 則推播。
- [ ] 修改 `/privacy` 和 `/terms` 頁面的公司資料，建議請律師審閱。
- [ ] 設定 Email（Resend），忘記密碼和邀請信才寄得出去。
- [ ] 刪除 `SETUP_TOKEN`。

## 從 v1 切換到 v2

v1 在 `main` 分支，v2 在 `v2` 分支。兩版共用同一個資料庫，但資料表不衝突：v1 用 `public` schema，v2 用 `app` schema。

v2 在 Preview 網址驗收通過後，把 `v2` 合併到 `main`，正式網址就會換成 v2。
v1 的資料表可以在確認不再需要後刪除。
