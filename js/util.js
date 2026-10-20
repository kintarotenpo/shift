'use strict';

/* ===== 汎用ユーティリティ ===== */
const U = (() => {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const pad2 = n => String(n).padStart(2, '0');
  const ymKey = (y, m) => `${y}-${pad2(m)}`;
  const parseYM = ym => ym.split('-').map(Number);
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const dateStr = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const dow = (y, m, d) => new Date(y, m - 1, d).getDay();
  const addMonth = (ym, n) => {
    const [y, m] = parseYM(ym);
    const dt = new Date(y, m - 1 + n, 1);
    return ymKey(dt.getFullYear(), dt.getMonth() + 1);
  };
  const todayYM = () => { const t = new Date(); return ymKey(t.getFullYear(), t.getMonth() + 1); };
  const todayStr = () => { const t = new Date(); return dateStr(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const toMin = s => {
    if (s == null || s === '') return null;
    if (typeof s === 'number') return s;
    const [h, mm] = String(s).split(':').map(Number);
    return isNaN(h) ? null : h * 60 + (mm || 0);
  };
  const toHM = n => `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`;
  const shortHM = n => { const h = Math.floor(n / 60), m = n % 60; return m ? `${h}:${pad2(m)}` : `${h}`; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const normDigits = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const normName = s => String(s || '').replace(/[\s　]/g, '');

  function rgb(hex) {
    let h = String(hex || '#999999').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    h = h.padEnd(6, '0');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
  }
  function contrastText(hex) {
    const [r, g, b] = rgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#ffffff';
  }
  /** 白と混ぜた淡い色（html2canvas 対応のため color-mix は使わない） */
  function tint(hex, a = 0.16) {
    const [r, g, b] = rgb(hex);
    const f = v => Math.round(255 - (255 - v) * a);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  /* ---- 日本の祝日（振替休日・国民の休日を含む） ---- */
  const holCache = {};
  const nthMon = (y, m, n) => { const f = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - f) % 7) + (n - 1) * 7; };
  const keyOf = dt => dateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  function holidays(y) {
    if (holCache[y]) return holCache[y];
    const h = {};
    const add = (m, d, n) => { h[dateStr(y, m, d)] = n; };
    const k = y - 1980;
    add(1, 1, '元日'); add(1, nthMon(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日');
    add(3, Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4)), '春分の日');
    add(4, 29, '昭和の日'); add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
    add(7, nthMon(y, 7, 3), '海の日'); add(8, 11, '山の日'); add(9, nthMon(y, 9, 3), '敬老の日');
    add(9, Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4)), '秋分の日');
    add(10, nthMon(y, 10, 2), 'スポーツの日'); add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
    for (const s of Object.keys(h)) {
      const [yy, mm, dd] = s.split('-').map(Number);
      const dt = new Date(yy, mm - 1, dd);
      if (dt.getDay() !== 0) continue;
      do { dt.setDate(dt.getDate() + 1); } while (h[keyOf(dt)]);
      h[keyOf(dt)] = '振替休日';
    }
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const dt = new Date(y, m - 1, d);
        if (h[keyOf(dt)] || dt.getDay() === 0) continue;
        if (h[keyOf(new Date(y, m - 1, d - 1))] && h[keyOf(new Date(y, m - 1, d + 1))]) h[keyOf(dt)] = '国民の休日';
      }
    }
    return (holCache[y] = h);
  }
  const holidayName = (y, m, d) => holidays(y)[dateStr(y, m, d)] || '';

  return {
    WD, pad2, ymKey, parseYM, daysInMonth, dateStr, dow, addMonth, todayYM, todayStr,
    toMin, toHM, shortHM, esc, uid, normDigits, normName, contrastText, tint, holidayName,
  };
})();

