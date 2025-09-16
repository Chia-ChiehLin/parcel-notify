// /public/admin.js

(function () {
  // ───────── DOM refs ─────────
  const aptEl     = document.getElementById('apt');
  const countEl   = document.getElementById('count');
  const noteEl    = document.getElementById('note');
  const sendBtn   = document.getElementById('send');
  const refreshBtn= document.getElementById('refresh');
  const statusEl  = document.getElementById('status');

  // 若有任何元素抓不到，直接提示並中止，避免 null.innerHTML 這類錯誤
  if (!aptEl || !countEl || !noteEl || !sendBtn || !refreshBtn || !statusEl) {
    console.error('[admin] 找不到必要的 DOM 元素，請檢查 index.html 的 id 是否與 admin.js 對應：#apt, #count, #note, #send, #refresh, #status');
    return;
  }

  // ───────── 小工具 ─────────
  function showStatus(msg, kind = 'ok') {
    statusEl.style.display = 'block';
    statusEl.className = `status ${kind}`;
    statusEl.textContent = msg;
  }

  function clearStatus() {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  // 再保險一次：自然排序（就算後端已經排好，前端再排序一次也不吃虧）
  function parseAptKey(s) {
    // 格式預期：A-14-1 / B-3-4 / 14F-1（也允許你的舊資料）
    const m = String(s).match(/^([A-Za-z]?)-?(\d+)[F-](\d+)$/) || String(s).match(/^([A-Za-z])-(\d+)-(\d+)$/);
    if (m) {
      const b = m[1];
      const f = parseInt(m[2], 10);
      const u = parseInt(m[3], 10);
      // 把 A/B 轉成數字，A=1, B=2，其它給大數以免排前面
      const bnum = /^[A-Za-z]$/.test(b) ? (b.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1) : 999;
      return { b, bnum, floor: f, unit: u, ok: true };
    }
    // 兜底：全部給很大，最後按字典序
    return { b: 'Z', bnum: 999, floor: 9999, unit: 9999, ok: false, raw: s };
  }

  function naturalCompare(a, b) {
    const A = parseAptKey(a), B = parseAptKey(b);
    if (A.ok && B.ok) {
      if (A.bnum !== B.bnum) return A.bnum - B.bnum;
      if (A.floor !== B.floor) return A.floor - B.floor;
      return A.unit - B.unit;
    }
    // 其中一個或兩個格式不符就退回字典序
    return a.localeCompare(b, 'zh-Hant');
  }

  // ───────── 讀清單 ─────────
  async function loadApartments() {
    clearStatus();

    // 顯示 loading
    aptEl.innerHTML = `<option value="">載入中…</option>`;
    aptEl.disabled = true;

    try {
      const res = await fetch('/api/apartments', { credentials: 'same-origin' });
      if (!res.ok) {
        const t = await res.text().catch(()=>res.statusText);
        throw new Error(`讀取清單失敗 (${res.status}) ${t}`);
      }
      /** @type {{apartment_no:string,display_name:string}[]} */
      const data = await res.json();

      // 排序（若後端有照 A→B、1→16、1→4 排好，這邊會維持一樣的順序）
      data.sort((x, y) => naturalCompare(x.display_name || x.apartment_no, y.display_name || y.apartment_no));

      // 填入選單
      aptEl.innerHTML = data
        .map(r => {
          const label = r.display_name || r.apartment_no;
          const value = r.apartment_no;
          return `<option value="${value}">${label}</option>`;
        })
        .join('');

      if (aptEl.options.length === 0) {
        aptEl.innerHTML = `<option value="">（沒有資料）</option>`;
      }

      aptEl.disabled = false;
    } catch (err) {
      console.error(err);
      aptEl.innerHTML = `<option value="">讀取失敗，請重試</option>`;
      showStatus(`讀取門牌清單失敗：${err.message}`, 'bad');
    }
  }

  // ───────── 送通知 ─────────
  async function sendNotify() {
    clearStatus();

    const apartment = aptEl.value;
    const countRaw  = countEl.value.trim();
    const note      = noteEl.value.trim();

    if (!apartment) {
      showStatus('請先選擇門牌。', 'bad');
      aptEl.focus();
      return;
    }

    const payload = {
      apartment,
      count: countRaw === '' ? null : Number(countRaw),
      note: note || null,
    };

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const bodyText = await res.text();
      let body;
      try { body = JSON.parse(bodyText); } catch { body = bodyText; }

      if (res.ok) {
        showStatus(`✅ 已送出：${typeof body === 'string' ? body : JSON.stringify(body)}`, 'ok');
      } else if (res.status === 207) {
        showStatus(`⚠️ 部分成功：${JSON.stringify(body)}`, 'partial');
      } else {
        // e.g. { error: 'NOT_BOUND', message: '該戶尚未綁定 LINE 帳號' }
        const msg = typeof body === 'string' ? body : (body?.message || JSON.stringify(body));
        showStatus(`❌ 失敗（HTTP ${res.status}）：${msg}`, 'bad');
      }
    } catch (err) {
      console.error(err);
      showStatus(`❌ 送出失敗：${err.message}`, 'bad');
    }
  }

  // ───────── 快捷＋數字按鈕 ─────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-q]');
    if (!btn) return;
    const q = Number(btn.getAttribute('data-q') || '0');
    if (q === 0) {
      countEl.value = '';
    } else {
      const cur = Number(countEl.value || '0');
      countEl.value = String(cur + q);
    }
  });

  // 綁定事件
  sendBtn.addEventListener('click', sendNotify);
  refreshBtn.addEventListener('click', loadApartments);

  // 初始載入
  loadApartments();
})();
