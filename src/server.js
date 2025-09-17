// src/server.js
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import { createDb } from './db.js';
import { isValidApartmentNo, normalizeApartmentNo, nowIso } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────────────────────────────────────────────
// ENV
const {
  PORT = 3000,
  ADMIN_USER = 'guard',
  ADMIN_PASS = 'change_me',
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('ERROR: Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET in .env');
  process.exit(1);
}

// ───────────────────────────────────────────────────────────
// Init
const app = express();
app.use(helmet());
app.use(morgan('dev'));

// DB (使用 Postgres)
const db = await createDb(process.env.DATABASE_URL);

// LINE SDK
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const lineClient = new Client(lineConfig);

// ───────────────────────────────────────────────────────────
// Basic Auth for guard/admin pages & APIs
function basicAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.split(' ')[1] || '';
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64').toString();
  } catch (_) {}
  const [user, pass] = decoded.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Guard Area"');
  return res.status(401).send('Unauthorized');
}

// Health check (no auth)
app.get('/health', (req, res) => res.json({ ok: true }));

// Gatekeeper: allow /health and /webhook without auth; everything else requires Basic Auth
app.use((req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/webhook')) return next();
  return basicAuth(req, res, next);
});

// Static admin page (protected by Basic Auth above)
app.use(express.static(path.join(__dirname, '..', 'public')));

// JSON body only for /api (avoid interfering LINE signature verification)
app.use('/api', express.json());

// ───────────────────────────────────────────────────────────
// APIs (protected)
app.get('/api/apartments', async (req, res) => {
  const rows = await db.listApartments();
  res.json(rows);
});

app.post('/api/notify', async (req, res) => {
  const { apartment, count, note } = req.body || {};
  if (!apartment) return res.status(400).json({ error: 'MISSING_APARTMENT' });

  const apt = normalizeApartmentNo(apartment);
  if (!(await db.apartmentExists(apt))) {
    return res.status(400).json({ error: 'APARTMENT_NOT_FOUND' });
  }

  const userIds = await db.getUserIdsByApartment(apt);
  if (!userIds.length) {
    await db.addNotification(apt, count ?? null, note ?? null, 'no_binding', null);
    return res.status(400).json({ error: 'NOT_BOUND', message: '該戶尚未綁定 LINE 帳號' });
  }

  // 組訊息
  const n = Number.isFinite(Number(count)) ? Number(count) : null;
  let text = '📦 您有新的包裹在管理室';
  if (n && n > 0) text = `📦 您有 ${n} 件包裹在管理室`;
  text += note && String(note).trim() ? `。備註：${String(note).trim()}` : '，請盡速領取。';

  // 推播
  const results = [];
  for (const uid of userIds) {
    try {
      await lineClient.pushMessage(uid, { type: 'text', text });
      results.push({ userId: uid, ok: true, at: nowIso() });
    } catch (err) {
      results.push({
        userId: uid,
        ok: false,
        at: nowIso(),
        error: err?.response?.data || err.message,
      });
    }
  }

  // 紀錄
  const anyFail = results.some((r) => !r.ok);
  await db.addNotification(
    apt,
    n,
    note || null,
    anyFail ? 'partial_fail' : 'ok',
    anyFail ? JSON.stringify(results) : null
  );

  if (anyFail) return res.status(207).json({ status: 'PARTIAL', results });
  return res.json({ status: 'OK', results });
});

// ───────────────────────────────────────────────────────────
// Admin API: 清理舊通知
app.post('/api/admin/cleanup', async (req, res) => {
  const { days = 45 } = req.body || {};
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({ error: 'INVALID_DAYS' });
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const { rowCount } = await db.cleanupOldNotifications(cutoff.toISOString());
    res.json({ ok: true, deleted: rowCount, cutoff: cutoff.toISOString() });
  } catch (err) {
    console.error('Cleanup error:', err);
    res.status(500).json({ error: 'CLEANUP_FAILED', message: err.message });
  }
});

// ───────────────────────────────────────────────────────────
// LINE Webhook (no Basic Auth, no body parser here!)
app.post('/webhook', lineMiddleware(lineConfig), async (req, res) => {
  const events = req.body?.events || [];
  await Promise.all(events.map(handleLineEvent));
  res.status(200).end();
});

async function handleLineEvent(event) {
  const replyToken = event.replyToken;
  const userId = event?.source?.userId;
  if (!userId) return; // ignore groups/rooms

  // 加好友
  if (event.type === 'follow') {
    const msg =
      '歡迎使用大樓包裹通知服務！\n' +
      '請直接輸入您的門牌完成綁定。\n' +
      '範例：14F-1 或 A-14-1';
    await lineClient.replyMessage(replyToken, { type: 'text', text: msg });
    return;
  }

  // 使用者輸入門牌
  if (event.type === 'message' && event.message?.type === 'text') {
    const inputRaw = (event.message.text || '').trim();
    const apt = normalizeApartmentNo(inputRaw);

    if (!isValidApartmentNo(apt)) {
      await lineClient.replyMessage(replyToken, {
        type: 'text',
        text: '門牌格式不正確，請輸入例如「14F-1」或「A-14-1」。',
      });
      return;
    }

    const exists = await db.apartmentExists(apt);
    if (!exists) {
      await lineClient.replyMessage(replyToken, {
        type: 'text',
        text: `查無門牌 ${apt}，請確認後再輸入。`,
      });
      return;
    }

    const ok = await db.bindApartmentToUser(apt, userId);
    if (!ok) {
      await lineClient.replyMessage(replyToken, {
        type: 'text',
        text: '綁定失敗，請稍後再試。',
      });
      return;
    }

    await lineClient.replyMessage(replyToken, {
      type: 'text',
      text: `綁定成功！之後「${apt}」的包裹通知將傳送到此帳號。`,
    });
  }
}

// ───────────────────────────────────────────────────────────
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
