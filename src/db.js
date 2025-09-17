// src/db.js  —— Postgres 版
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 嘗試載入 seed.sql（需為 Postgres 語法）。若執行失敗，會 fallback 到程式內建種子。
async function tryExecSeedSQL(pool) {
  const root = process.cwd();
  const candidates = [
    path.join(root, 'seed.sql'),
    path.join(root, 'db', 'seed.sql'),
  ];

  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const sql = fs.readFileSync(f, 'utf8').trim();
    if (!sql) continue;

    try {
      console.log(`[DB] Found seed file: ${path.relative(root, f)} — executing...`);
      await pool.query(sql);
      console.log('[DB] Seed file executed.');
      return true;
    } catch (err) {
      console.warn('[DB] Seed file execution failed (will fallback to JS seed):', err.message);
      // 不拋出，改讓外層 fallback
    }
  }
  return false;
}

// 以 JS 產生 A/B 棟 × 1..16 樓 × 每層 1..4 戶，寫入 Apartments（已存在就忽略）
async function seedApartmentsByJS(pool) {
  const values = [];
  for (const bld of ['A', 'B']) {
    for (let floor = 1; floor <= 16; floor++) {
      for (let unit = 1; unit <= 4; unit++) {
        const no = `${bld}-${floor}-${unit}`;
        values.push([no, no]);
      }
    }
  }

  // 批次插入（ON CONFLICT DO NOTHING）
  const text = `
    INSERT INTO apartments (apartment_no, display_name)
    VALUES ${values.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')}
    ON CONFLICT (apartment_no) DO NOTHING;
  `;
  const params = values.flat();
  await pool.query(text, params);
  console.log('[DB] Inserted JS seed (A/B × 1–16 × 1–4).');
}

export async function createDb(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL. Please set it in Render -> Environment -> DATABASE_URL');
  }

  // Render Postgres 需要 SSL；Free/Tier 預設用這個設定即可
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  // 建表（若不存在）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apartments (
      apartment_no TEXT PRIMARY KEY,
      display_name TEXT
    );

    CREATE TABLE IF NOT EXISTS apartment_members (
      apartment_no TEXT NOT NULL REFERENCES apartments(apartment_no) ON DELETE CASCADE,
      line_user_id  TEXT NOT NULL,
      bound_at      TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (apartment_no, line_user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id           BIGSERIAL PRIMARY KEY,
      apartment_no TEXT REFERENCES apartments(apartment_no) ON DELETE SET NULL,
      count        INTEGER,
      note         TEXT,
      status       TEXT NOT NULL,
      error        JSONB,
      sent_at      TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_members_apt ON apartment_members(apartment_no);
    CREATE INDEX IF NOT EXISTS idx_notif_apt   ON notifications(apartment_no);
  `);

  // 若 apartments 還是空的，先嘗試 seed.sql（Postgres 語法），再 fallback JS 種子
  const { rows: cntRows } = await pool.query(`SELECT COUNT(1)::int AS c FROM apartments;`);
  if (cntRows[0].c === 0) {
    const hadSeed = await tryExecSeedSQL(pool);
    if (!hadSeed) {
      await seedApartmentsByJS(pool);
    }
  }

  // 正確排序：棟別(A/B/...) → 樓層(數值) → 戶號(數值)
  const LIST_SQL = `
    SELECT
      apartment_no,
      COALESCE(display_name, apartment_no) AS display_name
    FROM apartments
    ORDER BY
      split_part(apartment_no, '-', 1),             -- 棟別
      (split_part(apartment_no, '-', 2))::int ASC,  -- 樓層
      (split_part(apartment_no, '-', 3))::int ASC;  -- 戶號
  `;

  return {
    /** 列出全部門牌（依 棟別→樓層→戶號 排序） */
    async listApartments() {
      const { rows } = await pool.query(LIST_SQL);
      return rows;
    },

    /** 確認門牌是否存在 */
    async apartmentExists(apartmentNo) {
      const { rows } = await pool.query(
        `SELECT 1 FROM apartments WHERE apartment_no = $1 LIMIT 1;`,
        [apartmentNo]
      );
      return rows.length > 0;
    },

    /** 綁定 LINE 使用者到門牌（同戶可多人；重複忽略） */
    async bindApartmentToUser(apartmentNo, userId) {
      const exists = await this.apartmentExists(apartmentNo);
      if (!exists) return false;

      await pool.query(
        `INSERT INTO apartment_members (apartment_no, line_user_id)
         VALUES ($1, $2)
         ON CONFLICT (apartment_no, line_user_id) DO NOTHING;`,
        [apartmentNo, userId]
      );
      return true;
    },

    /** 取得門牌綁定的所有 LINE userId */
    async getUserIdsByApartment(apartmentNo) {
      const { rows } = await pool.query(
        `SELECT line_user_id FROM apartment_members WHERE apartment_no = $1;`,
        [apartmentNo]
      );
      return rows.map(r => r.line_user_id);
    },

    /** 記錄通知發送結果（error 會存 JSON） */
    async addNotification(apartmentNo, count, note, status, error) {
      await pool.query(
        `INSERT INTO notifications (apartment_no, count, note, status, error)
         VALUES ($1, $2, $3, $4, $5::jsonb);`,
        [apartmentNo, count ?? null, note ?? null, status, error ? JSON.stringify(error) : null]
      );
    },
  };
}
