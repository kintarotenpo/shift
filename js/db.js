'use strict';

/* ===== データ保存（作成者の端末の localStorage） ===== */
const DB = (() => {
  const KEY = 'shiftboard:v1';
  let state = null;
  let temp = false; // 閲覧モード（保存しない）

  function sample() {
    const s1 = 'st_honten', s2 = 'st_ekimae', s3 = 'st_mall';
    const staff = (name, type, start, end, stores, main, offDays, grants = []) => ({
      id: U.uid('sf_'), name, short: name.slice(0, 1), type, start, end, stores, main, offDays, grants,
    });
    return {
      version: 1,
      settings: { appName: 'SHIFT BOARD', maxConsecutive: 5 },
      stores: [
        { id: s1, name: '本店', short: '本', icon: '', color: '#F5A524',
          hours: { wd: { open: '10:00', close: '19:00' }, hol: { open: '10:00', close: '18:00' } },
          req: { wd: 1, hol: 2 }, allOpen: false, closedDays: [3], closedOnHolidays: false, closedDates: '' },
        { id: s2, name: '駅前店', short: '駅', icon: '', color: '#3B82F6',
          hours: { wd: { open: '10:00', close: '19:00' }, hol: { open: '10:00', close: '19:00' } },
          req: { wd: 1, hol: 1 }, allOpen: false, closedDays: [2], closedOnHolidays: false, closedDates: '' },
        { id: s3, name: 'モール店', short: 'モ', icon: '', color: '#10B981',
          hours: { wd: { open: '10:00', close: '20:00' }, hol: { open: '10:00', close: '20:00' } },
          req: { wd: 1, hol: 1 }, allOpen: true, closedDays: [], closedOnHolidays: false, closedDates: '' },
      ],
      staff: [
        staff('平賀', '社員', '10:00', '19:00', ['all'], s1, 9, [{ date: '2026-04-01', days: 12 }]),
        staff('酒井', '社員', '10:00', '19:00', ['all'], s2, 9, [{ date: '2026-04-01', days: 11 }]),
        staff('中村', '社員', '11:00', '20:00', ['all'], s3, 9, [{ date: '2026-04-01', days: 10 }]),
        staff('伊藤', 'パート', '10:00', '16:00', [s1, s2], s1, 10, [{ date: '2026-04-01', days: 7 }]),
        staff('佐藤', 'パート', '10:00', '18:00', [s3], s3, 12, []),
        staff('熊谷', '社員', '10:00', '19:00', ['all'], 'free', 9, [{ date: '2026-04-01', days: 14 }]),
        staff('増山', '一時雇用', '10:00', '15:00', [s2], s2, 12, []),
      ],
      months: {},
    };
  }

  function migrate(s) {
    s.settings = Object.assign({ appName: 'SHIFT BOARD', maxConsecutive: 5 }, s.settings || {});
    s.stores = (s.stores || []).map(st => Object.assign({
      short: '', icon: '', color: '#999999', allOpen: false, closedDays: [], closedOnHolidays: false, closedDates: '', aprAlert: true,
      hours: { wd: { open: '10:00', close: '19:00' }, hol: { open: '10:00', close: '19:00' } }, req: { wd: 1, hol: 1 },
    }, st));
    s.staff = (s.staff || []).map(p => Object.assign({
      short: '', type: 'パート', start: '10:00', end: '18:00', stores: ['all'], main: 'free', offDays: 9, grants: [], appraiser: false,
    }, p));
    s.months = s.months || {};
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : sample();
    } catch (e) { console.error(e); state = sample(); }
    temp = false;
    return state;
  }
  function save() {
    if (temp) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error(e); App.toast('保存できませんでした（容量不足の可能性）。アイコン画像を減らしてください'); }
  }
  function month(ym) {
    if (!state.months[ym]) state.months[ym] = { cells: {}, status: 'draft' };
    return state.months[ym];
  }
  function cell(ym, sid, d) { return state.months[ym]?.cells?.[sid]?.[d] || null; }
  function setCell(ym, sid, d, v) {
    const mon = month(ym);
    if (!mon.cells[sid]) mon.cells[sid] = {};
    if (v) mon.cells[sid][d] = v; else delete mon.cells[sid][d];
    mon.updatedAt = Date.now();
  }

  return {
    get state() { return state; },
    get isTemp() { return temp; },
    load, save, month, cell, setCell, sample, migrate,
    useTemp(s) { state = s; temp = true; },
    replace(s) { state = migrate(s); save(); },
    reset() { state = sample(); save(); },
  };
})();

/* ===== 閲覧用リンク（データを圧縮して URL に埋め込む） ===== */
const Share = (() => {
  const b64u = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64u = str => {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  };
  const pipe = async (bytes, ts) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ts)).arrayBuffer());

  async function encode(state, ym) {
    const [y, m] = U.parseYM(ym), N = U.daysInMonth(y, m);
    const mon = state.months[ym] || { cells: {}, status: 'draft' };
    const idx = new Map(state.stores.map((s, i) => [s.id, i]));
    const payload = {
      v: 1, ym, an: state.settings.appName, st: mon.status || 'draft', u: mon.updatedAt || Date.now(),
      S: state.stores.map(s => [s.name, s.short, s.color, s.hours.wd.open, s.hours.wd.close, s.hours.hol.open, s.hours.hol.close,
        +s.req.wd, +s.req.hol, s.allOpen ? 1 : 0, s.closedDays || [], s.closedOnHolidays ? 1 : 0, s.closedDates || '']),
      P: state.staff.map(p => {
        const row = [];
        for (let d = 1; d <= N; d++) {
          const c = mon.cells?.[p.id]?.[d];
          if (!c) row.push('');
          else if (c.t === 'o') row.push('O'); // 閲覧者には休みの区分を渡さない
          else row.push(`${idx.has(c.s) ? idx.get(c.s) : -1}.${c.st}.${c.en}`);
        }
        return [p.name, p.short, p.type, row.join('|')];
      }),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    try {
      return 'z' + b64u(await pipe(bytes, new CompressionStream('deflate-raw')));
    } catch (e) {
      return 'j' + b64u(bytes);
    }
  }

  async function decode(str) {
    const kind = str[0];
    let bytes = unb64u(str.slice(1));
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    const stores = p.S.map((a, i) => ({
      id: 's' + i, name: a[0], short: a[1], color: a[2], icon: '',
      hours: { wd: { open: a[3], close: a[4] }, hol: { open: a[5], close: a[6] } },
      req: { wd: a[7], hol: a[8] }, allOpen: !!a[9], closedDays: a[10], closedOnHolidays: !!a[11], closedDates: a[12],
    }));
    const cells = {};
    const staff = p.P.map((a, i) => {
      const id = 'p' + i;
      cells[id] = {};
      a[3].split('|').forEach((t, k) => {
        if (!t) return;
        if (/^[RPAO]$/.test(t)) cells[id][k + 1] = { t: 'o', k: 'off' };
        else {
          const [si, st, en] = t.split('.').map(Number);
          cells[id][k + 1] = { t: 'w', s: 's' + si, st, en };
        }
      });
      return { id, name: a[0], short: a[1], type: a[2], stores: ['all'], main: 'free', grants: [] };
    });
    return {
      _ym: p.ym, _updated: p.u,
      settings: { appName: p.an || 'SHIFT BOARD', maxConsecutive: 5 },
      stores, staff,
      months: { [p.ym]: { cells, status: p.st, updatedAt: p.u } },
    };
  }

  return { encode, decode };
})();
