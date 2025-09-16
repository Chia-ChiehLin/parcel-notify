// src/utils.js
export function normalizeApartmentNo(raw) {
  // 去空白、轉大寫
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');

  // 允許 A14-1 -> A-14-1
  const m = s.match(/^([A-Z])(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return s;
}

export function isValidApartmentNo(raw) {
  const s = normalizeApartmentNo(raw);
  // 支援兩種：
  // 1) 14F-1
  // 2) A-14-1（棟別-樓層-戶號）
  return /^\d{1,2}F-\d{1,2}$/.test(s) || /^[A-Z]-\d{1,2}-\d{1,2}$/.test(s);
}

export function nowIso() {
  return new Date().toISOString();
}
