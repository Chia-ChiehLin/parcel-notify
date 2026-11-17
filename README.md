🏢Parcel Notify – Apartment Parcel Notification System

🔗Link to the website: （部署到 Vercel 後填入網址）
部署步驟請看 [DEPLOY.md](DEPLOY.md)。

📖Introduction
Parcel Notify 是一個專為大樓住戶設計的包裹通知系統。
當住戶的包裹送達管理室時，管理員可以透過後台 Web 介面發送通知，系統會自動將訊息推播到對應住戶的 LINE 帳號。
此系統大幅減少了人工逐一聯絡的麻煩，提升管理效率。

Features
🔑 Basic Auth 後台登入：保護管理員介面。
📦 包裹通知推播：自動將通知傳送到住戶的 LINE。
🏠 住戶門牌綁定：住戶可輸入自己的門牌完成綁定。
📜 通知紀錄：保存歷史通知，支援查詢與錯誤紀錄。
🗑 自動清理：45 天前的通知會每日自動清除，避免資料庫膨脹。

🛠Tech Stack
Backend: Node.js (Express)
Database: PostgreSQL (Neon 免費雲端資料庫)
Frontend: HTML + JavaScript (管理員介面)
Messaging API: LINE Bot SDK
Deployment: Vercel (Serverless Function)
Scheduler: Vercel Cron (每日清理通知紀錄)

🚀 Deployment
完整步驟請看 [DEPLOY.md](DEPLOY.md)。
Web Service (Vercel)
使用 Node.js + Express 架設 API 與管理員後台，部署成 Vercel Serverless Function。
閒置後第一次打開約 1–3 秒即可使用。
Database (Neon Postgres)
使用 PostgreSQL 儲存 住戶資料、綁定紀錄、通知歷史。
種子資料自動建立 A/B 棟，1–16 樓，每層 4 戶。
LINE Messaging API
與 LINE Bot 連動，住戶可直接在聊天中完成門牌綁定。
使用 CHANNEL_ACCESS_TOKEN 與 CHANNEL_SECRET 驗證。
Scheduled Cleanup (Vercel Cron)
每天約 00:00（台灣時間）自動呼叫 /api/cron/cleanup。
清除 45 天前的通知紀錄。

🔐 Environment Variables
以下環境變數需在 Vercel → Settings → Environment Variables 中設定：
| Key                    | 說明
| ---------------------- | ------------------------
| `ADMIN_USER`           | 管理員帳號
| `ADMIN_PASS`           | 管理員密碼
| `DATABASE_URL`         | Neon 提供的 Postgres 連線字串（Pooled connection）
| `CHANNEL_ACCESS_TOKEN` | LINE Bot access token
| `CHANNEL_SECRET`       | LINE Bot secret
| `CRON_SECRET`          | 每日清理排程用的密碼（任意亂數）

📂 Project Structure
parcel-notify/
│── api/
│   ├── index.js         # Vercel 入口，把所有請求交給 Express
│── public/              # 前端檔案 (index.html, admin.js)
│── src/
│   ├── app.js           # Express 主程式（路由、LINE Webhook）
│   ├── server.js        # 本機開發用（npm start）
│   ├── db.js            # Postgres 資料庫邏輯
│   ├── utils.js         # 共用工具
│── seed.sql             # 初始資料 (可選)
│── vercel.json          # Vercel 設定（路由、區域、每日排程）
│── DEPLOY.md            # 部署步驟
│── package.json
│── README.md

📸 Screenshots


🙌 Future Improvements
- 新增住戶綁定狀態查詢介面
- 後台通知紀錄可搜尋 / 匯出
- 支援多語系通知









