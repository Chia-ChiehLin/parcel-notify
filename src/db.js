// src/db.js
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// 確保資料夾存在
function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 嘗試執行 seed.sql（根目錄或 db/seed.sql）
async function tryExecSeedSQL(db) {
  const root = process.cwd();
  const candidates = [
    path.join(root, 'seed.sql'),
    path.join(root, 'db', 'seed.sql'),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const sql = fs.readFileSync(f, 'utf8');
      if (sql.trim()) {
        console.log(`[DB] Found seed file: ${path.relative(root, f)} — executing...`);
        await db.exec(sql);
        console.log('[DB] Seed file executed.');
        return true;
      }
    }
  }
  console.log('[DB] No seed.sql found.');
  return false;
}

// 內建一份與 seed.sql 等價的種子 SQL（保險用）
const BUILTIN_SEED_SQL = `
CREATE TABLE IF NOT EXISTS Apartments (
  apartment_no TEXT PRIMARY KEY,
  display_name TEXT
);
WITH RECURSIVE
  floor(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM floor WHERE n < 16
  ),
  bld(b) AS (VALUES ('A'), ('B')),
  unit(u) AS (VALUES (1),(2),(3),(4))
INSERT OR IGNORE INTO Apartments (apartment_no, display_name)
SELECT
  printf('%s-%d-%d', b, n, u),
  printf('%s-%d-%d', b, n, u)
FROM bld
CROSS JOIN floor
CROSS JOIN unit;
`;

export async function createDb(dbPath) {
  ensureDir(dbPath);

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`PRAGMA foreign_keys = ON;`);

  // 建其他表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ApartmentMembers (
      apartment_no TEXT NOT NULL,
      line_user_id TEXT NOT NULL,
      bound_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (apartment_no, line_user_id),
      FOREIGN KEY (apartment_no) REFERENCES Apartments(apartment_no) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Notifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_no TEXT,
      count        INTEGER,
      note         TEXT,
      status       TEXT NOT NULL,
      error        TEXT,
      sent_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (apartment_no) REFERENCES Apartments(apartment_no) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_members_apt ON ApartmentMembers(apartment_no);
    CREATE INDEX IF NOT EXISTS idx_notif_apt   ON Notifications(apartment_no);
  `);

  // 先試著跑檔案版 seed
  await tryExecSeedSQL(db);

  // 檢查是否真的有資料，沒有就跑內建種子
  const { c: countApt } = await db.get(`SELECT COUNT(1) AS c FROM Apartments;`);
  console.log(`[DB] Apartments rows after seeding: ${countApt}`);
  if (countApt === 0) {
    console.log('[DB] Apartments still empty — running built-in seed...');
    await db.exec(BUILTIN_SEED_SQL);
    const { c: after } = await db.get(`SELECT COUNT(1) AS c FROM Apartments;`);
    console.log(`[DB] Apartments rows after built-in seed: ${after}`);
  }

  return {
    async listApartments() {
      return db.all(`
        SELECT apartment_no, COALESCE(display_name, apartment_no) AS display_name
        FROM Apartments
        ORDER BY apartment_no;
      `);
    },

    async apartmentExists(apartmentNo) {
      const r = await db.get(
        `SELECT 1 FROM Apartments WHERE apartment_no = ?;`,
        [apartmentNo]
      );
      return !!r;
    },

    async bindApartmentToUser(apartmentNo, userId) {
      const exists = await this.apartmentExists(apartmentNo);
      if (!exists) return false;
      await db.run(
        `INSERT OR IGNORE INTO ApartmentMembers(apartment_no, line_user_id)
         VALUES(?, ?);`,
        [apartmentNo, userId]
      );
      return true;
    },

    async getUserIdsByApartment(apartmentNo) {
      const rows = await db.all(
        `SELECT line_user_id
         FROM ApartmentMembers
         WHERE apartment_no = ?;`,
        [apartmentNo]
      );
      return rows.map(r => r.line_user_id);
    },

    async addNotification(apartmentNo, count, note, status, error) {
      await db.run(
        `INSERT INTO Notifications(apartment_no, count, note, status, error)
         VALUES (?, ?, ?, ?, ?);`,
        [apartmentNo, count ?? null, note ?? null, status, error ?? null]
      );
    },
  };
}
