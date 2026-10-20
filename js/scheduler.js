'use strict';

/* =========================================================
 * 自動シフト作成
 *  1. 希望休・有給・固定セルを確定
 *  2. 休日数の目安まで「休（自動）」を配置（人員に余裕がある日・連休にならない日・連勤を切る日を優先）
 *  3. 局所探索で「人員不足」「連勤超過」「連休」「休日数のズレ」のペナルティを最小化
 *  4. 各日をメイン店舗優先で配置し、不足店舗へ対応可能なスタッフを応援に回す
 *  5. 時間帯の穴を埋めるよう勤務時間をスライド
 * ========================================================= */
const Scheduler = (() => {
  const W = { short: 1000, hour: 60, unassigned: 200, streak: 500, pair: 40, offLess: 300, offMore: 120, surplus: 3 };
  const SLOT = 30;

  function context(state, ym) {
    const [y, m] = U.parseYM(ym), N = U.daysInMonth(y, m);
    const days = [null];
    for (let d = 1; d <= N; d++) {
      const open = state.stores.map(st => M.storeDay(st, y, m, d)).filter(Boolean);
      days.push({ open, req: open.reduce((a, o) => a + o.req, 0), map: Object.fromEntries(open.map(o => [o.id, o])) });
    }
    return {
      y, m, N, days, staff: state.staff, S: state.staff.length,
      maxC: +state.settings.maxConsecutive || 5,
      prevTail: state.staff.map(p => M.prevTail(state, ym, p.id)),
    };
  }

  const can = (ctx, i, sid) => M.canWork(ctx.staff[i], sid);

  function initPlan(ctx, cells, fresh) {
    const { S, N, staff, days } = ctx;
    const P = { work: [], fixed: [], kind: [], lock: [], keep: [] };
    for (let i = 0; i < S; i++) {
      const w = [], f = [], k = [], l = [], kp = [];
      const row = cells[staff[i].id] || {};
      for (let d = 1; d <= N; d++) {
        const c = row[d];
        const capable = days[d].open.some(o => can(ctx, i, o.id));
        w[d] = true; f[d] = false; k[d] = null; l[d] = null; kp[d] = false;
        if (c && c.t === 'o' && (c.k === 'req' || c.k === 'paid')) { w[d] = false; f[d] = true; k[d] = c.k; kp[d] = true; }
        else if (c && c.lk) {
          f[d] = true; kp[d] = true;
          if (c.t === 'w') l[d] = { s: c.s, st: c.st, en: c.en };
          else { w[d] = false; k[d] = c.k || 'auto'; }
        }
        else if (!capable) { w[d] = false; f[d] = true; k[d] = 'auto'; }
        else if (!fresh && c && c.t === 'o') { w[d] = false; k[d] = 'auto'; }
      }
      P.work.push(w); P.fixed.push(f); P.kind.push(k); P.lock.push(l); P.keep.push(kp);
    }
    return P;
  }

  /** 1日分の店舗配置。withTimes=true で勤務時間まで決める */
  function assignDay(ctx, P, d, withTimes) {
    const day = ctx.days[d];
    const res = {};
    day.open.forEach(o => { res[o.id] = []; });
    const free = [], unassigned = [];
    let working = 0;
    for (let i = 0; i < ctx.S; i++) {
      if (!P.work[i][d]) continue;
      working++;
      const lk = P.lock[i][d];
      if (lk) { if (res[lk.s]) res[lk.s].push({ i, lk }); continue; }
      const p = ctx.staff[i];
      if (p.main !== 'free' && res[p.main]) res[p.main].push({ i });
      else free.push(i);
    }
    // フリー（メイン店舗が休み含む）は対応店舗が少ない人から、不足の大きい店舗へ
    const capCount = i => day.open.filter(o => can(ctx, i, o.id)).length;
    free.sort((a, b) => capCount(a) - capCount(b));
    for (const i of free) {
      const opts = day.open.filter(o => can(ctx, i, o.id));
      if (!opts.length) { unassigned.push(i); continue; }
      opts.sort((a, b) => (b.req - res[b.id].length) - (a.req - res[a.id].length)
        || res[a.id].length / (a.req || 1) - res[b.id].length / (b.req || 1));
      res[opts[0].id].push({ i, free: true });
    }
    // 欠員（人数不足・延べ勤務時間不足）の店舗へ、余裕のある店舗から対応可能なスタッフを応援に回す
    const def = (list, o) => Math.max(0, o.req - list.length) * 10000 + hourDef(ctx, list, o);
    let moved = true, guard = 0;
    while (moved && guard++ < 60) {
      moved = false;
      for (const t of day.open) {
        const tDef = def(res[t.id], t);
        if (!tDef) continue;
        let best = null;
        for (const o of day.open) {
          if (o.id === t.id || res[o.id].length <= o.req) continue;
          const oDef = def(res[o.id], o);
          for (const e of res[o.id]) {
            if (e.lk || !can(ctx, e.i, t.id)) continue;
            const gain = tDef - def([...res[t.id], e], t);
            const loss = def(res[o.id].filter(x => x !== e), o) - oDef;
            const net = gain - loss - (e.free ? 0 : 1);
            if (net > 0 && (!best || net > best.net)) best = { o, e, net };
          }
        }
        if (best) {
          res[best.o.id].splice(res[best.o.id].indexOf(best.e), 1);
          res[t.id].push(best.e);
          moved = true;
        }
      }
    }
    let short = 0, hours = 0;
    for (const o of day.open) { short += Math.max(0, o.req - res[o.id].length); hours += hourDef(ctx, res[o.id], o); }

    if (withTimes) {
      for (const o of day.open) {
        for (const e of res[o.id]) {
          if (e.lk) { e.st = e.lk.st; e.en = e.lk.en; }
          else [e.st, e.en] = M.defaultTimes(ctx.staff[e.i], o);
        }
        optimizeTimes(res[o.id], o);
      }
    }
    return { res, short, hours, unassigned, working };
  }

  /** 延べ勤務時間の不足（分）。必要人数×営業時間に対して足りない分 */
  function hourDef(ctx, list, o) {
    const span = o.close - o.open;
    let sum = 0;
    for (const e of list) {
      if (e.lk) { sum += Math.min(e.lk.en, o.close) - Math.max(e.lk.st, o.open); continue; }
      const p = ctx.staff[e.i];
      const st = U.toMin(p.start), en = U.toMin(p.end);
      sum += Math.min(st != null && en > st ? en - st : span, span);
    }
    return Math.max(0, o.req * span - sum);
  }

  function slotShortage(entries, o) {
    let s = 0;
    for (let t = o.open; t < o.close; t += SLOT) {
      let c = 0;
      for (const e of entries) if (e.st <= t && e.en >= Math.min(t + SLOT, o.close)) c++;
      s += Math.max(0, o.req - c);
    }
    return s;
  }
  /** 時間帯の不足が減るように勤務時間（長さは維持）をスライド */
  function optimizeTimes(entries, o) {
    let cur = slotShortage(entries, o);
    for (let it = 0; it < 12 && cur > 0; it++) {
      let best = null;
      for (const e of entries) {
        if (e.lk) continue;
        const os = e.st, oe = e.en, dur = Math.min(oe - os, o.close - o.open);
        const starts = [];
        for (let s = o.open; s + dur <= o.close; s += SLOT) starts.push(s);
        starts.push(o.close - dur);
        for (const s of starts) {
          e.st = s; e.en = s + dur;
          const v = slotShortage(entries, o);
          if (v < cur && (!best || v < best.v)) best = { e, s, dur, v };
        }
        e.st = os; e.en = oe;
      }
      if (!best) break;
      best.e.st = best.s; best.e.en = best.s + best.dur; cur = best.v;
    }
  }

  function dayPen(ctx, P, d) {
    const r = assignDay(ctx, P, d, false);
    const sur = r.working - r.unassigned.length - ctx.days[d].req;
    return W.short * r.short + W.hour * (r.hours / 30) + W.unassigned * r.unassigned.length + (sur > 0 ? W.surplus * sur * sur : 0);
  }

  function staffPen(ctx, P, i) {
    const { N, maxC } = ctx;
    const w = P.work[i], f = P.fixed[i], k = P.kind[i];
    let pen = 0, run = ctx.prevTail[i], off = 0;
    for (let d = 1; d <= N; d++) {
      if (w[d]) { run++; continue; }
      if (run > maxC) pen += W.streak * (run - maxC);
      run = 0;
      if (k[d] !== 'paid') off++;
      if (d > 1 && !w[d - 1] && !(f[d] && f[d - 1])) pen += W.pair;
    }
    if (run > maxC) pen += W.streak * (run - maxC);
    const target = +ctx.staff[i].offDays;
    if (!isNaN(target)) {
      const diff = off - target;
      pen += diff < 0 ? -diff * W.offLess : diff * W.offMore;
    }
    return pen;
  }

  function greedyOffs(ctx, P) {
    const { S, N, staff, days, maxC } = ctx;
    const cnt = Array(N + 1).fill(0);
    for (let i = 0; i < S; i++) for (let d = 1; d <= N; d++) if (P.work[i][d]) cnt[d]++;
    const need = staff.map((p, i) => {
      let off = 0;
      for (let d = 1; d <= N; d++) if (!P.work[i][d] && P.kind[i][d] !== 'paid') off++;
      return Math.max(0, (+p.offDays || 0) - off);
    });
    const isOff = (i, d) => d >= 1 && d <= N && !P.work[i][d];
    const score = (i, d) => {
      const p = staff[i];
      let sc = (cnt[d] - days[d].req) * 10;
      if (p.main !== 'free' && days[d].map[p.main]) {
        let mc = 0;
        for (let j = 0; j < S; j++) if (P.work[j][d] && staff[j].main === p.main) mc++;
        sc += (mc - days[d].map[p.main].req) * 6;
      }
      if (isOff(i, d - 1)) sc -= 25;
      if (isOff(i, d + 1)) sc -= 25;
      let left = 0, k = d - 1;
      while (k >= 1 && P.work[i][k]) { left++; k--; }
      if (k === 0) left += ctx.prevTail[i];
      let right = 0; k = d + 1;
      while (k <= N && P.work[i][k]) { right++; k++; }
      if (left + 1 + right > maxC) sc += 30 + Math.min(left, right) * 4;
      let dist = 4;
      for (let t = 1; t < 4; t++) if (isOff(i, d - t) || isOff(i, d + t)) { dist = t; break; }
      sc += dist * 3;
      return sc + Math.random() * 2;
    };
    let progress = true;
    while (progress) {
      progress = false;
      const order = [...Array(S).keys()].filter(i => need[i] > 0).sort((a, b) => need[b] - need[a]);
      for (const i of order) {
        let best = -Infinity, bd = 0;
        for (let d = 1; d <= N; d++) {
          if (!P.work[i][d] || P.fixed[i][d]) continue;
          const sc = score(i, d);
          if (sc > best) { best = sc; bd = d; }
        }
        if (!bd) { need[i] = 0; continue; }
        P.work[i][bd] = false; P.kind[i][bd] = 'auto'; cnt[bd]--; need[i]--; progress = true;
      }
    }
  }

  function improve(ctx, P, timeLimit = 5000) {
    const { S, N } = ctx;
    const dp = [0];
    for (let d = 1; d <= N; d++) dp[d] = dayPen(ctx, P, d);
    const sp = [];
    for (let i = 0; i < S; i++) sp[i] = staffPen(ctx, P, i);
    const t0 = performance.now();
    const flip = (i, ds) => { for (const d of ds) { P.work[i][d] = !P.work[i][d]; P.kind[i][d] = P.work[i][d] ? null : 'auto'; } };

    for (let pass = 0; pass < 80; pass++) {
      let improved = false;
      const order = [...Array(S).keys()].sort(() => Math.random() - 0.5);
      for (const i of order) {
        const Wd = [], Od = [];
        for (let d = 1; d <= N; d++) { if (P.fixed[i][d]) continue; (P.work[i][d] ? Wd : Od).push(d); }
        let best = null;
        const tryMove = ds => {
          flip(i, ds);
          let nv = staffPen(ctx, P, i), ov = sp[i];
          const nd = {};
          for (const d of ds) { nd[d] = dayPen(ctx, P, d); nv += nd[d]; ov += dp[d]; }
          flip(i, ds);
          const delta = nv - ov;
          if (delta < -0.5 && (!best || delta < best.delta)) best = { ds, delta, nd };
        };
        for (const a of Wd) for (const b of Od) tryMove([a, b]);
        for (const a of Wd) tryMove([a]);
        for (const b of Od) tryMove([b]);
        if (best) {
          flip(i, best.ds);
          sp[i] = staffPen(ctx, P, i);
          for (const d of best.ds) dp[d] = best.nd[d];
          improved = true;
        }
      }
      if (!improved || performance.now() - t0 > timeLimit) break;
    }
  }

  /** fresh=true: 作り直し / false: 現在のシフトを起点にアラートだけ調整 */
  function run(state, ym, { fresh = true } = {}) {
    const ctx = context(state, ym);
    const mon = DB.month(ym);
    const cells = mon.cells;
    const isEmpty = !Object.values(cells).some(r => Object.values(r || {}).some(c => c && c.t === 'w'));
    const P = initPlan(ctx, cells, fresh || isEmpty);
    if (fresh || isEmpty) greedyOffs(ctx, P);
    improve(ctx, P);

    const out = {};
    const asg = ctx.staff.map(() => []);
    for (let d = 1; d <= ctx.N; d++) {
      const r = assignDay(ctx, P, d, true);
      for (const [sid, list] of Object.entries(r.res)) for (const e of list) asg[e.i][d] = { s: sid, st: e.st, en: e.en };
    }
    ctx.staff.forEach((p, i) => {
      const row = {};
      for (let d = 1; d <= ctx.N; d++) {
        if (P.keep[i][d]) { row[d] = cells[p.id][d]; continue; }
        if (P.work[i][d] && asg[i][d]) row[d] = { t: 'w', ...asg[i][d] };
        else row[d] = { t: 'o', k: 'auto' };
      }
      out[p.id] = row;
    });
    mon.cells = out;
    mon.updatedAt = Date.now();
  }

  return { run };
})();

