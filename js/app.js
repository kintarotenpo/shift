'use strict';

const App = (() => {
  const $ = s => document.querySelector(s);
  const S = () => DB.state;
  const ui = {
    tab: 'month', ym: U.todayYM(), day: new Date().getDate(), mode: 'editor',
    me: '', onlyMe: false, alertsOpen: false, openCards: new Set(), openLeave: '',
  };
  let alerts = { list: [], streak: new Set(), dayShort: {}, storeShort: {} };
  let editing = null;
  let reqParsed = [];

  /* ---------- 共通UI ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  const busy = (on, text = '') => { $('#busy').hidden = !on; $('#busyText').textContent = text; };
  function openModal(html, cls = '') {
    $('#modalRoot').innerHTML = `<div class="overlay" data-overlay><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
    document.body.classList.add('modal-open');
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; document.body.classList.remove('modal-open'); editing = null; }
  /** 独自の確認ダイアログ（ブラウザ標準の confirm が使えない環境向け） */
  function ask(message, { ok = 'OK', danger = false } = {}) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay confirm-layer';
      wrap.innerHTML = `<div class="modal confirm" role="alertdialog" aria-modal="true">
        <div class="modal-body"><p class="confirm-msg">${U.esc(message).replace(/\n/g, '<br>')}</p></div>
        <div class="modal-foot"><button class="btn ghost" data-ans="0">キャンセル</button>
        <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ans="1">${U.esc(ok)}</button></div></div>`;
      const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
      };
      wrap.addEventListener('click', e => {
        e.stopPropagation();
        const b = e.target.closest('[data-ans]');
        if (b) done(b.dataset.ans === '1');
        else if (e.target === wrap) done(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      wrap.querySelector('[data-ans="1"]').focus();
    });
  }
  const modalHead = title => `<div class="modal-head"><h3>${title}</h3><button class="icon-btn light" data-act="modal-close" aria-label="閉じる">×</button></div>`;
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const ymLabel = () => { const [y, m] = U.parseYM(ui.ym); return `${y}年${m}月`; };
  const statusLabel = () => (S().months[ui.ym]?.status === 'final' ? '確定' : '暫定');

  /* ---------- 初期化 ---------- */
  async function init() {
    const h = location.hash;
    if (h.startsWith('#v=')) {
      try {
        const st = await Share.decode(h.slice(3));
        DB.useTemp(st);
        ui.mode = 'viewer'; ui.ym = st._ym;
        try {
          const name = localStorage.getItem('shiftboard:me') || '';
          ui.me = st.staff.find(p => p.name === name)?.id || '';
        } catch (e) { /* noop */ }
      } catch (e) {
        console.error(e);
        DB.load();
        setTimeout(() => toast('共有リンクを読み込めませんでした。リンクが途中で切れていないか確認してください'), 300);
      }
    } else {
      DB.load();
    }
    if (ui.ym !== U.todayYM()) ui.day = 1;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    window.addEventListener('hashchange', () => location.reload());
    $('#csvFile').addEventListener('change', csvImport);
    $('#jsonFile').addEventListener('change', backupImport);
    render();
  }

  /* ---------- 描画 ---------- */
  function render() {
    const st = S();
    const [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m);
    ui.day = Math.min(Math.max(1, ui.day), N);
    const viewer = ui.mode === 'viewer';
    if (viewer && (ui.tab === 'leave' || ui.tab === 'settings')) ui.tab = 'month';
    document.body.classList.toggle('viewer', viewer);
    document.title = `${ymLabel()} シフト | ${st.settings.appName}`;
    $('#brandName').textContent = st.settings.appName;
    $('#monthLabel').innerHTML = `${y}<small>年</small>${m}<small>月</small>`;
    $('#prevMonth').hidden = $('#nextMonth').hidden = viewer;
    const fin = st.months[ui.ym]?.status === 'final';
    $('#statusBadge').textContent = fin ? '確定' : '暫定';
    $('#statusBadge').className = 'badge ' + (fin ? 'final' : 'draft');
    $('#modeBadge').textContent = viewer ? '閲覧のみ' : '作成者';
    document.querySelectorAll('#tabs .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === ui.tab);
      b.hidden = viewer && b.hasAttribute('data-editor-only');
    });
    alerts = Alerts.compute(st, ui.ym);
    renderToolbar();
    renderAlertBar();
    renderView();
  }

  function renderToolbar() {
    const tb = $('#toolbar');
    if (ui.tab === 'leave' || ui.tab === 'settings') { tb.innerHTML = ''; tb.hidden = true; return; }
    tb.hidden = false;
    const exportMenu = `<details class="dd"><summary class="btn">ダウンロード</summary><div class="menu">
      <button data-act="export-pdf">PDFで保存</button><button data-act="export-jpg">JPG画像で保存</button></div></details>`;
    if (ui.mode === 'viewer') {
      const st = S();
      tb.innerHTML = `<div class="tb-group">
        <label class="me-sel"><span>自分の名前</span><select data-change="me"><option value="">選択してください</option>
          ${st.staff.map(p => `<option value="${p.id}" ${ui.me === p.id ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></label>
        ${ui.me ? `<label class="chk"><input type="checkbox" data-change="onlyMe" ${ui.onlyMe ? 'checked' : ''}> 自分だけ表示</label>` : ''}
        </div><div class="tb-group right">${exportMenu}<button class="btn primary" data-act="share">共有</button></div>`;
      return;
    }
    const mon = S().months[ui.ym];
    tb.innerHTML = `<div class="tb-group">
        <button class="btn" data-act="req-input">希望休を入力</button>
        <button class="btn dark" data-act="generate">自動作成</button>
        <button class="btn" data-act="fix">アラート自動調整</button>
        <select class="sel" data-change="status" aria-label="状態">
          <option value="draft" ${mon?.status !== 'final' ? 'selected' : ''}>暫定</option>
          <option value="final" ${mon?.status === 'final' ? 'selected' : ''}>確定</option></select>
      </div>
      <div class="tb-group right">
        <details class="dd"><summary class="btn">CSV</summary><div class="menu">
          <button data-act="csv-export">CSVを出力</button><button data-act="csv-import">CSVを読み込む</button></div></details>
        ${exportMenu}
        <button class="btn primary" data-act="share">共有</button>
        <details class="dd"><summary class="btn icon" aria-label="その他">…</summary><div class="menu">
          <button data-act="clear-month">この月を白紙に戻す</button></div></details>
      </div>`;
  }

  function renderAlertBar() {
    const el = $('#alertBar');
    if (ui.mode === 'viewer' || ui.tab === 'leave' || ui.tab === 'settings' || !S().months[ui.ym]) { el.innerHTML = ''; return; }
    const L = alerts.list;
    if (!L.length) {
      const has = Object.values(S().months[ui.ym].cells || {}).some(r => Object.keys(r || {}).length);
      el.innerHTML = has ? `<div class="alert-bar ok"><span class="ab-icon">✓</span>アラートはありません</div>` : '';
      return;
    }
    const n = t => L.filter(a => a.type === t).length;
    el.innerHTML = `<div class="alert-bar ng">
      <button class="ab-toggle" data-act="toggle-alerts"><span class="ab-icon">!</span>
        <b>要確認 ${L.length}件</b><span class="ab-sum">人員不足 ${n('short')} ・ 連勤超過 ${n('streak')}${n('warn') ? ' ・ その他 ' + n('warn') : ''}</span>
        <span class="chev">${ui.alertsOpen ? '閉じる' : '一覧'}</span></button>
      ${ui.alertsOpen ? `<ul class="ab-list">${L.map((a, i) => `<li><button data-act="alert-go" data-i="${i}" class="ab-item ${a.type}">
        <span class="ab-type">${{ short: '人員不足', streak: '連勤', warn: '確認' }[a.type]}</span>${U.esc(Alerts.label(a, S()))}</button></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function renderView() {
    const st = S(), v = $('#view');
    if (ui.tab === 'month') v.innerHTML = (ui.mode === 'viewer' && ui.me ? V.myShift(st, ui) : '') + V.month(st, ui, alerts);
    else if (ui.tab === 'day') v.innerHTML = V.day(st, ui, alerts);
    else if (ui.tab === 'leave') v.innerHTML = V.leave(st, ui);
    else v.innerHTML = V.settings(st, ui);
    if (ui.tab === 'day') v.querySelector('.ds.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /* ---------- イベント ---------- */
  function onClick(e) {
    document.querySelectorAll('details.dd[open], details.multi[open]').forEach(dt => { if (!dt.contains(e.target)) dt.open = false; });
    if (e.target.matches('[data-overlay]')) { closeModal(); return; }
    const t = e.target.closest('[data-act],[data-tab],[data-goday],td.c,.bar,.off-item.clickable');
    if (!t) return;
    if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }
    if (t.dataset.act) {
      t.closest('details.dd')?.removeAttribute('open');
      const fn = actions[t.dataset.act];
      if (fn) { e.preventDefault(); fn(t, e); }
      return;
    }
    if (t.dataset.goday) { ui.day = +t.dataset.goday; ui.tab = 'day'; render(); window.scrollTo({ top: 0 }); return; }
    if (ui.mode === 'editor' && t.dataset.sid) openCellEditor(t.dataset.sid, +t.dataset.d);
  }

  function onToggle(e) {
    const dt = e.target;
    if (dt.matches && dt.matches('details[data-card]')) {
      if (dt.open) ui.openCards.add(dt.dataset.card); else ui.openCards.delete(dt.dataset.card);
    }
  }

  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {};
    o[ks[ks.length - 1]] = val;
  }

  function refreshSummary(kind, id) {
    const el = document.querySelector(`[data-sum="${kind}|${id}"]`);
    if (!el) return;
    if (kind === 'store') el.innerHTML = V.storeSummary(M.store(id));
    else el.innerHTML = V.staffSummary(M.staff(id));
  }

  function onChange(e) {
    const el = e.target;
    const st = S();
    if (el.dataset.bind) {
      const [kind, id, path] = el.dataset.bind.split('|');
      const obj = kind === 'store' ? M.store(id) : kind === 'staff' ? M.staff(id) : st.settings;
      if (!obj) return;
      let v = el.value;
      if (el.dataset.type === 'num') v = Math.max(0, parseInt(v, 10) || 0);
      if (el.dataset.type === 'bool') v = el.checked;
      if (kind === 'settings' && path === 'maxConsecutive') v = Math.max(2, v || 5);
      setPath(obj, path, v);
      DB.save();
      if (el.dataset.rerender) render();
      else {
        refreshSummary(kind, id);
        if (kind === 'settings') $('#brandName').textContent = st.settings.appName;
      }
      return;
    }
    if (el.dataset.closed) {
      const s = M.store(el.dataset.closed), w = +el.dataset.w;
      const set = new Set(s.closedDays || []);
      el.checked ? set.add(w) : set.delete(w);
      s.closedDays = [...set].sort();
      DB.save(); refreshSummary('store', s.id); return;
    }
    if (el.dataset.cap) {
      const p = M.staff(el.dataset.cap);
      const box = el.closest('.menu');
      if (el.value === 'all') {
        box.querySelectorAll('input[value]:not([value="all"])').forEach(i => { i.disabled = el.checked; if (el.checked) i.checked = false; });
      }
      const allOn = box.querySelector('input[value="all"]').checked;
      p.stores = allOn ? ['all'] : [...box.querySelectorAll('input:checked')].map(i => i.value);
      DB.save();
      document.querySelector(`[data-capsum="${p.id}"]`).textContent = M.capLabel(p);
      refreshSummary('staff', p.id); return;
    }
    if (el.dataset.icon) { loadIcon(el.dataset.icon, el.files[0]); return; }
    if (el.dataset.grant) {
      const p = M.staff(el.dataset.grant);
      const g = p.grants[+el.dataset.gi];
      g[el.dataset.gf] = el.dataset.gf === 'days' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
      DB.save(); render(); return;
    }
    const ch = el.dataset.change;
    if (ch === 'status') {
      DB.month(ui.ym).status = el.value; DB.save(); render();
      toast(el.value === 'final' ? '確定にしました。共有ボタンから最新版を送ってください' : '暫定に戻しました');
    } else if (ch === 'me') {
      ui.me = el.value; ui.onlyMe = ui.onlyMe && !!ui.me;
      try { localStorage.setItem('shiftboard:me', M.staff(ui.me)?.name || ''); } catch (err) { /* noop */ }
      render();
    } else if (ch === 'onlyMe') { ui.onlyMe = el.checked; render(); }
    else if (el.name === 'ceType') updateCellEditor();
    else if (el.id === 'ceStore') updateCellEditor(true);
  }

  let reqTimer;
  function onInput(e) {
    if (e.target.id === 'reqText') { clearTimeout(reqTimer); reqTimer = setTimeout(renderReqPreview, 150); }
  }

  /* ---------- アクション ---------- */
  const actions = {
    'modal-close': closeModal,
    'prev-month': () => { ui.ym = U.addMonth(ui.ym, -1); ui.day = 1; render(); },
    'next-month': () => { ui.ym = U.addMonth(ui.ym, 1); ui.day = 1; render(); },
    'prev-day': () => { ui.day--; render(); },
    'next-day': () => { ui.day++; render(); },
    'toggle-alerts': () => { ui.alertsOpen = !ui.alertsOpen; renderAlertBar(); },
    'alert-go': t => {
      const a = alerts.list[+t.dataset.i];
      if (a.type === 'streak') {
        ui.tab = 'month'; render();
        const row = document.querySelector(`tr[data-row="${a.sid}"]`);
        row?.scrollIntoView({ block: 'center' });
        row?.classList.add('flash'); setTimeout(() => row?.classList.remove('flash'), 1600);
      } else { ui.day = a.d; ui.tab = 'day'; render(); }
    },
    'req-input': openRequestModal,
    'req-apply': t => applyRequests(t.dataset.auto === '1'),
    'generate': async () => {
      const mon = S().months[ui.ym];
      const has = mon && Object.values(mon.cells).some(r => Object.values(r || {}).some(c => c && (c.t === 'w' || c.k === 'auto')));
      if (has && !await ask('現在のシフトを作り直します。\n（希望休・有給・固定したセルはそのまま残ります）\nよろしいですか？')) return;
      runScheduler(true);
    },
    'fix': () => runScheduler(false),
    'clear-month': async () => {
      if (!await ask(`${ymLabel()}のシフトを白紙に戻します（希望休・有給も消えます）。よろしいですか？`, { ok: '白紙に戻す', danger: true })) return;
      delete S().months[ui.ym]; DB.save(); render(); toast('白紙に戻しました');
    },
    'csv-export': csvExport,
    'csv-import': () => { $('#csvFile').value = ''; $('#csvFile').click(); },
    'export-pdf': () => exportImage('pdf'),
    'export-jpg': () => exportImage('jpg'),
    'share': openShare,
    'share-line': () => {
      const msg = $('#shareMsg').value;
      window.open('https://line.me/R/share?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    },
    'share-native': async () => {
      const msg = $('#shareMsg').value;
      try { await navigator.share({ title: `${ymLabel()} シフト`, text: msg }); }
      catch (e) { if (e.name !== 'AbortError') toast('共有できませんでした'); }
    },
    'share-copy': async () => {
      const msg = $('#shareMsg').value;
      try { await navigator.clipboard.writeText(msg); toast('コピーしました'); }
      catch (e) { $('#shareMsg').select(); document.execCommand('copy'); toast('コピーしました'); }
    },
    'share-image': shareImage,
    'cell-save': saveCell,
    'add-to-store': t => openPicker(t.dataset.store),
    'pick-staff': t => openCellEditor(t.dataset.sid, ui.day, { store: t.dataset.store }),

    // 設定
    'add-store': () => {
      const id = U.uid('st_');
      const used = new Set(S().stores.map(s => s.color));
      S().stores.push({
        id, name: `新しい店舗${S().stores.length + 1}`, short: '新', icon: '',
        color: ['#F5A524', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899'].find(c => !used.has(c)) || '#64748B',
        hours: { wd: { open: '10:00', close: '19:00' }, hol: { open: '10:00', close: '19:00' } },
        req: { wd: 1, hol: 1 }, allOpen: false, closedDays: [], closedOnHolidays: false, closedDates: '',
      });
      ui.openCards.add(id); DB.save(); render();
      setTimeout(() => document.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    },
    'del-store': async t => {
      const st = M.store(t.dataset.id);
      if (!await ask(`「${st.name}」を削除しますか？\nこの店舗をメインにしているスタッフは「フリー」になります。`, { ok: '削除する', danger: true })) return;
      S().stores = S().stores.filter(s => s.id !== st.id);
      S().staff.forEach(p => {
        if (p.main === st.id) p.main = 'free';
        p.stores = (p.stores || []).filter(x => x !== st.id);
        if (!p.stores.length) p.stores = ['all'];
      });
      DB.save(); render();
    },
    'add-staff': () => {
      const id = U.uid('sf_');
      S().staff.push({ id, name: '新しいスタッフ', short: '新', type: 'パート', start: '10:00', end: '18:00', stores: ['all'], main: 'free', offDays: 9, grants: [] });
      ui.openCards.add(id); DB.save(); render();
      setTimeout(() => document.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    },
    'del-staff': async t => {
      const p = M.staff(t.dataset.id);
      if (!await ask(`「${p.name}」さんを削除しますか？（過去のシフトからも表示されなくなります）`, { ok: '削除する', danger: true })) return;
      S().staff = S().staff.filter(s => s.id !== p.id);
      DB.save(); render();
    },
    'move': t => {
      const arr = S()[t.dataset.kind];
      const i = arr.findIndex(x => x.id === t.dataset.id), j = i + +t.dataset.dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      DB.save(); render();
    },
    'set-color': t => { M.store(t.dataset.id).color = t.dataset.color; DB.save(); render(); },
    'del-icon': t => { M.store(t.dataset.id).icon = ''; DB.save(); render(); },
    'toggle-leave': t => { ui.openLeave = ui.openLeave === t.dataset.id ? '' : t.dataset.id; render(); },
    'add-grant': t => {
      const p = M.staff(t.dataset.id);
      p.grants = p.grants || [];
      p.grants.push({ date: U.todayStr(), days: 10 });
      DB.save(); render();
    },
    'del-grant': async t => {
      const p = M.staff(t.dataset.id);
      if (!await ask('この付与を削除しますか？', { ok: '削除する', danger: true })) return;
      p.grants.splice(+t.dataset.gi, 1); DB.save(); render();
    },
    'backup-export': () => {
      const blob = new Blob([JSON.stringify(S(), null, 1)], { type: 'application/json' });
      download(blob, `shiftboard_backup_${U.todayStr()}.json`);
    },
    'backup-import': () => { $('#jsonFile').value = ''; $('#jsonFile').click(); },
    'load-sample': async () => {
      if (!await ask('店舗・スタッフ・シフトをすべてサンプルデータに置き換えます。よろしいですか？', { ok: '置き換える', danger: true })) return;
      DB.reset(); render(); toast('サンプルデータに戻しました');
    },
    'reset-all': async () => {
      if (!await ask('すべての月のシフト（希望休・有給を含む）を削除します。店舗・スタッフ設定は残ります。よろしいですか？', { ok: '削除する', danger: true })) return;
      S().months = {}; DB.save(); render(); toast('シフトを削除しました');
    },
  };

  /* ---------- 自動作成 ---------- */
  function runScheduler(fresh) {
    if (!S().stores.length || !S().staff.length) { toast('先に「設定」で店舗とスタッフを登録してください'); return; }
    const before = Alerts.compute(S(), ui.ym).list.length;
    busy(true, fresh ? 'シフトを自動作成しています…' : 'アラートを調整しています…');
    setTimeout(() => {
      try {
        Scheduler.run(S(), ui.ym, { fresh });
        DB.save(); render();
        const after = alerts.list.length;
        toast(fresh ? `自動作成しました（要確認 ${after}件）`
          : (after < before ? `調整しました（要確認 ${before}件 → ${after}件）` : `これ以上自動で解消できませんでした（残り ${after}件）`));
      } catch (err) { console.error(err); toast('エラーが発生しました: ' + err.message); }
      busy(false);
    }, 40);
  }

  /* ---------- 希望休入力 ---------- */
  function currentReqText() {
    const mon = S().months[ui.ym];
    if (mon?.reqText) return mon.reqText;
    if (!mon) return '';
    return S().staff.map(p => {
      const row = mon.cells[p.id] || {};
      const ds = Object.keys(row).map(Number).sort((a, b) => a - b)
        .filter(d => row[d].t === 'o' && (row[d].k === 'req' || row[d].k === 'paid'))
        .map(d => d + (row[d].k === 'paid' ? '有' : ''));
      return ds.length ? `${p.name}　${ds.join(',')}` : '';
    }).filter(Boolean).join('\n');
  }
  function openRequestModal() {
    openModal(`${modalHead(`${ymLabel()} の希望休を入力`)}
      <div class="modal-body">
        <p class="hint">LINE等で集めた希望休をそのまま貼り付けてください。<b>「名前　日付,日付…」</b>を1行に1人ずつ判別します。<br>
        「3-5」で範囲指定、「15有」のように<b>「有」</b>を付けると有給として登録します。</p>
        <textarea id="reqText" rows="8" placeholder="平賀　1,4,7,11,14\n酒井　15,23,24有\n中村　7-8">${U.esc(currentReqText())}</textarea>
        <div id="reqPreview" class="req-preview"></div>
        <label class="chk"><input type="checkbox" id="reqReplace" checked> この月の既存の希望休・有給を置き換える</label>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-act="modal-close">キャンセル</button>
        <button class="btn" data-act="req-apply" data-auto="0">反映のみ</button>
        <button class="btn primary" data-act="req-apply" data-auto="1">反映して自動作成</button>
      </div>`, 'wide');
    renderReqPreview();
    $('#reqText').focus();
  }
  function renderReqPreview() {
    const [y, m] = U.parseYM(ui.ym);
    const text = $('#reqText')?.value || '';
    reqParsed = Parser.parseRequests(text, S().staff, U.daysInMonth(y, m));
    const el = $('#reqPreview');
    if (!reqParsed.length) { el.innerHTML = '<p class="muted center">ここに判別結果が表示されます</p>'; return; }
    el.innerHTML = `<table class="ptable"><thead><tr><th>入力</th><th>スタッフ</th><th>希望休</th></tr></thead><tbody>
      ${reqParsed.map((r, i) => `<tr class="${r.staffId ? '' : 'ng'}">
        <td>${U.esc(r.name || '(名前なし)')}</td>
        <td><select data-reqrow="${i}"><option value="">該当なし（無視）</option>
          ${S().staff.map(p => `<option value="${p.id}" ${p.id === r.staffId ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></td>
        <td class="days">${r.days.map(x => `<span class="offchip ${x.paid ? 'o-paid' : 'o-req'}">${x.d}${x.paid ? '有' : ''}</span>`).join('')}
          ${r.invalid.length ? `<span class="tiny ng">範囲外: ${r.invalid.join(',')}</span>` : ''}
          ${!r.days.length ? '<span class="muted tiny">日付なし</span>' : ''}</td></tr>`).join('')}
      </tbody></table>`;
  }
  async function applyRequests(auto) {
    const text = $('#reqText').value;
    document.querySelectorAll('[data-reqrow]').forEach(sel => { reqParsed[+sel.dataset.reqrow].staffId = sel.value; });
    const rows = reqParsed.filter(r => r.staffId);
    const dup = rows.map(r => r.staffId).filter((x, i, a) => a.indexOf(x) !== i);
    if (dup.length && !await ask(`同じスタッフが複数行あります（${[...new Set(dup)].map(id => M.staff(id).name).join('、')}）。まとめて反映しますか？`)) return;
    const mon = DB.month(ui.ym);
    if ($('#reqReplace').checked) {
      for (const row of Object.values(mon.cells)) {
        for (const d of Object.keys(row)) if (row[d].t === 'o' && (row[d].k === 'req' || row[d].k === 'paid')) delete row[d];
      }
    }
    let n = 0;
    for (const r of rows) for (const x of r.days) { DB.setCell(ui.ym, r.staffId, x.d, { t: 'o', k: x.paid ? 'paid' : 'req' }); n++; }
    mon.reqText = text;
    DB.save(); closeModal();
    if (auto) runScheduler(true);
    else { render(); toast(`希望休を${n}件反映しました`); }
  }

  /* ---------- セル編集 ---------- */
  function openCellEditor(sid, d, preset = {}) {
    const p = M.staff(sid);
    if (!p) return;
    const [y, m] = U.parseYM(ui.ym);
    const c = DB.cell(ui.ym, sid, d);
    editing = { sid, d };
    const type = preset.store ? 'w' : (!c ? 'none' : c.t === 'w' ? 'w' : c.k);
    const curStore = preset.store || (c && c.t === 'w' ? c.s : (p.main !== 'free' ? p.main : S().stores[0]?.id));
    const stores = S().stores.map(st => {
      const sd = M.storeDay(st, y, m, d);
      const note = !sd ? '（定休日）' : !M.canWork(p, st.id) ? '（対応外）' : '';
      return `<option value="${st.id}" ${st.id === curStore ? 'selected' : ''}>${U.esc(st.name)}${note}</option>`;
    }).join('');
    const opt = (v, l) => `<label><input type="radio" name="ceType" value="${v}" ${type === v ? 'checked' : ''}><span>${l}</span></label>`;
    openModal(`${modalHead(`${U.esc(p.name)} <small>${m}/${d}（${U.WD[U.dow(y, m, d)]}）</small>`)}
      <div class="modal-body">
        <div class="seg-radio big">${opt('w', '出勤')}${opt('req', '休(希望)')}${opt('paid', '休(有給)')}${opt('auto', '休(自動)')}${opt('none', '未設定')}</div>
        <div id="ceWork" class="ce-work">
          <div class="f-row"><label>店舗</label><select id="ceStore">${stores}</select></div>
          <div class="f-row"><label>勤務時間</label><div><input type="time" step="900" id="ceSt" value="${c && c.t === 'w' ? U.toHM(c.st) : ''}"> 〜
            <input type="time" step="900" id="ceEn" value="${c && c.t === 'w' ? U.toHM(c.en) : ''}"></div></div>
        </div>
        <label class="chk" id="ceLockWrap"><input type="checkbox" id="ceLock" ${!c || c.lk || c.t === 'w' ? 'checked' : ''}> 固定する（自動作成・自動調整で変更しない）</label>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-act="modal-close">キャンセル</button><button class="btn primary" data-act="cell-save">保存</button></div>`);
    updateCellEditor(!(c && c.t === 'w') || !!preset.store);
  }
  function updateCellEditor(resetTimes) {
    const type = document.querySelector('[name="ceType"]:checked')?.value;
    $('#ceWork').hidden = type !== 'w';
    $('#ceLockWrap').hidden = type === 'req' || type === 'paid' || type === 'none';
    if (type === 'w' && (resetTimes || !$('#ceSt').value)) {
      const [y, m] = U.parseYM(ui.ym);
      const st = M.store($('#ceStore').value), p = M.staff(editing.sid);
      const sd = st && (M.storeDay(st, y, m, editing.d) || M.storeDay({ ...st, allOpen: true, closedDates: '' }, y, m, editing.d));
      if (sd) { const [a, b] = M.defaultTimes(p, sd); $('#ceSt').value = U.toHM(a); $('#ceEn').value = U.toHM(b); }
    }
  }
  function saveCell() {
    const type = document.querySelector('[name="ceType"]:checked')?.value;
    const lk = $('#ceLock').checked ? 1 : 0;
    let v = null;
    if (type === 'w') {
      const st = U.toMin($('#ceSt').value), en = U.toMin($('#ceEn').value);
      if (st == null || en == null || en <= st) { toast('勤務時間を正しく入力してください'); return; }
      v = { t: 'w', s: $('#ceStore').value, st, en };
      if (lk) v.lk = 1;
    } else if (type === 'req' || type === 'paid') v = { t: 'o', k: type };
    else if (type === 'auto') { v = { t: 'o', k: 'auto' }; if (lk) v.lk = 1; }
    DB.setCell(ui.ym, editing.sid, editing.d, v);
    DB.save(); closeModal(); render();
  }
  function openPicker(storeId) {
    const [y, m] = U.parseYM(ui.ym);
    const st = M.store(storeId);
    const list = S().staff.map(p => ({ p, c: DB.cell(ui.ym, p.id, ui.day) }))
      .filter(x => !(x.c && x.c.t === 'w' && x.c.s === storeId))
      .sort((a, b) => (M.canWork(b.p, storeId) - M.canWork(a.p, storeId)));
    openModal(`${modalHead(`${U.esc(st.name)} に配置（${m}/${ui.day}）`)}
      <div class="modal-body"><div class="pick-list">${list.map(({ p, c }) => {
        const now = !c ? '未設定' : c.t === 'w' ? `${M.store(c.s)?.name || ''}に出勤` : V.OFF[c.k]?.full || '休';
        return `<button class="pick" data-act="pick-staff" data-sid="${p.id}" data-store="${storeId}">
          <b>${U.esc(p.name)}</b><span class="muted">${U.esc(p.type)}・${now}</span>${M.canWork(p, storeId) ? '' : '<span class="chip warn">対応外</span>'}</button>`;
      }).join('') || '<p class="muted">配置できるスタッフがいません</p>'}</div></div>`);
  }

  /* ---------- アイコン画像 ---------- */
  function loadIcon(id, file) {
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 128, c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      M.store(id).icon = c.toDataURL('image/png');
      URL.revokeObjectURL(url);
      DB.save(); render();
    };
    img.onerror = () => toast('画像を読み込めませんでした');
    img.src = url;
  }

  /* ---------- CSV ---------- */
  function csvExport() {
    const st = S(), [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m);
    const cells = st.months[ui.ym]?.cells || {};
    const head = ['スタッフ', '雇用区分'];
    for (let d = 1; d <= N; d++) head.push(`${m}/${d}(${U.WD[U.dow(y, m, d)]})`);
    const rows = [head];
    for (const p of st.staff) {
      const r = [p.name, p.type];
      for (let d = 1; d <= N; d++) r.push(CSV.cellText(cells[p.id]?.[d], st));
      rows.push(r);
    }
    download(new Blob([CSV.stringify(rows)], { type: 'text/csv' }), `shift_${ui.ym}.csv`);
  }
  async function csvImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    let text = await file.text();
    if (text.includes('�')) { // Shift_JIS（Excel保存）対策
      try { text = new TextDecoder('shift_jis').decode(await file.arrayBuffer()); } catch (err) { /* noop */ }
    }
    const rows = CSV.parse(text);
    const hi = rows.findIndex(r => r.slice(1).some(c => /^\s*\d{1,2}\/\d{1,2}/.test(c) || /^\s*\d{1,2}\s*(\(|$)/.test(c)));
    if (hi < 0) { toast('日付の見出し行が見つかりませんでした'); return; }
    const [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m);
    const cols = {};
    rows[hi].forEach((h, j) => {
      const r = h.match(/^\s*(?:\d{1,2}\/)?(\d{1,2})/);
      if (j > 0 && r && +r[1] >= 1 && +r[1] <= N) cols[j] = +r[1];
    });
    const st = S(), unknownNames = [], bad = [];
    const parsed = [];
    for (const r of rows.slice(hi + 1)) {
      const p = Parser.matchStaff(r[0], st.staff);
      if (!p) { if (r[0]?.trim()) unknownNames.push(r[0].trim()); continue; }
      const row = {};
      for (const [j, d] of Object.entries(cols)) {
        const v = CSV.parseCell(r[j], st, p, null);
        if (v === undefined) bad.push(`${p.name} ${d}日「${r[j]}」`);
        else if (v) row[d] = v;
      }
      parsed.push([p.id, row]);
    }
    if (!parsed.length) { toast('取り込めるスタッフの行がありませんでした'); return; }
    let msg = `${ymLabel()}のシフトをCSVの内容（${parsed.length}名分）で上書きします。`;
    if (unknownNames.length) msg += `\n\n※ 未登録のため無視: ${unknownNames.join('、')}`;
    if (bad.length) msg += `\n\n※ 解釈できないセル ${bad.length}件（空欄扱い）:\n${bad.slice(0, 5).join('\n')}${bad.length > 5 ? '\n…' : ''}`;
    if (!await ask(msg + '\n\nよろしいですか？', { ok: '読み込む' })) return;
    const mon = DB.month(ui.ym);
    for (const [sid, row] of parsed) mon.cells[sid] = row;
    mon.updatedAt = Date.now();
    DB.save(); render(); toast('CSVを読み込みました');
  }
  async function backupImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj.stores || !obj.staff) throw new Error('形式が違います');
      if (!await ask('現在のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
      DB.replace(obj); render(); toast('バックアップを読み込みました');
    } catch (err) { toast('読み込めませんでした: ' + err.message); }
  }

  /* ---------- 画像・PDF ---------- */
  let logoPng = '';
  async function getLogoPng() {
    if (logoPng) return logoPng;
    const img = new Image();
    img.src = 'assets/logo.svg';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    c.getContext('2d').drawImage(img, 0, 0, 128, 128);
    return (logoPng = c.toDataURL('image/png'));
  }
  async function renderCanvas() {
    if (!window.html2canvas) throw new Error('画像化ライブラリを読み込めませんでした（オフラインの可能性）');
    const st = S(), [y, m] = U.parseYM(ui.ym);
    const isDay = ui.tab === 'day';
    const title = isDay ? `${m}月${ui.day}日（${U.WD[U.dow(y, m, ui.day)]}）のシフト` : `${y}年${m}月 シフト表`;
    const body = isDay ? V.day(st, ui, alerts, { export: true }) : V.month(st, ui, alerts, { export: true }) + V.legend(st);
    const stage = $('#exportStage');
    stage.innerHTML = `<div class="export-sheet ${isDay ? 'is-day' : 'is-month'}">
      <div class="ex-head"><img src="${await getLogoPng().catch(() => '')}" alt=""><div><div class="ex-title">${title}</div>
      <div class="ex-sub">${U.esc(st.settings.appName)} ・ <b>${statusLabel()}</b> ・ 出力 ${U.todayStr().replace(/-/g, '/')}</div></div></div>${body}</div>`;
    await document.fonts.ready;
    const el = stage.firstElementChild;
    try {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false, windowWidth: el.scrollWidth + 40 });
      return { canvas, name: isDay ? `shift_${ui.ym}-${U.pad2(ui.day)}` : `shift_${ui.ym}` };
    } finally { stage.innerHTML = ''; }
  }
  const toBlob = (canvas, type = 'image/jpeg') => new Promise(r => canvas.toBlob(r, type, 0.92));
  function buildPdf(canvas) {
    const { jsPDF } = window.jspdf;
    const land = canvas.width > canvas.height;
    const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), mg = 8;
    const aw = pw - mg * 2, ah = ph - mg * 2;
    const sc = aw / canvas.width, fullH = canvas.height * sc;
    if (fullH <= ah * 1.6) {
      const k = Math.min(1, ah / fullH);
      const w = aw * k, h = fullH * k;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, mg, w, h);
    } else {
      const slice = Math.floor(ah / sc);
      for (let y0 = 0, pg = 0; y0 < canvas.height; y0 += slice, pg++) {
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = Math.min(slice, canvas.height - y0);
        const ctx = c2.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c2.width, c2.height);
        ctx.drawImage(canvas, 0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
        if (pg) pdf.addPage();
        pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', mg, mg, aw, c2.height * sc);
      }
    }
    return pdf;
  }
  async function exportImage(kind) {
    busy(true, kind === 'pdf' ? 'PDFを作成しています…' : '画像を作成しています…');
    try {
      const { canvas, name } = await renderCanvas();
      if (kind === 'pdf') {
        if (!window.jspdf) throw new Error('PDFライブラリを読み込めませんでした');
        download(buildPdf(canvas).output('blob'), name + '.pdf');
      } else download(await toBlob(canvas), name + '.jpg');
    } catch (err) { console.error(err); toast(err.message); }
    busy(false);
  }
  async function shareImage() {
    busy(true, '画像を作成しています…');
    try {
      const { canvas, name } = await renderCanvas();
      const file = new File([await toBlob(canvas)], name + '.jpg', { type: 'image/jpeg' });
      busy(false);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `${ymLabel()} シフト` }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      download(file, file.name);
      toast('画像を保存しました（この端末は画像の直接共有に未対応です）');
    } catch (err) { console.error(err); busy(false); toast(err.message); }
  }

  /* ---------- 共有 ---------- */
  async function openShare() {
    let url;
    try {
      url = ui.mode === 'viewer' ? location.href
        : `${location.origin}${location.pathname}#v=${await Share.encode(S(), ui.ym)}`;
    } catch (e) { console.error(e); toast('共有リンクを作成できませんでした'); return; }
    const status = statusLabel();
    const [y, m] = U.parseYM(ui.ym);
    const msg = ui.mode === 'viewer'
      ? `${y}年${m}月のシフト表です。\n${url}`
      : status === '確定'
        ? `【シフト確定】\n${y}年${m}月のシフトが確定しました。\n下記リンクからご確認ください。\n${url}`
        : `【暫定シフト作成完了】\n${y}年${m}月の暫定シフトを作成しました。\n下記リンクからご確認いただき、変更のご希望があればご連絡ください。\n${url}`;
    const local = location.protocol === 'file:' || /^(localhost|127\.)/.test(location.hostname);
    openModal(`${modalHead('共有')}
      <div class="modal-body">
        ${local ? '<p class="note warn">※ 現在この端末内で開いているため、リンクは他の人のスマホでは開けません。GitHub Pages に公開したURLで操作してください。</p>' : ''}
        ${ui.mode === 'editor' ? `<p class="hint">スタッフ用の<b>閲覧専用リンク</b>（${status}版・${ymLabel()}）です。修正した場合は、もう一度共有すると最新版のリンクになります。</p>` : ''}
        <label class="lbl">送信メッセージ（編集できます）</label>
        <textarea id="shareMsg" rows="6">${U.esc(msg)}</textarea>
        <div class="share-grid">
          <button class="share-btn line" data-act="share-line"><span class="sicon-b">LINE</span>LINEで送る</button>
          ${navigator.share ? '<button class="share-btn" data-act="share-native"><span class="sicon-b">↗</span>他のアプリで共有</button>' : ''}
          <button class="share-btn" data-act="share-copy"><span class="sicon-b">⧉</span>メッセージをコピー</button>
          <button class="share-btn" data-act="share-image"><span class="sicon-b">JPG</span>画像で共有・保存</button>
          <button class="share-btn" data-act="export-pdf"><span class="sicon-b">PDF</span>PDFで保存</button>
        </div>
        <p class="tiny muted">リンクの長さ: ${url.length.toLocaleString()}文字</p>
      </div>`);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { toast };
})();
