-- 建表（若不存在）
CREATE TABLE IF NOT EXISTS Apartments (
  apartment_no TEXT PRIMARY KEY,
  display_name TEXT
);

-- 產生 A/B 兩棟、1~16 樓、每層 1~4 戶
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
  printf('%s-%d-%d', b, n, u) AS apartment_no,
  printf('%s-%d-%d', b, n, u) AS display_name
FROM bld
CROSS JOIN floor
CROSS JOIN unit;
