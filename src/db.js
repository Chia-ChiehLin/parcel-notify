import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// 建立資料夾
function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function createDb(dbPath) {
  ensureDir(dbPath);
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // 建表
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Apartments (
      apartment_no TEXT PRIMARY KEY,
      display_name TEXT
    );

    CREATE TABLE IF NOT EXISTS ApartmentMembers (
      apartment_no TEXT NOT NULL,
      line_user_id TEXT NOT NULL,
      bound_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (apartment_no, line_user_id),
      FOREIGN KEY (apartment_no) REFERENCES Apartments(apartment_no) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_no TEXT NOT NULL,
      count INTEGER,
      note TEXT,
      status TEXT NOT NULL,
      error TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (apartment_no) REFERENCES Apartments(apartment_no) ON DELETE SET NULL
    );
  `);

  // 若無任何門牌，塞一些種子資料（你可日後用 SQL 匯入大樓完整清單）
  const row = await db.get(`SELECT COUNT(1) AS c FROM Apartments;`);
  if (row.c === 0) {
    const seed = ['3F-1', '3F-2', '4F-1', '5F-3'];
    const stmt = await db.prepare(`INSERT INTO Apartments(apartment_no, display_name) VALUES(?, ?)`);
    for (const apt of seed) {
      await stmt.run(apt, apt);
    }
    await stmt.finalize();
  }

  return {
    // 列出全部門牌
    async listApartments() {
      return db.all(`SELECT apartment_no, COALESCE(display_name, apartment_no) AS display_name FROM Apartments ORDER BY apartment_no;`);
    },

    // 確認門牌是否存在
    async apartmentExists(apartmentNo) {
      const r = await db.get(`SELECT 1 FROM Apartments WHERE apartment_no = ?;`, [apartmentNo]);
      return !!r;
    },

    // 為門牌加住戶（綁定）
    async bindApartmentToUser(apartmentNo, userId) {
      // 確保門牌存在
      const exists = await this.apartmentExists(apartmentNo);
      if (!exists) return false;
      await db.run(
        `INSERT OR IGNORE INTO ApartmentMembers(apartment_no, line_user_id) VALUES(?, ?);`,
        [apartmentNo, userId]
      );
      return true;
    },

    // 取得該門牌綁定的所有 LINE userId（支援一家多位成員）
    async getUserIdsByApartment(apartmentNo) {
      const rows = await db.all(
        `SELECT line_user_id FROM ApartmentMembers WHERE apartment_no = ?;`,
        [apartmentNo]
      );
      return rows.map(r => r.line_user_id);
    },

    // 記錄發送結果
    async addNotification(apartmentNo, count, note, status, error) {
      await db.run(
        `INSERT INTO Notifications(apartment_no, count, note, status, error) VALUES (?, ?, ?, ?, ?);`,
        [apartmentNo, count ?? null, note ?? null, status, error ?? null]
      );
    }
  };
}
