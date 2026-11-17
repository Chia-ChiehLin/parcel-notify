# 部署到 Vercel + Neon（免費）

照著下面的步驟做，大約 20–30 分鐘可以完成。
做完之後，網站閒置後第一次打開大約 1–3 秒就能用，不用再等 1 分鐘，資料庫也不會過期。

| 角色 | 服務 | 費用 |
| --- | --- | --- |
| 網站與 LINE Webhook | Vercel（Hobby 方案） | 免費 |
| 資料庫 | Neon Postgres（Free 方案） | 免費 |
| 每日清理 45 天前的通知 | Vercel Cron（已寫在 `vercel.json`） | 免費 |

> 開始前請準備好：GitHub 帳號、LINE Developers 後台的登入權限。

---

## 步驟 1：建立 Neon 資料庫

1. 到 https://neon.com 註冊（可以直接用 GitHub 帳號登入）。
2. 建立新專案（Create project）：
   - **Project name**：`parcel-notify`
   - **Region**：選 **AWS Asia Pacific (Singapore)**，離台灣近，也跟 Vercel 的伺服器在同一區。
3. 建好之後按 **Connect**，確認 **Connection pooling** 是打開的，然後複製整串連線字串。
   它長得像這樣：`postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. 把這串先存著，步驟 3 會用到。**不要貼到 GitHub 或任何公開的地方。**

資料表和 A/B 棟 1–16 樓的門牌資料，會在網站第一次連上資料庫時自動建立，不用手動處理。

## 步驟 2：產生每日清理用的密碼（CRON_SECRET）

在終端機執行下面的指令，會產生一長串亂數，存起來，步驟 3 會用到：

```bash
openssl rand -hex 32
```

## 步驟 3：在 Vercel 建立專案

1. 到 https://vercel.com 用 GitHub 帳號註冊，方案選 **Hobby**。
2. 按 **Add New… → Project**，找到 `parcel-notify` 這個 repo，按 **Import**。
3. **Framework Preset** 選 **Other**，其他建置設定都不用動（`vercel.json` 已經寫好了）。
4. 展開 **Environment Variables**，一個一個加入下面 6 個：

| Key | 要填什麼 |
| --- | --- |
| `ADMIN_USER` | 警衛頁面的帳號 |
| `ADMIN_PASS` | 警衛頁面的密碼（**一定要改掉預設的 `change_me`**） |
| `DATABASE_URL` | 步驟 1 複製的 Neon 連線字串 |
| `CHANNEL_ACCESS_TOKEN` | LINE Developers → 你的 Channel → Messaging API → Channel access token |
| `CHANNEL_SECRET` | LINE Developers → 你的 Channel → Basic settings → Channel secret |
| `CRON_SECRET` | 步驟 2 產生的亂數 |

   LINE 的兩個值，也可以從本機專案資料夾裡的 `.env` 檔案複製（之前在 Render 用的就是這兩個）。

5. 按 **Deploy**，等它跑完（大約 1 分鐘）。
6. 部署完成後，Vercel 會給你一個網址，例如 `https://parcel-notify-xxxx.vercel.app`。
   在 **Settings → Domains** 可以看到正式網址，下面的步驟都用這個網址。

## 步驟 4：確認網站正常

1. 打開 `https://你的網址/health`，看到 `{"ok":true}` 就代表網站有起來。
2. 打開 `https://你的網址/`，輸入步驟 3 設定的帳號密碼，應該會看到警衛頁面和門牌清單。
   - 如果門牌清單載入失敗，到 Vercel → 專案 → **Logs** 看錯誤訊息，通常是 `DATABASE_URL` 貼錯。

## 步驟 5：把 LINE Webhook 改到新網址

1. 到 https://developers.line.biz → 你的 Provider → 你的 Channel → **Messaging API** 分頁。
2. **Webhook URL** 改成：`https://你的網址/webhook`
3. 按 **Verify**，出現 Success 就成功了。
4. 確認 **Use webhook** 是打開的。

## 步驟 6：請住戶重新綁定（如果需要）

舊的 Render 免費資料庫已經過期，裡面的住戶綁定資料很可能已經被刪除了。
請住戶在 LINE 官方帳號的聊天室裡，**再傳一次自己的門牌**（例如 `A-14-1`），收到「綁定成功」就可以了。

## 步驟 7：確認每日清理排程

到 Vercel → 專案 → **Settings → Cron Jobs**，應該會看到 `/api/cron/cleanup`，排程是 `0 16 * * *`
（UTC 16:00，也就是台灣時間每天 00:00 左右，Hobby 方案可能會在那一個小時內的任何時間執行）。

## 步驟 8：關掉舊的 Render 服務

新網站確認沒問題之後，到 Render 後台把舊的 `parcel-notify` Web Service 和資料庫刪掉，避免搞混。

---

## 之後怎麼更新網站？

程式改好之後 push 到 GitHub 的 `main` 分支，Vercel 會自動重新部署，不用手動操作。

## 本機開發

```bash
cp .env.example .env   # 第一次才需要，然後把 .env 裡的值填好
npm install
npm start              # 開在 http://localhost:3000
```

## 備註

- Vercel Hobby 方案限個人、非商業用途。如果之後是由管理公司正式營運，可能需要改用付費方案。
- Neon 免費方案的資料庫閒置 5 分鐘後會暫停，下一次有人使用時幾秒內會自動喚醒，這就是第一次打開需要 1–3 秒的原因。