/* ===== ドメインモデル補助 ===== */
const M = {
  store(id) { return DB.state.stores.find(s => s.id === id); },
  staff(id) { return DB.state.staff.find(s => s.id === id); },
  holLike(y, m, d) { return U.dow(y, m, d) === 0 || !!U.holidayName(y, m, d); },

  /** 臨時休業日の文字列（例: "12/31, 2026-08-15"）に該当するか */
  inDateList(list, y, m, d) {
    const toks = U.normDigits(list || '').split(/[,、\s]+/).filter(Boolean);
    return toks.some(t => {
      let r = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (r) return +r[1] === y && +r[2] === m && +r[3] === d;
      r = t.match(/^(\d{1,2})[-/.](\d{1,2})$/);
      return !!r && +r[1] === m && +r[2] === d;
    });
  },
  closed(st, y, m, d) {
    if (M.inDateList(st.closedDates, y, m, d)) return true;
    if (st.allOpen) return false;
    if ((st.closedDays || []).includes(U.dow(y, m, d))) return true;
    return !!(st.closedOnHolidays && U.holidayName(y, m, d));
  },
  /** その日の営業情報 {id, open, close, req}。定休日なら null */
  storeDay(st, y, m, d) {
    if (M.closed(st, y, m, d)) return null;
    const hol = M.holLike(y, m, d);
    const h = (hol ? st.hours.hol : st.hours.wd) || st.hours.wd;
    const open = U.toMin(h.open), close = U.toMin(h.close);
    if (open == null || close == null || close <= open) return null;
    return { id: st.id, open, close, req: Math.max(0, +(hol ? st.req.hol : st.req.wd) || 0) };
  },
  canWork(p, sid) {
    const a = p.stores || [];
    return a.includes('all') || a.includes(sid) || p.main === sid;
  },
  /** 基本勤務時間を店舗の営業時間内に収めた勤務時間 */
  defaultTimes(p, sd) {
    let st = U.toMin(p.start), en = U.toMin(p.end);
    if (st == null || en == null || en <= st) return [sd.open, sd.close];
    const dur = en - st;
    st = Math.max(st, sd.open); en = Math.min(en, sd.close);
    if (en - st < 60) { st = sd.open; en = Math.min(sd.close, sd.open + dur); }
    return [st, en];
  },
  /** 前月末からの連続勤務日数 */
  prevTail(state, ym, sid) {
    const pym = U.addMonth(ym, -1);
    const pm = state.months[pym];
    if (!pm || !pm.cells || !pm.cells[sid]) return 0;
    const [y, m] = U.parseYM(pym);
    let n = 0;
    for (let d = U.daysInMonth(y, m); d >= 1; d--) {
      if (pm.cells[sid][d] && pm.cells[sid][d].t === 'w') n++; else break;
    }
    return n;
  },
  mainLabel(p) { return p.main === 'free' ? 'フリー' : (M.store(p.main)?.name || '未設定'); },
  capLabel(p) {
    const a = p.stores || [];
    if (a.includes('all')) return '全店舗';
    const names = a.map(id => M.store(id)?.name).filter(Boolean);
    return names.length ? names.join('・') : '未選択';
  },

  /** 有給の集計（2年で失効・古い付与分から消化） */
  leave(state, p, today = U.todayStr()) {
    const usage = [];
    for (const [ym, mon] of Object.entries(state.months || {})) {
      const row = mon.cells?.[p.id]; if (!row) continue;
      const [y, m] = U.parseYM(ym);
      for (const [d, c] of Object.entries(row)) if (c && c.t === 'o' && c.k === 'paid') usage.push(U.dateStr(y, m, +d));
    }
    usage.sort();
    const addYears = (s, n) => { const [y, m, d] = s.split('-').map(Number); return U.dateStr(y + n, m, d); };
    const grants = (p.grants || []).filter(g => g.date && +g.days > 0)
      .map(g => ({ date: g.date, days: +g.days, exp: addYears(g.date, 2), rem: +g.days }))
      .sort((a, b) => a.date.localeCompare(b.date));
    let overflow = 0;
    for (const u of usage) {
      const g = grants.find(g => g.date <= u && u < g.exp && g.rem > 0);
      if (g) g.rem--; else overflow++;
    }
    const valid = grants.filter(g => g.date <= today && today < g.exp);
    const granted = valid.reduce((a, g) => a + g.days, 0);
    const remaining = valid.reduce((a, g) => a + g.rem, 0);
    const taken = usage.filter(u => u <= today).length;
    const planned = usage.filter(u => u > today).length;
    const nextExp = valid.filter(g => g.rem > 0).sort((a, b) => a.exp.localeCompare(b.exp))[0] || null;
    // 年5日の取得義務（直近の10日以上付与から1年以内）
    const big = valid.filter(g => g.days >= 10).sort((a, b) => b.date.localeCompare(a.date))[0];
    let duty = null;
    if (big) {
      const end = addYears(big.date, 1);
      duty = { used: usage.filter(u => u >= big.date && u < end).length, end };
    }
    return { usage, grants, granted, remaining, taken, planned, overflow, nextExp, duty };
  },
};