/* ===== アラート検出 ===== */
const Alerts = {
  compute(state, ym) {
    const out = { list: [], streak: new Set(), dayShort: {}, storeShort: {} };
    const mon = state.months[ym];
    if (!mon) return out;
    const [y, m] = U.parseYM(ym), N = U.daysInMonth(y, m);
    const cells = mon.cells || {};
    const maxC = +state.settings.maxConsecutive || 5;

    for (let d = 1; d <= N; d++) {
      for (const st of state.stores) {
        const sd = M.storeDay(st, y, m, d);
        if (!sd) continue;
        const es = [];
        for (const p of state.staff) {
          const c = cells[p.id]?.[d];
          if (c && c.t === 'w' && c.s === st.id) es.push(c);
        }
        let cur = null;
        const flush = () => { if (cur) { out.list.push(cur); cur = null; } };
        for (let t = sd.open; t < sd.close; t += 30) {
          const te = Math.min(t + 30, sd.close);
          const c = es.filter(e => e.st <= t && e.en >= te).length;
          if (c < sd.req) {
            if (!cur) cur = { type: 'short', d, store: st.id, from: t, to: te, lack: sd.req - c, minLack: sd.req - c };
            else { cur.to = te; cur.lack = Math.max(cur.lack, sd.req - c); cur.minLack = Math.min(cur.minLack, sd.req - c); }
          } else flush();
        }
        flush();
        if (es.length < sd.req) out.dayShort[d] = 'ng';
        if (out.list.some(a => a.type === 'short' && a.d === d && a.store === st.id)) {
          out.storeShort[`${st.id}:${d}`] = es.length < sd.req ? 'ng' : 'warn';
          out.dayShort[d] = out.dayShort[d] || 'warn';
        }
      }
    }

    for (const p of state.staff) {
      const row = cells[p.id] || {};
      let run = M.prevTail(state, ym, p.id), start = 1 - run;
      const close = endD => {
        if (run > maxC && endD >= 1) {
          const from = Math.max(1, start);
          out.list.push({ type: 'streak', sid: p.id, from, to: endD, len: run });
          for (let k = from; k <= endD; k++) out.streak.add(`${p.id}:${k}`);
        }
      };
      for (let d = 1; d <= N; d++) {
        const c = row[d];
        if (c && c.t === 'w') {
          if (run === 0) start = d;
          run++;
          const st = M.store(c.s);
          if (!st) out.list.push({ type: 'warn', sid: p.id, d, msg: '存在しない店舗に配置されています' });
          else if (!M.storeDay(st, y, m, d)) out.list.push({ type: 'warn', sid: p.id, d, msg: `${st.name}の定休日に配置されています` });
          else if (p.stores && !M.canWork(p, st.id)) out.list.push({ type: 'warn', sid: p.id, d, msg: `対応店舗外（${st.name}）に配置されています` });
        } else { close(d - 1); run = 0; }
      }
      close(N);
    }
    const order = { short: 0, streak: 1, warn: 2 };
    out.list.sort((a, b) => (a.d || a.from) - (b.d || b.from) || order[a.type] - order[b.type]);
    return out;
  },
  label(a, state) {
    if (a.type === 'short') {
      const st = state.stores.find(s => s.id === a.store);
      const lack = a.minLack < a.lack ? `${a.minLack}〜${a.lack}` : a.lack;
      return `${a.d}日 ${st ? st.name : ''} ${U.toHM(a.from)}〜${U.toHM(a.to)} ${lack}名不足`;
    }
    const p = state.staff.find(s => s.id === a.sid);
    if (a.type === 'streak') return `${p ? p.name : ''} ${a.from}日〜${a.to}日 ${a.len}連勤`;
    return `${p ? p.name : ''} ${a.d}日 ${a.msg}`;
  },
};

