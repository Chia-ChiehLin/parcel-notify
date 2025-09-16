// src/init.js
import 'dotenv/config';
import fs from 'fs/promises';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_PATH = process.env.DB_PATH || './data/app.db';

async function main() {
  // 確保資料夾存在
  await fs.mkdir('./data', { recursive: true });

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  // 建表（若已存在就略過）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS apartments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_no TEXT NOT NULL,
      user_id TEXT NOT NULL,
      UNIQUE(apartment_no, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_no TEXT NOT NULL,
      count INTEGER,
      note TEXT,
      status TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 寫入你的門牌號（重複執行也不會報錯）
  const apt = 'A-14-1';
  await db.run('INSERT OR IGNORE INTO apartments(no) VALUES (?)', [apt]);

  console.log(`✅ 初始化完成，已確保門牌 ${apt} 存在於資料庫`);
  await db.close();
}

main().catch((err) => {
  console.error('❌ 初始化失敗:', err);
  process.exit(1);
});
