// public/admin.js

// 解析門牌字串：A-14-1 -> { b:'A', f:14, u:1 }
function parseAptKey(s) {
  const m = /^([A-Za-z])-(\d+)-(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  return { b: m[1].toUpperCase(), f: Number(m[2]), u: Number(m[3]) };
}

function sortApartments(arr) {
  // arr: [{ apartment_no, display_name }]
  return arr.slice().sort((x, y) => {
    const ax = parseAptKey(x.apartment_no);
    const ay = parseAptKey(y.apartment_no);
    // 不符合格式的丟到最後，然後比字典序
    if (!ax && !ay) return x.apartment_no.localeCompare(y.apartment_no);
    if (!ax) return 1;
    if (!ay) return -1;

    if (ax.b !== ay.b) return ax.b.localeCompare(ay.b);
    if (ax.f !== ay.f) return ax.f - ay.f;
    return ax.u - ay.u;
  });
}

async function loadApartments() {
  const sel = document.querySelector('#aptSelect');
  sel.innerHTML = '';
  let data = [];
  try {
    const r = await fetch('/api/apartments', { cache: 'no-store' });
    data = await r.json();
  } catch (e) {
    console.error('Failed to load /api/apartments:', e);
  }
  const sorted = sortApartments(data);
  for (const row of sorted) {
    const opt = document.createElement('option');
    opt.value = row.apartment_no;
    opt.textContent = row.display_name || row.apartment_no;
    sel.appendChild(opt);
  }
}

// 數量步進器
function setupCounter() {
  const countInput = document.querySelector('#countInput');
  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.step);
      let v = Number(countInput.value || '0') + delta;
      if (v < 0) v = 0;
      countInput.value = String(v);
    });
  }
  document.querySelector('#clearCount').addEventListener('click', () => {
    countInput.value = '';
  });
}

// 送出通知
function setupSubmit() {
  const formBtn = document.querySelector('#submitBtn');
  const sel = document.querySelector('#aptSelect');
  const countInput = document.querySelector('#countInput');
  const noteInput = document.querySelector('#noteInput');
  const msgBox = document.querySelector('#msgBox');

  formBtn.addEventListener('click', async () => {
    msgBox.textContent = '';
    const apartment = sel.value;
    const count = countInput.value ? Number(countInput.value) : undefined;
    const note = noteInput.value?.trim() || undefined;

    try {
      const r = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartment, count, note }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) {
        msgBox.textContent = `✖ 發送失敗 (HTTP ${r.status})：${JSON.stringify(res)}`;
        msgBox.className = 'msg error';
      } else {
        msgBox.textContent = '✔ 已發送通知！';
        msgBox.className = 'msg ok';
      }
    } catch (e) {
      msgBox.textContent = `✖ 發送失敗：${e.message}`;
      msgBox.className = 'msg error';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadApartments();
  setupCounter();
  setupSubmit();
  document.querySelector('#reloadApts').addEventListener('click', loadApartments);
});
