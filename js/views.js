'use strict';

/* ===== 画面描画 ===== */
const V = (() => {
  const { WD, esc } = U;
  const OFF = {
    req: { s: '希望', c: 'o-req', full: '休(希望)' },
    paid: { s: '有給', c: 'o-paid', full: '休(有給)' },
    auto: { s: '自動', c: 'o-auto', full: '休(自動)' },
  };
  // 閲覧者には休みの区分を見せない（すべてグレーの「休」）
  const OFF_VIEW = { s: '', c: 'o-view', full: '休' };
  const offOf = (c, ui) => (ui && ui.mode === 'viewer' ? OFF_VIEW : (OFF[c.k] || OFF.auto));
  const TYPES = ['社員', 'パート', '一時雇用'];
  const PRESETS = ['#F5A524', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#64748B'];

  const dayCls = (y, m, d) => {
    const w = U.dow(y, m, d);
    return (U.holidayName(y, m, d) || w === 0) ? 'sun' : (w === 6 ? 'sat' : '');
  };
  const isToday = (y, m, d) => U.dateStr(y, m, d) === U.todayStr();

  function sbadge(st) {
    if (!st) return '<span class="sb" style="background:#ccc;color:#111">?</span>';
    return `<span class="sb" style="background:${st.color};color:${U.contrastText(st.color)}">${esc(st.short || st.name.slice(0, 1))}</span>`;
  }
  function sicon(st, size = 'md') {
    if (st.icon) return `<img class="sicon ${size}" src="${st.icon}" alt="">`;
    return `<span class="sicon ${size} ph" style="background:${st.color};color:${U.contrastText(st.color)}">${esc((st.short || st.name).slice(0, 2))}</span>`;
  }

  function legend(state, ui) {
    if (ui && ui.mode === 'viewer') {
      return `<div class="legend">
        ${state.stores.map(s => `<span class="lg">${sbadge(s)}${esc(s.name)}</span>`).join('')}
        <span class="lg"><span class="offchip o-view">休</span>休み</span></div>`;
    }
    return `<div class="legend">
      ${state.stores.map(s => `<span class="lg">${sbadge(s)}${esc(s.name)}</span>`).join('')}
      <span class="lg"><span class="offchip o-req">休</span>希望休</span>
      <span class="lg"><span class="offchip o-paid">休</span>有給</span>
      <span class="lg"><span class="offchip o-auto">休</span>自動休</span>
      <span class="lg"><span class="streak-chip"></span>連勤超過</span>
      <span class="lg"><span class="apr">査</span>査定員</span>
    </div>`;
  }

  /* ---------- 月次 ---------- */
  function cellHTML(state, p, d, c, flags) {
    const a = `data-sid="${p.id}" data-d="${d}"`;
    let cls = 'c';
    if (flags.streak) cls += ' streak';
    if (flags.today) cls += ' today';
    if (flags.me) cls += ' me';
    if (c && c.lk) cls += ' lk';
    if (!c) return `<td class="${cls} e" ${a}><span class="dash">・</span></td>`;
    if (c.t === 'o') {
      const o = offOf(c, flags.ui);
      return `<td class="${cls} o ${o.c}" ${a}><span class="ol">休</span>${o.s ? `<span class="os">${o.s}</span>` : ''}</td>`;
    }
    const st = state.stores.find(s => s.id === c.s);
    const bg = st ? U.tint(st.color, 0.14) : '#fff';
    return `<td class="${cls} w" ${a} style="background:${bg}">${sbadge(st)}<span class="tm">${U.shortHM(c.st)}-${U.shortHM(c.en)}</span></td>`;
  }

  function month(state, ui, alerts, opts = {}) {
    const [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m);
    const cells = state.months[ui.ym]?.cells || {};
    let staff = state.staff;
    if (ui.onlyMe && ui.me) staff = staff.filter(p => p.id === ui.me);
    if (!state.staff.length) return `<div class="empty">スタッフが登録されていません。「設定」から追加してください。</div>`;
    const editor = ui.mode === 'editor';
    const stores = editor ? state.stores : [];
    const meCls = p => (ui.me === p.id && !opts.export ? ' me' : '');

    // 見出し（スタッフが列）
    let h = `<div class="table-wrap${opts.export ? ' export' : ''}"><table class="mtable"><thead><tr><th class="date-col corner">日付</th>`;
    for (const p of staff) {
      h += `<th class="staff-h${meCls(p)}" data-col="${p.id}"><div class="nm">${esc(p.name)}${editor && p.appraiser ? '<span class="apr">査</span>' : ''}</div>
        <div class="sub">${esc(p.type)}${editor ? '・' + esc(M.mainLabel(p)) : ''}</div></th>`;
    }
    stores.forEach((st, i) => {
      h += `<th class="store-h${i === 0 ? ' first' : ''}">${sbadge(st)}<div class="sub">${esc(st.name)}</div></th>`;
    });
    h += `</tr></thead><tbody>`;

    // 本文（日付が行）
    const sums = staff.map(() => ({ work: 0, off: 0, paid: 0 }));
    for (let d = 1; d <= N; d++) {
      const hn = U.holidayName(y, m, d);
      const today = isToday(y, m, d);
      const dot = !opts.export && editor && alerts.dayShort[d] ? `<i class="dot ${alerts.dayShort[d]}"></i>` : '';
      h += `<tr class="${dayCls(y, m, d)}${today ? ' today' : ''}"><th class="date-col dh ${dayCls(y, m, d)}" title="${esc(hn)}" data-goday="${opts.export ? '' : d}">
        <span class="dn">${d}</span><span class="dw">${WD[U.dow(y, m, d)]}</span>${today && !opts.export ? '<span class="today-tag">今日</span>' : ''}${hn ? `<span class="hn">${esc(hn)}</span>` : ''}${dot}</th>`;
      staff.forEach((p, i) => {
        const c = cells[p.id]?.[d] || null;
        if (c && c.t === 'w') sums[i].work++;
        else if (c && c.k === 'paid') sums[i].paid++;
        else if (c) sums[i].off++;
        h += cellHTML(state, p, d, c, { streak: alerts.streak.has(`${p.id}:${d}`), today, me: !!meCls(p), ui });
      });
      stores.forEach((st, i) => {
        const first = i === 0 ? ' first' : '';
        const sd = M.storeDay(st, y, m, d);
        if (!sd) { h += `<td class="cnt closed${first}">定休</td>`; return; }
        let n = 0;
        for (const p of state.staff) { const c = cells[p.id]?.[d]; if (c && c.t === 'w' && c.s === st.id) n++; }
        const s = alerts.storeShort[`${st.id}:${d}`];
        const cls = n < sd.req ? 'ng' : (s ? 'warn' : 'ok');
        h += `<td class="cnt ${cls}${first}" data-goday="${opts.export ? '' : d}">${n}<small>/${sd.req}</small></td>`;
      });
      h += `</tr>`;
    }

    // 集計（行）
    h += `</tbody><tfoot>`;
    const rows = [['出勤', 'work'], ['休', 'off'], ['有給', 'paid']];
    rows.forEach(([label, key], ri) => {
      h += `<tr class="${ri === 0 ? 'first' : ''}"><th class="date-col sum-h">${label}</th>`;
      staff.forEach((p, i) => {
        const v = sums[i][key];
        const target = +p.offDays;
        const diff = key === 'off' && editor && !isNaN(target) && v !== target;
        h += `<td class="sum${diff ? ' diff' : ''}${meCls(p)}" ${key === 'off' && editor ? `title="目安 ${target}日"` : ''}>${v}</td>`;
      });
      if (stores.length) h += `<td colspan="${stores.length}" class="first"></td>`;
      h += `</tr>`;
    });
    h += `</tfoot></table></div>`;
    if (!opts.export) h += legend(state, ui);
    return h;
  }

  function myShift(state, ui) {
    const p = state.staff.find(s => s.id === ui.me);
    if (!p) return '';
    const [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m);
    const row = state.months[ui.ym]?.cells?.[p.id] || {};
    let h = `<details class="panel myshift" open><summary><h2>${esc(p.name)}さんのシフト</h2><span class="muted">タップで開閉</span></summary><div class="my-grid">`;
    for (let d = 1; d <= N; d++) {
      const c = row[d];
      let body;
      if (!c) body = '<span class="muted">—</span>';
      else if (c.t === 'o') { const o = offOf(c, ui); body = `<span class="offchip ${o.c}">休</span>${o.s ? `<span class="my-sub">${o.s}</span>` : ''}`; }
      else {
        const st = state.stores.find(s => s.id === c.s);
        body = `${sbadge(st)}<span class="my-st">${esc(st ? st.name : '')}</span><span class="my-tm">${U.toHM(c.st)}-${U.toHM(c.en)}</span>`;
      }
      h += `<div class="my-day ${c && c.t === 'w' ? 'w' : 'o'}${isToday(y, m, d) ? ' today' : ''}" data-goday="${d}">
        <span class="my-date ${dayCls(y, m, d)}">${m}/${d}<small>(${WD[U.dow(y, m, d)]})</small></span>${body}</div>`;
    }
    return h + '</div></details>';
  }

  /* ---------- 日別（スマホ用：縦タイムライン） ---------- */
  function verticalTimeline({ st, sd, list, d, minT, hours, pct, wid }) {
    let ticks = '';
    for (let k = 0; k <= hours; k++) ticks += `<span class="vt-tick" style="top:${pct(minT + k * 60)}">${minT / 60 + k}:00</span>`;
    const zone = sd ? `<div class="vt-zone" style="top:${pct(sd.open)};height:${wid(sd.open, sd.close)}"></div>` : '';
    let head = '<div class="vt-axis-h"></div>', cols = '';
    if (!list.length) {
      head += '<div class="vt-name muted">未配置</div>';
      cols += `<div class="vt-col">${zone}</div>`;
    }
    for (const { p, c } of list) {
      head += `<div class="vt-name"><span class="nm">${esc(p.name)}</span><span class="ty">${esc(p.type)}</span></div>`;
      cols += `<div class="vt-col">${zone}<div class="vbar${c.lk ? ' lk' : ''}" data-sid="${p.id}" data-d="${d}"
        style="top:${pct(c.st)};height:${wid(c.st, c.en)};background:${st.color};color:${U.contrastText(st.color)}">
        <span>${U.toHM(c.st)}</span><span>${U.toHM(c.en)}</span></div></div>`;
    }
    if (sd) {
      head += '<div class="vt-name vt-cov-h">人数</div>';
      let slots = '';
      for (let t = sd.open; t < sd.close; t += 30) {
        const te = Math.min(t + 30, sd.close);
        const n = list.filter(x => x.c.st <= t && x.c.en >= te).length;
        slots += `<div class="vslot ${n < sd.req ? 'ng' : 'ok'}" style="top:${pct(t)};height:${wid(t, te)}">${n}</div>`;
      }
      cols += `<div class="vt-col vt-cov">${slots}</div>`;
    }
    return `<div class="vt-scroll"><div class="vt" style="--hours:${hours}">
      <div class="vt-head">${head}</div>
      <div class="vt-body"><div class="vt-axis">${ticks}</div>${cols}</div></div></div>`;
  }

  /* ---------- 日別 ---------- */
  function day(state, ui, alerts, opts = {}) {
    const [y, m] = U.parseYM(ui.ym), N = U.daysInMonth(y, m), d = ui.day;
    const w = U.dow(y, m, d), hn = U.holidayName(y, m, d);
    const cells = state.months[ui.ym]?.cells || {};
    const sds = state.stores.map(st => ({ st, sd: M.storeDay(st, y, m, d) }));
    let minT = Infinity, maxT = -Infinity;
    sds.forEach(({ sd }) => { if (sd) { minT = Math.min(minT, sd.open); maxT = Math.max(maxT, sd.close); } });
    state.staff.forEach(p => { const c = cells[p.id]?.[d]; if (c && c.t === 'w') { minT = Math.min(minT, c.st); maxT = Math.max(maxT, c.en); } });
    if (!isFinite(minT)) { minT = 540; maxT = 1260; }
    minT = Math.floor(minT / 60) * 60; maxT = Math.ceil(maxT / 60) * 60;
    if (maxT - minT < 240) maxT = minT + 240;
    const span = maxT - minT;
    const pct = t => ((t - minT) / span * 100).toFixed(3) + '%';
    const wid = (a, b) => ((b - a) / span * 100).toFixed(3) + '%';
    const hours = span / 60;

    let h = '';
    if (!opts.export) {
      h += '<div class="day-strip">';
      for (let k = 1; k <= N; k++) {
        const a = alerts.dayShort[k];
        h += `<button class="ds ${dayCls(y, m, k)}${k === d ? ' active' : ''}${isToday(y, m, k) ? ' today' : ''}" data-goday="${k}">
          <span class="ds-w">${WD[U.dow(y, m, k)]}</span><span class="ds-d">${k}</span>${a && ui.mode === 'editor' ? `<i class="dot ${a}"></i>` : ''}</button>`;
      }
      h += '</div>';
    }
    h += `<div class="day-head">${opts.export ? '' : `<button class="icon-btn light" data-act="prev-day" ${d <= 1 ? 'disabled' : ''}>‹</button>`}
      <h2>${m}月${d}日<span class="dw ${dayCls(y, m, d)}">（${WD[w]}）</span>${hn ? `<span class="hol">${esc(hn)}</span>` : ''}</h2>
      ${opts.export ? '' : `<button class="icon-btn light" data-act="next-day" ${d >= N ? 'disabled' : ''}>›</button>`}</div>`;

    const vertical = !opts.export && window.matchMedia('(max-width: 760px)').matches;
    const scale = () => {
      let t = '';
      for (let k = 0; k <= hours; k++) t += `<span class="tick" style="left:${pct(minT + k * 60)}">${(minT / 60) + k}</span>`;
      return t;
    };

    h += '<div class="store-list">';
    for (const { st, sd } of sds) {
      const list = state.staff.map(p => ({ p, c: cells[p.id]?.[d] }))
        .filter(x => x.c && x.c.t === 'w' && x.c.s === st.id)
        .sort((a, b) => a.c.st - b.c.st || a.c.en - b.c.en);
      const shorts = alerts.list.filter(a => a.type === 'short' && a.d === d && a.store === st.id);
      const noApr = ui.mode === 'editor' && alerts.list.some(a => a.type === 'appraiser' && a.d === d && a.store === st.id);
      let chip = noApr ? '<span class="chip ng">査定員なし</span> ' : '';
      if (!sd) chip = '<span class="chip gray">定休日</span>';
      else if (shorts.length) chip += `<span class="chip ng">不足 ${shorts.map(a => `${U.shortHM(a.from)}-${U.shortHM(a.to)}`).join(' / ')}</span>`;
      else if (!noApr) chip = '<span class="chip ok">充足</span>';

      h += `<section class="store-card" style="--sc:${st.color}">
        <header class="sc-head">${sicon(st)}<div class="sc-title"><h3>${esc(st.name)}</h3>
        <div class="sc-meta">${sd ? `${U.toHM(sd.open)}〜${U.toHM(sd.close)}・必要 ${sd.req}名・配置 ${list.length}名` : '本日は定休日です'}</div></div>${chip}</header>`;
      if ((sd || list.length) && vertical) {
        h += verticalTimeline({ st, sd, list, d, minT, hours, pct, wid });
      } else if (sd || list.length) {
        h += `<div class="tl-scroll"><div class="tl" style="--hours:${hours}">
          <div class="tl-row scale"><div class="tl-label"></div><div class="tl-track">${scale()}</div></div>`;
        if (!list.length) h += `<div class="tl-row"><div class="tl-label muted">未配置</div><div class="tl-track"></div></div>`;
        for (const { p, c } of list) {
          h += `<div class="tl-row"><div class="tl-label"><span class="nm">${esc(p.name)}</span><span class="ty">${esc(p.type)}</span></div>
            <div class="tl-track">${sd ? `<div class="zone" style="left:${pct(sd.open)};width:${wid(sd.open, sd.close)}"></div>` : ''}
            <div class="bar${c.lk ? ' lk' : ''}" data-sid="${p.id}" data-d="${d}" style="left:${pct(c.st)};width:${wid(c.st, c.en)};background:${st.color};color:${U.contrastText(st.color)}">
            <span>${U.toHM(c.st)}–${U.toHM(c.en)}</span></div></div></div>`;
        }
        if (sd) {
          let slots = '';
          for (let t = sd.open; t < sd.close; t += 30) {
            const te = Math.min(t + 30, sd.close);
            const n = list.filter(x => x.c.st <= t && x.c.en >= te).length;
            slots += `<div class="slot ${n < sd.req ? 'ng' : 'ok'}" style="left:${pct(t)};width:${wid(t, te)}" title="${U.toHM(t)} ${n}/${sd.req}名">${n}</div>`;
          }
          h += `<div class="tl-row cov"><div class="tl-label">人数</div><div class="tl-track">${slots}</div></div>`;
        }
        h += '</div></div>';
      }
      if (!opts.export && ui.mode === 'editor' && sd) {
        h += `<div class="sc-foot"><button class="btn sm ghost" data-act="add-to-store" data-store="${st.id}">＋ スタッフを配置</button></div>`;
      }
      h += '</section>';
    }
    h += '</div>';

    const offs = state.staff.map(p => ({ p, c: cells[p.id]?.[d] })).filter(x => !x.c || x.c.t === 'o');
    if (offs.length) {
      h += `<section class="panel off-panel"><h3>休み・未設定</h3><div class="off-list">${offs.map(({ p, c }) => {
        const o = c ? offOf(c, ui) : null;
        return `<span class="off-item${ui.mode === 'editor' && !opts.export ? ' clickable' : ''}" data-sid="${p.id}" data-d="${d}">${esc(p.name)}
          ${o ? `<span class="offchip ${o.c}">${o.s || '休'}</span>` : '<span class="offchip">未設定</span>'}</span>`;
      }).join('')}</div></section>`;
    }
    return h;
  }

  /* ---------- 有給 ---------- */
  function leave(state, ui) {
    const today = U.todayStr();
    let h = `<section class="panel"><div class="panel-head"><div><h2>有給管理</h2>
      <p class="muted">基準日 ${today.replace(/-/g, '/')} ／ 付与から2年で失効・古い付与分から消化して計算します。シフト上の「休(有給)」が自動で取得日としてカウントされます。</p></div></div>
      <div class="table-scroll"><table class="ltable"><thead><tr>
      <th>スタッフ</th><th>区分</th><th>有効付与</th><th>取得済</th><th>予定</th><th>残日数</th><th>次の失効</th><th>年5日取得</th><th></th></tr></thead><tbody>`;
    for (const p of state.staff) {
      const L = M.leave(state, p, today);
      const open = ui.openLeave === p.id;
      const duty = L.duty ? `<span class="chip ${L.duty.used >= 5 ? 'ok' : 'warn'}">${L.duty.used}/5日</span><div class="tiny muted">期限 ${L.duty.end.replace(/-/g, '/')}</div>` : '<span class="muted">—</span>';
      h += `<tr class="${open ? 'open' : ''}">
        <td><b>${esc(p.name)}</b></td><td>${esc(p.type)}</td>
        <td>${L.granted}日</td><td>${L.taken}日</td><td>${L.planned}日</td>
        <td><span class="big ${L.remaining <= 0 ? 'ng' : ''}">${L.remaining}</span>日${L.overflow ? `<div class="tiny ng">付与外の取得 ${L.overflow}日</div>` : ''}</td>
        <td>${L.nextExp ? `${L.nextExp.exp.replace(/-/g, '/')}<div class="tiny muted">${L.nextExp.rem}日分</div>` : '<span class="muted">—</span>'}</td>
        <td>${duty}</td>
        <td><button class="btn sm ghost" data-act="toggle-leave" data-id="${p.id}">${open ? '閉じる' : '詳細・付与'}</button></td></tr>`;
      if (open) {
        h += `<tr class="detail"><td colspan="9"><div class="leave-detail">
          <div><h4>付与履歴</h4>
            ${(p.grants || []).map((g, gi) => `<div class="grant-row">
              <input type="date" value="${esc(g.date)}" data-grant="${p.id}" data-gi="${gi}" data-gf="date">
              <input type="number" min="0" max="40" value="${esc(g.days)}" data-grant="${p.id}" data-gi="${gi}" data-gf="days" class="w-num"> 日
              <button class="btn sm ghost" data-act="del-grant" data-id="${p.id}" data-gi="${gi}">削除</button></div>`).join('') || '<p class="muted">付与が登録されていません</p>'}
            <button class="btn sm" data-act="add-grant" data-id="${p.id}">＋ 付与を追加</button></div>
          <div><h4>取得日（シフトの「休(有給)」）</h4>
            <div class="usage">${L.usage.length ? L.usage.map(u => `<span class="offchip o-paid ${u > today ? 'plan' : ''}">${u.slice(5).replace('-', '/')}</span>`).join('') : '<span class="muted">なし</span>'}</div></div>
        </div></td></tr>`;
      }
    }
    h += `</tbody></table></div></section>`;
    return h;
  }

  /* ---------- 設定 ---------- */
  function storeSummary(st) {
    const wd = `${st.hours.wd.open}〜${st.hours.wd.close}`;
    const closed = st.allOpen ? '年中無休' : ((st.closedDays || []).length || st.closedOnHolidays
      ? '定休 ' + [...(st.closedDays || []).map(i => WD[i]), st.closedOnHolidays ? '祝' : ''].filter(Boolean).join('・') : '定休日なし');
    return `${sicon(st)}<div class="sum-main"><b>${esc(st.name)}</b><span class="muted">略称「${esc(st.short)}」・${wd}・${closed}・必要 ${st.req.wd}/${st.req.hol}名</span></div><span class="chev">⌄</span>`;
  }
  function staffSummary(p) {
    return `<span class="avatar">${esc((p.short || p.name).slice(0, 1))}</span><div class="sum-main"><b>${esc(p.name)}${p.appraiser ? ' <span class="apr">査定員</span>' : ''}</b>
      <span class="muted">${esc(p.type)}・${esc(p.start)}〜${esc(p.end)}・メイン ${esc(M.mainLabel(p))}・対応 ${esc(M.capLabel(p))}</span></div><span class="chev">⌄</span>`;
  }

  function storeCard(st, i, n, ui) {
    const b = (f, extra = '') => `data-bind="store|${st.id}|${f}" ${extra}`;
    return `<details class="card" data-card="${st.id}" ${ui.openCards.has(st.id) ? 'open' : ''}>
      <summary data-sum="store|${st.id}">${storeSummary(st)}</summary>
      <div class="form">
        <div class="f-row"><label>店舗名</label><input type="text" ${b('name')} value="${esc(st.name)}"></div>
        <div class="f-row"><label>店舗の略称</label><div><input type="text" maxlength="3" class="w-s" ${b('short')} value="${esc(st.short)}"><span class="hint">月次表のセルに表示（1文字推奨）</span></div></div>
        <div class="f-row"><label>アイコン</label><div class="icon-edit">${sicon(st, 'lg')}
          <label class="btn sm">画像を選択<input type="file" accept="image/*" data-icon="${st.id}" hidden></label>
          ${st.icon ? `<button class="btn sm ghost" data-act="del-icon" data-id="${st.id}">削除</button>` : ''}</div></div>
        <div class="f-row"><label>表示カラー</label><div class="color-edit"><input type="color" ${b('color')} value="${esc(st.color)}">
          ${PRESETS.map(c => `<button class="swatch${c.toLowerCase() === String(st.color).toLowerCase() ? ' on' : ''}" style="background:${c}" data-act="set-color" data-id="${st.id}" data-color="${c}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="f-row"><label>営業時間</label><div class="pairs">
          <div><span class="tag">平日・土</span><input type="time" step="900" ${b('hours.wd.open')} value="${esc(st.hours.wd.open)}"> 〜 <input type="time" step="900" ${b('hours.wd.close')} value="${esc(st.hours.wd.close)}"></div>
          <div><span class="tag sun">日・祝</span><input type="time" step="900" ${b('hours.hol.open')} value="${esc(st.hours.hol.open)}"> 〜 <input type="time" step="900" ${b('hours.hol.close')} value="${esc(st.hours.hol.close)}"></div></div></div>
        <div class="f-row"><label>必要人員数</label><div class="pairs">
          <div><span class="tag">平日・土</span><input type="number" min="0" max="30" class="w-num" ${b('req.wd', 'data-type="num"')} value="${esc(st.req.wd)}"> 名</div>
          <div><span class="tag sun">日・祝</span><input type="number" min="0" max="30" class="w-num" ${b('req.hol', 'data-type="num"')} value="${esc(st.req.hol)}"> 名</div>
          <span class="hint">営業時間中、常にこの人数がいる状態を目標にします</span></div></div>
        <div class="f-row"><label>査定員</label><div><label class="switch"><input type="checkbox" ${b('aprAlert', 'data-type="bool"')} ${st.aprAlert !== false ? 'checked' : ''}><span></span>査定員不在アラートを出す</label>
          <span class="hint">OFFにすると、この店舗は査定員がいなくてもアラートを出さず、自動作成でも査定員の配置を求めません</span></div></div>
        <div class="f-row"><label>定休日</label><div class="closed-edit">
          <label class="switch"><input type="checkbox" ${b('allOpen', 'data-type="bool" data-rerender="1"')} ${st.allOpen ? 'checked' : ''}><span></span>年中無休</label>
          <div class="wd-chips${st.allOpen ? ' disabled' : ''}">
            ${WD.map((w, k) => `<label class="wchip ${k === 0 ? 'sun' : k === 6 ? 'sat' : ''}"><input type="checkbox" data-closed="${st.id}" data-w="${k}" ${(st.closedDays || []).includes(k) ? 'checked' : ''} ${st.allOpen ? 'disabled' : ''}><span>${w}</span></label>`).join('')}
            <label class="wchip wide"><input type="checkbox" ${b('closedOnHolidays', 'data-type="bool"')} ${st.closedOnHolidays ? 'checked' : ''} ${st.allOpen ? 'disabled' : ''}><span>祝日</span></label>
          </div>
          <input type="text" placeholder="臨時休業日（例: 12/31, 1/1, 2026-08-15）" ${b('closedDates')} value="${esc(st.closedDates)}">
        </div></div>
      </div>
      <div class="card-foot">
        <button class="btn sm ghost" data-act="move" data-kind="stores" data-id="${st.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑ 上へ</button>
        <button class="btn sm ghost" data-act="move" data-kind="stores" data-id="${st.id}" data-dir="1" ${i === n - 1 ? 'disabled' : ''}>↓ 下へ</button>
        <span class="sp"></span><button class="btn sm danger" data-act="del-store" data-id="${st.id}">この店舗を削除</button>
      </div></details>`;
  }

  function staffCard(state, p, i, n, ui) {
    const b = (f, extra = '') => `data-bind="staff|${p.id}|${f}" ${extra}`;
    const all = (p.stores || []).includes('all');
    return `<details class="card" data-card="${p.id}" ${ui.openCards.has(p.id) ? 'open' : ''}>
      <summary data-sum="staff|${p.id}">${staffSummary(p)}</summary>
      <div class="form">
        <div class="f-row"><label>氏名</label><input type="text" ${b('name')} value="${esc(p.name)}"></div>
        <div class="f-row"><label>氏名略称</label><div><input type="text" maxlength="4" class="w-s" ${b('short')} value="${esc(p.short)}"><span class="hint">希望休テキストの名前判定にも使います</span></div></div>
        <div class="f-row"><label>雇用区分</label><div class="seg-radio">${TYPES.map(t => `<label><input type="radio" name="type_${p.id}" value="${t}" ${b('type')} ${p.type === t ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
        <div class="f-row"><label>基本勤務時間</label><div><input type="time" step="900" ${b('start')} value="${esc(p.start)}"> 〜 <input type="time" step="900" ${b('end')} value="${esc(p.end)}"></div></div>
        <div class="f-row"><label>対応店舗</label><div>
          <details class="multi"><summary data-capsum="${p.id}">${esc(M.capLabel(p))}</summary><div class="menu">
            <label class="opt"><input type="checkbox" data-cap="${p.id}" value="all" ${all ? 'checked' : ''}> 全店舗</label>
            ${state.stores.map(s => `<label class="opt"><input type="checkbox" data-cap="${p.id}" value="${s.id}" ${!all && (p.stores || []).includes(s.id) ? 'checked' : ''} ${all ? 'disabled' : ''}> ${sbadge(s)} ${esc(s.name)}</label>`).join('')}
          </div></details><span class="hint">問題なく勤務できる店舗（応援先の候補になります）</span></div></div>
        <div class="f-row"><label>メイン店舗</label><div><select ${b('main', 'data-rerender="1"')}>
          <option value="free" ${p.main === 'free' ? 'selected' : ''}>フリー</option>
          ${state.stores.map(s => `<option value="${s.id}" ${p.main === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select><span class="hint">原則この店舗に配置。他店に欠員があり対応可能な場合のみ応援に回ります</span></div></div>
        <div class="f-row"><label>査定員</label><div><label class="switch"><input type="checkbox" ${b('appraiser', 'data-type="bool"')} ${p.appraiser ? 'checked' : ''}><span></span>査定員</label>
          <span class="hint">各店舗に査定員が1人もいない日はアラートを表示し、自動作成でも優先して配置します</span></div></div>
        <div class="f-row"><label>月の休日数</label><div><input type="number" min="0" max="31" class="w-num" ${b('offDays', 'data-type="num"')} value="${esc(p.offDays)}"> 日
          <span class="hint">自動作成で確保する休みの目安（希望休を含む・有給は含まない）</span></div></div>
      </div>
      <div class="card-foot">
        <button class="btn sm ghost" data-act="move" data-kind="staff" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑ 上へ</button>
        <button class="btn sm ghost" data-act="move" data-kind="staff" data-id="${p.id}" data-dir="1" ${i === n - 1 ? 'disabled' : ''}>↓ 下へ</button>
        <span class="sp"></span><button class="btn sm danger" data-act="del-staff" data-id="${p.id}">このスタッフを削除</button>
      </div></details>`;
  }

  function settings(state, ui) {
    const s = state.settings;
    return `<div class="settings">
      <section class="panel"><div class="panel-head"><div><h2>店舗</h2><p class="muted">${state.stores.length}店舗 ・ タップで編集</p></div>
        <button class="btn primary" data-act="add-store">＋ 店舗を追加</button></div>
        <div class="cards">${state.stores.map((st, i) => storeCard(st, i, state.stores.length, ui)).join('') || '<p class="muted">店舗がありません</p>'}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>スタッフ</h2><p class="muted">${state.staff.length}名 ・ 並び順は月次表の表示順です</p></div>
        <button class="btn primary" data-act="add-staff">＋ スタッフを追加</button></div>
        <div class="cards">${state.staff.map((p, i) => staffCard(state, p, i, state.staff.length, ui)).join('') || '<p class="muted">スタッフがいません</p>'}</div></section>
      <section class="panel"><div class="panel-head"><h2>基本設定</h2></div><div class="form">
        <div class="f-row"><label>表示名</label><input type="text" data-bind="settings||appName" value="${esc(s.appName)}"></div>
        <div class="f-row"><label>連勤の上限</label><div><input type="number" min="2" max="14" class="w-num" data-bind="settings||maxConsecutive" data-type="num" value="${esc(s.maxConsecutive)}"> 日まで
          <span class="hint">これを超える連勤（初期値: 6連勤以上）をアラート表示します</span></div></div>
      </div></section>
      <section class="panel"><div class="panel-head"><div><h2>データ管理</h2>
        <p class="muted">データはこの端末のブラウザに保存されています。別の端末で編集する場合や念のための控えに、バックアップを保存してください。</p></div></div>
        <div class="btn-row">
          <button class="btn" data-act="backup-export">バックアップを保存（JSON）</button>
          <button class="btn" data-act="backup-import">バックアップを読み込む</button>
          <button class="btn ghost" data-act="load-sample">サンプルデータに戻す</button>
          <button class="btn danger" data-act="reset-all">すべてのシフトを削除</button>
        </div></section>
    </div>`;
  }

  return { OFF, month, myShift, day, leave, settings, legend, sbadge, sicon, storeSummary, staffSummary, dayCls };
})();
