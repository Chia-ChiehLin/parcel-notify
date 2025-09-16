// src/db.js
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

/** 確保資料夾存在（支援相對路徑，例如 ./data/app.db） */
function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 嘗試從專案根目錄載入 seed.sql（若存在就執行） */
async function tryExecSeedSQL(db) {
  const root = process.cwd();
  const candidates = [
    path.join(root, 'seed.sql'),
    path.join(root, 'db', 'seed.sql'),
  ];

  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const sql = fs.readFileSync(f, 'utf8');
      if (sql && sql.trim()) {
        console.log(`[DB] Found seed file: ${path.relative(root, f)} — executing...`);
        await db.exec(sql);
        console.log('[DB] Seed file executed.');
        return true;
      }
    }
  }
  return false;
}

export async function createDb(dbPath) {
  ensureDir(dbPath);

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // 基本表結構
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Apartments (
      apartment_no TEXT PRIMARY KEY,
      display_name TEXT
    );

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

  const hadSeed = await tryExecSeedSQL(db);

  // 沒有 seed.sql 且是空表就塞幾筆預設，方便初次測試
  const { c } = await db.get(`SELECT COUNT(1) AS c FROM Apartments;`);
  if (!hadSeed && c === 0) {
    const seed = ['A-14-1', 'A-1-1', 'A-1-2', 'B-1-1'];
    const stmt = await db.prepare(
      `INSERT OR IGNORE INTO Apartments(apartment_no, display_name) VALUES(?, ?)`
    );
    for (const apt of seed) await stmt.run(apt, apt);
    await stmt.finalize();
  }

  // ===== 關鍵：用字串切割出棟別、樓層、戶號來排序 =====
  // 解析說明：
  //   bld  = 第一個字元
  //   pos1 = 第一個 '-' 位置
  //   pos2 = 第二個 '-' 位置（用子字串再找 '-' 的技巧）
  //   floor = pos1+1 到 pos2-1 的數字
  //   unit  = pos2+1 到結尾 的數字
  //
  // 注意：SQLite 的 substr 是 1-based。
  const LIST_SQL = `
    SELECT
      apartment_no,
      COALESCE(display_name, apartment_no) AS display_name
    FROM Apartments
    ORDER BY
      substr(apartment_no, 1, 1), /* 棟別：A, B, ... */
      CAST(
        substr(
          apartment_no,
          instr(apartment_no, '-') + 1,
          (instr(substr(apartment_no, instr(apartment_no, '-') + 1), '-') - 1)
        ) AS INTEGER
      ) ASC,
      CAST(
        substr(
          apartment_no,
          instr(apartment_no, '-') +
          instr(substr(apartment_no, instr(apartment_no, '-') + 1), '-') + 1
        ) AS INTEGER
      ) ASC;
  `;

  return {
    /** 依「棟別→樓層→戶號」排序列出 */
    async listApartments() {
      return db.all(LIST_SQL);
    },

    /** 確認門牌是否存在 */
    async apartmentExists(apartmentNo) {
      const r = await db.get(
        `SELECT 1 FROM Apartments WHERE apartment_no = ?;`,
        [apartmentNo]
      );
      return !!r;
    },

    /** 綁定 LINE 使用者到門牌（同戶可多人） */
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

    /** 取得門牌綁定的所有 LINE userId */
    async getUserIdsByApartment(apartmentNo) {
      const rows = await db.all(
        `SELECT line_user_id
         FROM ApartmentMembers
         WHERE apartment_no = ?;`,
        [apartmentNo]
      );
      return rows.map(r => r.line_user_id);
    },

    /** 記錄通知發送結果 */
    async addNotification(apartmentNo, count, note, status, error) {
      await db.run(
        `INSERT INTO Notifications(apartment_no, count, note, status, error)
         VALUES (?, ?, ?, ?, ?);`,
        [apartmentNo, count ?? null, note ?? null, status, error ?? null]
      );
    },
  };
}
