// src/app.js —— Express app（本機 src/server.js 與 Vercel api/index.js 共用）
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Client,
  middleware as lineMiddleware,
  SignatureValidationFailed,
  JSONParseError,
} from '@line/bot-sdk';
import { createDb } from './db.js';
import { isValidApartmentNo, normalizeApartmentNo, nowIso } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────────────────────────────────────────────
// ENV
const {
  ADMIN_USER = 'guard',
  ADMIN_PASS = 'change_me',
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  CRON_SECRET,
  DATABASE_URL,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  throw new Error('Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET');
}

const CLEANUP_DAYS = 45;

// ───────────────────────────────────────────────────────────
// Init
const app = express();
app.use(helmet());
app.use(morgan('dev'));

// DB（Postgres）：第一次用到時才連線，失敗的話下一個請求會重試。
// Serverless 環境每次冷啟動都是新的 process，所以不在 import 時就連線。
let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = createDb(DATABASE_URL).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// LINE SDK
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const lineClient = new Client(lineConfig);

// Express 4 不會接住 async handler 的錯誤，包一層交給最後的 error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// ───────────────────────────────────────────────────────────
// Basic Auth for guard/admin pages & APIs
// 去掉複製貼上時常多出來的前後空白與引號
const cleanSecret = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
const EXPECTED_USER = cleanSecret(ADMIN_USER);
const EXPECTED_PASS = cleanSecret(ADMIN_PASS);

function basicAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.split(' ')[1] || '';
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64').toString();
  } catch (_) {}
  // 密碼裡可能有冒號，只用第一個冒號切開
  const sep = decoded.indexOf(':');
  const user = sep >= 0 ? decoded.slice(0, sep).trim() : '';
  const pass = sep >= 0 ? decoded.slice(sep + 1).trim() : '';

  const userOk = safeEqual(user, EXPECTED_USER);
  const passOk = safeEqual(pass, EXPECTED_PASS);
  if (userOk && passOk) return next();

  // 只記錄哪一項不對，不記錄輸入的內容
  if (header) {
    const reason = !userOk && !passOk ? 'wrong_user_and_password' : !userOk ? 'wrong_user' : 'wrong_password';
    console.warn(`[auth] login failed: ${reason}`);
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Guard Area", charset="UTF-8"');
  return res.status(401).send('Unauthorized');
}

// Health check (no auth)
app.get('/health', (req, res) => res.json({ ok: true }));

// Gatekeeper: /health、/webhook、/api/cron/* 不需要 Basic Auth；其餘都要
app.use((req, res, next) => {
  if (
    req.path === '/health' ||
    req.path.startsWith('/webhook') ||
    req.path.startsWith('/api/cron/')
  ) {
    return next();
  }
  return basicAuth(req, res, next);
});

// Static admin page (protected by Basic Auth above)
app.use(express.static(path.join(__dirname, '..', 'public')));

// JSON body only for /api (avoid interfering LINE signature verification)
app.use('/api', express.json());

// ───────────────────────────────────────────────────────────
// APIs (protected)
app.get(
  '/api/apartments',
  wrap(async (req, res) => {
    const db = await getDb();
    const rows = await db.listApartments();
    res.json(rows);
  })
);

app.post(
  '/api/notify',
  wrap(async (req, res) => {
    const { apartment, count, note } = req.body || {};
    if (!apartment) return res.status(400).json({ error: 'MISSING_APARTMENT' });

    const db = await getDb();
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
  })
);

// ───────────────────────────────────────────────────────────
// 清理舊通知
async function cleanupOlderThan(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const db = await getDb();
  const { rowCount } = await db.cleanupOldNotifications(cutoff.toISOString());
  return { deleted: rowCount, cutoff: cutoff.toISOString() };
}

// Admin API（Basic Auth）：手動清理，可指定天數
app.post(
  '/api/admin/cleanup',
  wrap(async (req, res) => {
    const { days = CLEANUP_DAYS } = req.body || {};
    if (!Number.isInteger(days) || days <= 0) {
      return res.status(400).json({ error: 'INVALID_DAYS' });
    }
    res.json({ ok: true, ...(await cleanupOlderThan(days)) });
  })
);

// Vercel Cron 每天呼叫一次（見 vercel.json）。
// Vercel 會自動帶上 Authorization: Bearer <CRON_SECRET>。
app.get(
  '/api/cron/cleanup',
  wrap(async (req, res) => {
    if (!CRON_SECRET || !safeEqual(req.headers['authorization'] || '', `Bearer ${CRON_SECRET}`)) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    res.json({ ok: true, ...(await cleanupOlderThan(CLEANUP_DAYS)) });
  })
);

// ───────────────────────────────────────────────────────────
// LINE Webhook (no Basic Auth, no body parser here!)
app.post(
  '/webhook',
  lineMiddleware(lineConfig),
  wrap(async (req, res) => {
    const events = req.body?.events || [];
    const results = await Promise.allSettled(events.map(handleLineEvent));
    for (const r of results) {
      if (r.status === 'rejected') console.error('[webhook] event failed:', r.reason);
    }
    res.status(200).end();
  })
);

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

    const db = await getDb();
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
// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof SignatureValidationFailed) {
    return res.status(401).send(err.message);
  }
  if (err instanceof JSONParseError) {
    return res.status(400).send(err.message);
  }
  console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
});

export default app;