/* ===== 希望休テキストの解析 ===== */
const Parser = {
  matchStaff(name, staff) {
    const k = U.normName(name);
    if (!k) return null;
    return staff.find(p => U.normName(p.name) === k)
      || staff.find(p => p.short && U.normName(p.short) === k)
      || staff.find(p => U.normName(p.name).startsWith(k) || k.startsWith(U.normName(p.name)))
      || staff.find(p => U.normName(p.name).includes(k) || k.includes(U.normName(p.name)))
      || null;
  },
  /** 例: 「平賀　1,4,7,11」「酒井 15,23-24, 28有」 */
  parseRequests(text, staff, N) {
    const lines = U.normDigits(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const idx = line.search(/\d/);
      const name = (idx < 0 ? line : line.slice(0, idx)).replace(/[\s　:：,，、・\-－(（「【\[]+$/g, '').trim();
      const rest = idx < 0 ? '' : line.slice(idx);
      const days = [], invalid = [];
      const put = (d, paid) => {
        if (d < 1 || d > N) { invalid.push(d); return; }
        const ex = days.find(x => x.d === d);
        if (ex) ex.paid = ex.paid || paid; else days.push({ d, paid });
      };
      for (const tok of rest.split(/[,，、・\s　/]+/).filter(Boolean)) {
        const paid = /有/.test(tok);
        const nums = (tok.match(/\d{1,2}/g) || []).map(Number);
        if (!nums.length) { if (paid && days.length) days[days.length - 1].paid = true; continue; }
        if (nums.length >= 2 && /[-~〜～ー－]/.test(tok)) {
          const [a, b] = nums[0] <= nums[1] ? [nums[0], nums[1]] : [nums[1], nums[0]];
          for (let d = a; d <= b; d++) put(d, paid);
        } else nums.forEach(n => put(n, paid));
      }
      days.sort((a, b) => a.d - b.d);
      const p = Parser.matchStaff(name, staff);
      return { raw: line, name, staffId: p ? p.id : '', days, invalid };
    });
  },
};

/* ===== CSV ===== */
const CSV = {
  cell(v) { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; },
  stringify(rows) { return '﻿' + rows.map(r => r.map(CSV.cell).join(',')).join('\r\n'); },
  parse(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  },
  cellText(c, state) {
    if (!c) return '';
    if (c.t === 'o') return { req: '休(希望)', paid: '休(有給)' }[c.k] || '休(自動)';
    const st = state.stores.find(s => s.id === c.s);
    return `${st ? st.name : '?'} ${U.toHM(c.st)}-${U.toHM(c.en)}`;
  },
  /** 戻り値: セル / null(空欄) / undefined(解釈不能) */
  parseCell(s, state, p, sd) {
    s = U.normDigits(s || '').trim();
    if (!s) return null;
    if (/有給|有休/.test(s)) return { t: 'o', k: 'paid' };
    if (/希望/.test(s)) return { t: 'o', k: 'req' };
    if (/^休|公休|自動/.test(s)) return { t: 'o', k: 'auto' };
    const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*[-~〜～]\s*(\d{1,2})(?::(\d{2}))?/);
    const nm = U.normName(tm ? s.replace(tm[0], '') : s);
    const st = state.stores.find(x => U.normName(x.name) === nm) || state.stores.find(x => x.short && U.normName(x.short) === nm)
      || state.stores.find(x => nm && (nm.includes(U.normName(x.name)) || U.normName(x.name).includes(nm)));
    if (!st) return undefined;
    let a, b;
    if (tm) { a = +tm[1] * 60 + (+tm[2] || 0); b = +tm[3] * 60 + (+tm[4] || 0); }
    else if (sd) [a, b] = M.defaultTimes(p, sd);
    else { a = U.toMin(p.start) ?? 600; b = U.toMin(p.end) ?? 1080; }
    return { t: 'w', s: st.id, st: a, en: b };
  },
};
