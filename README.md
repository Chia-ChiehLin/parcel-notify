# 社區包裹通（Parcel Notify v2）

多社區雲端包裹管理系統：管理室用平板登記包裹，住戶在 LINE 收到通知，到管理室出示 QR code 領取。
專為台灣社區大樓與物業公司設計，可以用 SaaS 方式銷售給多個客戶。

部署步驟請看 [DEPLOY.md](DEPLOY.md)。

## 功能

| 角色 | 功能 |
|---|---|
| **平台管理員（服務商）** | 開通社區、方案與上限、試用／到期／寬限期自動停用、手動收款紀錄、用量統計、共用 LINE 帳號、使用者管理、全平台稽核 |
| **物業公司管理者** | 旗下所有社區的總覽與管理 |
| **社區管理者** | 戶別產生器與 CSV 匯入匯出、綁定卡列印、住戶管理、人員帳號、通知與保留期限設定、自有 LINE 帳號、稽核紀錄 |
| **警衛／櫃台** | 平板收件登記（批次、掃條碼、拍照）、交付取件（掃 QR／取件碼／代領碼）、簽名、包裹紀錄、通知單列印 |
| **住戶** | LINE 綁定、到件通知卡片、取件 QR、待領與歷史、代領碼、通知偏好與語言、解除綁定 |

**通知管道**：LINE（主要）、Email（備援）、列印取件通知單。簡訊與大廳看板列在第 2 階段。

**LINE 訊息費控制**：同一戶多件包裹合併成一則；住戶主動查詢用免費的回覆訊息；「同戶所有成員」與「領取通知」預設關閉；每月用量統計。

**安全**：
- 每戶 8 碼綁定碼，連續輸錯會鎖住，綁定碼也必須對應正確的官方帳號
- 密碼用 argon2id 雜湊，session 存在資料庫
- 所有資料依社區隔離（tenant isolation）
- 自有 LINE 金鑰用 AES-256-GCM 加密
- 住戶連結有簽章，可以撤銷
- 取件 QR 10 分鐘就會過期
- 包裹照片存成私有檔案
- 完整稽核紀錄、資料保留期限自動清除

## 技術架構

- Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4
- PostgreSQL（Neon）+ Drizzle ORM，所有資料表在獨立的 `app` schema
- LINE Messaging API（`@line/bot-sdk`），每個官方帳號各自的 Webhook 網址與簽章驗證
- Vercel（Serverless + Cron + Blob）
- Vitest（整合測試，使用真實 Postgres）+ Playwright（E2E）

```
app/                 # 頁面與 API
  admin/             # 平台總後台
  c/[slug]/          # 社區後台（收件、交付、戶別、住戶、設定…）
  r/[token]/         # 住戶網頁（從 LINE／Email 連結開啟）
  org/               # 物業公司總覽
  api/line/webhook/  # LINE Webhook
  api/cron/daily/    # 每日排程：到期停用、逾期提醒、資料清除
src/
  domain/            # 商業邏輯（社區、戶別、住戶、包裹、交付、通知、維護）
  auth/              # 登入、session、權限
  channels/          # LINE／Email 介面與訊息範本
  db/                # 資料表定義與 migration
  actions/           # Server actions
tests/               # Vitest 整合測試
e2e/                 # Playwright 端對端測試
```

## 本機開發

需要 Node.js 24 與 PostgreSQL。

```bash
cp .env.example .env.local   # 填入 DATABASE_URL、APP_SECRET、SETUP_TOKEN
npm install
npm run db:migrate
npm run dev                  # http://localhost:3000，先到 /setup 建立平台管理員
```

測試：

```bash
npm test        # 整合測試（預設連 postgres://postgres@localhost:55432/parcel_test）
npm run e2e     # 端對端測試（需先 npm run build）
```

修改資料表後產生 migration：`npm run db:generate`。

## 版本

- **v2**（這個分支）：多社區 SaaS 版
- **v1**（`main` 分支）：單一大樓的 Express 版，v2 驗收後會被取代
