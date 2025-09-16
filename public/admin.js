(() => {
  const ddl = document.querySelector('#apt');
  const countEl = document.querySelector('#count');
  const noteEl = document.querySelector('#note');
  const statusEl = document.querySelector('#status');
  const btnSend = document.querySelector('#send');
  const btnRefresh = document.querySelector('#refresh');

  function showStatus(kind, msg) {
    statusEl.className = 'status ' + (kind || '');
    statusEl.style.display = 'block';
    statusEl.innerHTML = msg;
  }
  function clearStatus() {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  async function loadApts() {
    clearStatus();
    ddl.innerHTML = '<option value="">載入中…</option>';
    try {
      const res = await fetch('/api/apartments', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('載入失敗：' + res.status);
      const list = await res.json();

      ddl.innerHTML = '';
      // 小貼心：若清單裡有 A-14-1，預設選它（你示範用）
      const pref = 'A-14-1';
      let hasPref = false;

      for (const r of list) {
        const opt = document.createElement('option');
        opt.value = r.apartment_no;
        opt.textContent = r.display_name || r.apartment_no;
        if (r.apartment_no === pref) hasPref = true;
        ddl.appendChild(opt);
      }
      if (hasPref) ddl.value = pref;

      showStatus('ok', '✅ 門牌清單載入完成，共 ' + list.length + ' 戶。');
    } catch (err) {
      showStatus('bad', '❌ 無法載入門牌清單：' + err.message);
    }
  }

  // 件數快捷鍵
  document.querySelectorAll('[data-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = Number(btn.dataset.q);
      if (q === 0) { countEl.value = ''; return; }
      const cur = Number(countEl.value || 0);
      countEl.value = String(cur + q);
    });
  });

  btnRefresh.addEventListener('click', loadApts);

  btnSend.addEventListener('click', async () => {
    clearStatus();
    const apartment = ddl.value;
    const count = countEl.value ? Number(countEl.value) : undefined;
    const note = noteEl.value.trim() || undefined;

    if (!apartment) {
      showStatus('bad', '❌ 請先選擇門牌。');
      return;
    }

    btnSend.disabled = true;
    btnSend.textContent = '送出中…';

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ apartment, count, note }),
      });

      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch (_) {}

      if (res.status === 200) {
        const okCount = Array.isArray(data.results)
          ? data.results.filter((r) => r.ok).length
          : 0;
        showStatus(
          'ok',
          '✅ 已送出通知：<span class="badge badge-ok">OK</span> ' +
            '<span class="cap">' + okCount + '</span> 位。' +
            (note ? '<br>備註：' + note : '')
        );
      } else if (res.status === 207) {
        const ok = data.results?.filter((r) => r.ok).length ?? 0;
        const fail = data.results?.length ? data.results.length - ok : 0;
        showStatus(
          'partial',
          '⚠️ 部分成功：<span class="badge badge-partial">PARTIAL</span> ' +
            'OK <span class="cap">' + ok + '</span> 位；失敗 <span class="cap">' + fail + '</span> 位。\n' +
            (data.results ? JSON.stringify(data.results, null, 2) : '')
        );
      } else {
        showStatus('bad', '❌ 送出失敗（HTTP ' + res.status + '）。\n' + (text || ''));
      }
    } catch (err) {
      showStatus('bad', '❌ 送出錯誤：' + err.message);
    } finally {
      btnSend.disabled = false;
      btnSend.textContent = '送出通知';
    }
  });

  // 初始載入
  loadApts();
})();
