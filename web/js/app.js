const $ = id => document.getElementById(id);
// 一周色板（周一起）：橙 黄 绿 青 蓝 紫 粉
const DAY_HUE = [55, 95, 145, 185, 235, 300, 355];
let weekStart = monday(new Date()), selDay = dkey(new Date()), view = "week", dirty = false;

function status(t) { $("status").textContent = t; $("status2").textContent = t; }
const editing = () => { const a = document.activeElement; return !!(a && (a.closest?.(".b") || a.classList?.contains("edit-in") || a.id === "review" || a.id === "extra")); };
Store.hooks({
  onChange: () => { if (editing()) dirty = true; else render(); },   // 正在打字时先不重画，失焦后再画
  onStatus: status,
  onDirty: id => { Sync.markDirty(id); syncInfo(); },
  onSaved: () => Sync.soon(2000),
});

document.addEventListener("focusout", () => setTimeout(() => { if (dirty && !editing()) { dirty = false; render(); } }, 200));

/* ---- 同步设置 ---- */
let syncMsg = "";
function syncInfo() {
  const on = Sync.enabled(), t = Sync.lastOk, n = on ? Sync.pendingCount : 0;
  // 有没上传的改动时绝不显示「已同步」
  const wait = n ? `${n} 周待上传` : "";
  const text = !on ? "未设置同步" : (syncMsg ? syncMsg + (wait && syncKind !== "warn" ? `（${wait}）` : "") : wait || (t ? `已同步 ${pad(t.getHours())}:${pad(t.getMinutes())}` : "同步中…"));
  const cls = !on ? "off" : syncKind === "err" ? "err" : syncKind === "warn" ? "warn" : syncKind === "off" || n ? "" : t ? "ok" : "";
  $("syncInfo").textContent = text; $("syncDot").className = "sync-dot " + cls;
  document.querySelectorAll("[data-sync]").forEach(b => {
    b.className = "sync-pill " + cls;
    b.textContent = !on ? "未同步" : cls === "err" ? "同步出错" : cls === "warn" ? "有提醒" : cls === "ok" ? `已同步 ${pad(t.getHours())}:${pad(t.getMinutes())}` : syncKind === "off" ? (n ? `离线 · ${wait}` : "离线中") : (wait || syncMsg || "同步中…");
    b.title = text;
  });
}
let syncKind = "";   // "" / "warn"（提醒，比如同一条被两边改了）/ "err"（同步失败）/ "off"（离线）
let unseenWarn = "";   // 提醒要一直留着，直到用户点开胶囊看过；否则下一轮同步成功就把它冲掉了
Sync.hooks({ onStatus: (t, kind = t ? "err" : "") => {
  if (kind === "warn") unseenWarn = unseenWarn && unseenWarn !== t ? unseenWarn + "；" + t : t;
  else if (!kind && unseenWarn) { t = unseenWarn; kind = "warn"; }
  syncMsg = t; syncKind = kind; syncInfo(); if (typeof renderE2EE === "function") renderE2EE();
} });
(() => {
  const c = Sync.cfg; $("syncServer").value = c.server; $("syncToken").value = c.token;
  $("serverRow").hidden = !Sync.needsServer && !c.server;
  if (!Sync.enabled() && location.protocol.startsWith("http")) $("syncBox").open = true;
})();
// 手动同步：在面板里写清楚这一次的结果
async function syncByHand() {
  const out = $("syncResult"); out.className = "sync-result busy"; out.textContent = "正在连接服务器…";
  syncMsg = ""; syncInfo();
  const r = await Sync.run(); syncInfo(); renderE2EE(r && r.code);
  const t = new Date(), hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (!r || r.busy) { out.className = "sync-result"; out.textContent = "正在同步，稍等几秒再看"; return; }
  if (r.ok) {
    const parts = [];
    if (r.pushed) parts.push(`上传 ${r.pushed} 周`);
    if (r.pulled) parts.push(`下载 ${r.pulled} 周`);
    out.className = "sync-result ok";
    out.textContent = `✓ ${hm} 同步成功，` + (parts.length ? parts.join("、") : "两边已经一致，没有要传的") + (r.notice ? `。${r.notice}` : "");
  } else {
    out.className = "sync-result err";
    out.textContent = `✗ ${hm} 没有同步成功：${r.error}` + (r.error === "连不上服务器" ? "。检查服务器地址，或者代理是否拦住了这个网址" : r.error === "令牌不对" ? "。重新粘贴一次令牌试试" : "");
  }
}
// 两个按钮都先把输入框里的内容存下来再同步，免得只点了「立即同步」却没保存令牌
const applyForm = () => Sync.configure({ server: $("syncServer").value, token: $("syncToken").value });
$("syncForm").onsubmit = ev => { ev.preventDefault(); applyForm(); syncByHand(); };
$("syncNow").onclick = () => { applyForm(); syncByHand(); };

/* ---- 端到端加密 ---- */
function renderE2EE(lastErr) {
  const a = Sync.account, on = Sync.enabled();
  $("e2eeBox").hidden = !on;
  if (!on) return;
  const needKey = lastErr === "need-key" || (a.e2ee && (!E2EE.enabled || E2EE.keyId !== a.keyId));
  const locked = a.e2ee && E2EE.enabled && E2EE.keyId === a.keyId;
  $("e2eeState").textContent = locked ? `已开启端到端加密（密钥指纹 ${E2EE.keyId}）：服务器上只有密文。`
    : needKey ? "这个账号开了端到端加密，这台设备还没有密钥。"
    : E2EE.enabled ? "正在开启端到端加密…" : "未加密：服务器上存的是明文。";
  $("e2eeOn").hidden = locked || needKey || E2EE.enabled || !$("e2eeNew").hidden;
  $("e2eeShow").hidden = !locked;
  $("e2eeEnter").hidden = !needKey;
}
$("e2eeOn").onclick = async () => {
  $("e2eeCode").textContent = await E2EE.newCode();
  $("e2eeSaved").checked = false; $("e2eeConfirm").disabled = true;
  $("e2eeNew").hidden = false; $("e2eeMsg").textContent = ""; renderE2EE();
};
$("e2eeSaved").onchange = () => { $("e2eeConfirm").disabled = !$("e2eeSaved").checked; };
$("e2eeCopy").onclick = () => copyText($("e2eeCode").textContent, $("e2eeCopy"));
$("e2eeCancel").onclick = () => { $("e2eeNew").hidden = true; $("e2eeCode").textContent = ""; renderE2EE(); };
$("e2eeConfirm").onclick = async () => {
  try {
    await E2EE.useCode($("e2eeCode").textContent);
    $("e2eeNew").hidden = true; $("e2eeCode").textContent = "";
    await syncByHand();
  } catch (e) { $("e2eeMsg").className = "sync-result err"; $("e2eeMsg").textContent = "✗ " + e.message; }
};
$("e2eeUse").onclick = async () => {
  try {
    await Sync.useRecoveryCode($("e2eeInput").value);
    $("e2eeInput").value = ""; $("e2eeMsg").className = "sync-result ok"; $("e2eeMsg").textContent = "✓ 恢复码对上了";
    await syncByHand();
  } catch (e) { $("e2eeMsg").className = "sync-result err"; $("e2eeMsg").textContent = "✗ " + e.message; }
};
$("e2eeShow").onclick = async () => {
  const shown = $("e2eeMsg").dataset.code === "1";
  $("e2eeMsg").className = "sync-result"; $("e2eeMsg").dataset.code = shown ? "" : "1";
  $("e2eeMsg").innerHTML = shown ? "" : "";
  if (!shown) { const c = document.createElement("code"); c.className = "e2ee-code"; c.textContent = await E2EE.recoveryCode(); $("e2eeMsg").append("在新设备上输入这串恢复码：", c); }
  $("e2eeShow").textContent = shown ? "显示恢复码" : "收起恢复码";
};
function copyText(t, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = "已复制"; setTimeout(() => btn.textContent = o, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, () => selectCode());
  else selectCode();
  function selectCode() { const r = document.createRange(); r.selectNodeContents($("e2eeCode")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
E2EE.ready.then(() => renderE2EE());
document.querySelectorAll("[data-sync]").forEach(b => b.onclick = () => {
  if (view !== "week") { weekStart = monday(fromKey(selDay)); show("week"); }
  $("syncBox").open = true; $("syncBox").scrollIntoView({ behavior: "smooth", block: "center" });
  unseenWarn = "";   // 面板里已经显示着这条提醒，看过了；下一轮同步成功后就不再保留
});
setInterval(syncInfo, 15000);
window.addEventListener("online", () => Sync.soon(300));
const wake = () => Sync.soon(300);
window.addEventListener("focus", wake);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); else leave(); });
// 切到后台 / 关页面：先把 600ms 防抖里的字写进本机，再趁还活着推一次（安卓切后台后定时器可能被暂停）
const leave = () => { Store.flush(); if (Sync.enabled() && Sync.pendingCount) Sync.run(); };
window.addEventListener("pagehide", leave);

/* ---- 离线可用（PWA） ---- */
if (!IS_APP && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {   // App 自带文件，不需要离线缓存
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---- 视图切换 ---- */
function show(v) {
  view = v; $("weekView").hidden = v !== "week"; $("dayView").hidden = v !== "day";
  try { history.replaceState(null, "", v === "day" ? "#d" + selDay : "#week"); } catch (e) {}
  window.scrollTo(0, 0); render();
}
const render = () => view === "day" ? renderDay() : renderWeek();
const dayList = k => { const w = Store.forDay(k); return w.days[k] || (w.days[k] = []); };

/* ---- 周页面 ---- */
function renderWeek() {
  const w = Store.get(dkey(weekStart)), today = dkey(new Date()), isNowWeek = dkey(monday(new Date())) === w.start;
  const end = addDays(weekStart, 6);
  $("range").textContent = `${w.week} · ${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
  $("now").hidden = isNowWeek;

  // 七个日期按钮：深浅 = 那天日记的条数
  const counts = [...Array(7)].map((_, i) => (w.days[dkey(addDays(weekStart, i))] || []).length);
  const max = Math.max(1, ...counts); let passed = 0;
  $("bar").innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i), k = dkey(d), n = counts[i], c = document.createElement("button");
    c.className = "cell";
    // 色卡：每个周几一个色相，写得越多颜色越深（0 条 = 色卡最浅那格）
    const step = n ? 1 + Math.round(3 * n / max) : 0;          // 0..4
    c.style.setProperty("--h", DAY_HUE[i]); c.style.setProperty("--step", step);
    if (step >= 4) c.classList.add("hot");
    if (k < today) { c.classList.add("past"); passed++; }
    else if (k === today) { c.classList.add("today", "sel"); passed++; } else c.classList.add("future");
    c.setAttribute("aria-label", `打开周${WD[i]} ${d.getMonth() + 1}月${d.getDate()}日的日记，${n} 条`);
    c.innerHTML = `<span>${WD[i]}</span><span class="n">${n ? n + "条" : d.getDate()}</span>`;
    c.onclick = () => { selDay = k; show("day"); };
    $("bar").appendChild(c);
  }
  $("cap").textContent = isNowWeek ? `第 ${passed} / 7 天 · 点格子打开那天的日记` : (weekStart > new Date() ? "还没到这周" : "点格子打开那天的日记");

  // 这周的事：只标周几
  const sel = $("wkDay");
  if (!sel.options.length) WD.forEach((x, i) => { const o = document.createElement("option"); o.value = i; o.textContent = "周" + x; sel.appendChild(o); });
  if (document.activeElement !== sel && document.activeElement !== $("wkIn")) sel.value = isNowWeek ? weekday(new Date()) : 0;
  $("wkForm").style.setProperty("--h", DAY_HUE[+sel.value]);
  // 越近的日子越靠上；同一天里按你排的顺序
  const ev = [...w.events].sort((a, b) => b.wd - a.wd);
  const box = $("wklog"); box.innerHTML = ""; let last = -1;
  if (!ev.length) box.innerHTML = '<div class="empty">还没有记下这周的事。</div>';
  const folded = foldState(w.week);
  ev.forEach(e => {
    if (e.wd !== last) {
      last = e.wd;
      const n = ev.filter(x => x.wd === e.wd).length, isFold = folded.has(e.wd);
      const h = document.createElement("div"); h.className = "wday" + (isFold ? " folded" : ""); h.dataset.wd = e.wd; h.style.setProperty("--h", DAY_HUE[e.wd]);
      const name = document.createElement("span"); name.textContent = "周" + WD[e.wd];
      const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = isFold ? `${n} 条` : "";
      const tg = document.createElement("button"); tg.type = "button"; tg.className = "fold"; tg.textContent = isFold ? "展开" : "收起";
      tg.setAttribute("aria-expanded", String(!isFold));
      tg.onclick = () => { isFold ? folded.delete(e.wd) : folded.add(e.wd); saveFold(w.week, folded); render(); };
      h.append(name, cnt, tg); box.appendChild(h);
    }
    const r = eventRow(w, e, true); if (folded.has(e.wd)) r.hidden = true; box.appendChild(r);
  });

  // 周目标
  $("goals").innerHTML = "";
  w.goals.forEach(g => {
    const li = document.createElement("li"); if (g.done) li.className = "ok";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!g.done; cb.id = "g_" + g.id;
    cb.onchange = () => { g.done = cb.checked; Store.save(w, { now: true }); render(); };
    const s = document.createElement("span"); s.textContent = g.text; s.title = "双击修改";
    s.ondblclick = () => inlineEdit(s, g.text, val => { g.text = val; Store.save(w, { now: true }); render(); });
    const x = xButton(() => { w.goals = w.goals.filter(y => y.id !== g.id); Store.save(w, { now: true }); render(); });
    li.append(cb, s, x); $("goals").appendChild(li);
  });

  const ta = $("review"); if (document.activeElement !== ta) ta.value = w.review;
  const ex = $("extra"); if (document.activeElement !== ex) ex.value = w.extra || "";
  $("extraSec").hidden = !(w.extra || "").trim() && document.activeElement !== ex;
  $("extraSec").classList.toggle("conflict", /^## 冲突副本/m.test(w.extra || ""));
  $("storeInfo").textContent = Store.dirName ? `数据文件夹：${Store.dirName}/` : IS_APP ? "只存在这个 App 里（卸载会清掉）" : "只存在这个浏览器里";
  $("linkDir").hidden = !Store.canLinkDir;
  if (Store.dirName) $("linkDir").textContent = "换一个文件夹";
}
// 每天的收起状态：只是这台设备上的显示偏好，存在浏览器里，不进 .md
function foldState(week) { try { return new Set(JSON.parse(localStorage.getItem("myweek-fold:" + week) || "[]")); } catch (e) { return new Set(); } }
function saveFold(week, set) { try { localStorage.setItem("myweek-fold:" + week, JSON.stringify([...set])); } catch (e) {} }

// 「这周的事」的一条：当天颜色的圆点（可拖动）、双击修改、悬停出现删除
function eventRow(w, e, draggable) {
  const r = document.createElement("div"); r.className = "wrow"; r.dataset.id = e.id;
  r.style.setProperty("--h", DAY_HUE[e.wd]);
  const dot = document.createElement("span"); dot.className = "wdot";
  if (draggable) { dot.classList.add("grab"); dot.title = "拖动排序"; dot.onpointerdown = ev => startDrag(ev, r, w); }
  const tx = document.createElement("div"); tx.className = "tx"; tx.textContent = e.text; tx.title = "双击修改";
  tx.ondblclick = () => inlineEdit(tx, e.text, val => { e.text = val; Store.save(w, { now: true }); render(); });
  const a = document.createElement("div"); a.className = "acts";
  const bd = xButton(() => { w.events = w.events.filter(x => x.id !== e.id); Store.save(w, { now: true }); render(); });
  a.append(bd); r.append(dot, tx, a); return r;
}

// 叉叉：悬停在那一条上才出现；点一下变红，再点一下删除
function xButton(onDelete) {
  const b = document.createElement("button"); b.className = "x"; b.type = "button";
  b.setAttribute("aria-label", "删除"); b.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  b.onclick = () => {
    if (b.classList.contains("sure")) return onDelete();
    b.classList.add("sure"); b.title = "再点一下删除";
    setTimeout(() => { b.classList.remove("sure"); b.title = ""; }, 2500);
  };
  return b;
}

// 拖动圆点：只能在同一天的条目之间移动。被拖的行跟手，其他行滑开让位，
// 一根当天颜色的横线标出落点；松手后滑进空位再保存。
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function startDrag(ev, row, w) {
  ev.preventDefault();
  const box = row.parentElement;
  // 这一天的所有行（从本组标题到下一个标题之间）
  const group = []; let cur = null;
  for (const x of box.children) {
    if (x.classList.contains("wday")) { if (cur && cur.includes(row)) break; cur = []; continue; }
    if (x.classList.contains("wrow") && cur) cur.push(x);
  }
  group.push(...cur);
  if (group.length < 2) return;                               // 这天只有一条，没得排

  const top = r => r.getBoundingClientRect().top;
  const orig = new Map(group.map(r => [r, { top: top(r), h: r.getBoundingClientRect().height }]));
  const me = orig.get(row), i0 = group.indexOf(row), others = group.filter(r => r !== row);
  const gTop = orig.get(group[0]).top, gBottom = orig.get(group[group.length - 1]).top + orig.get(group[group.length - 1]).h;
  const minDy = gTop - me.top, maxDy = gBottom - (me.top + me.h);
  const startY = ev.clientY, box0 = box.getBoundingClientRect().top;

  const line = document.createElement("div"); line.className = "drop-line on"; line.style.setProperty("--h", row.style.getPropertyValue("--h")); box.appendChild(line);
  row.classList.add("dragging"); document.body.style.userSelect = "none";
  others.forEach(r => { r.style.transition = reduceMotion() ? "none" : "transform .16s ease-out"; });
  let k = i0, dy = 0;

  const layout = () => {
    const center = me.top + me.h / 2 + dy;
    k = others.filter(r => { const o = orig.get(r); return o.top + o.h / 2 < center; }).length;
    others.forEach((r, o) => {
      const j = group.indexOf(r);
      const shift = (j > i0 && o < k) ? -me.h : (j < i0 && o >= k) ? me.h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
    // 空位的上沿 = 落点（都用拖动开始时量的坐标）
    let gap = gTop;
    if (k > 0) { const r = others[k - 1], o = orig.get(r); gap = o.top + o.h + (group.indexOf(r) > i0 ? -me.h : 0); }
    line.style.top = (gap - box0 - 1) + "px";
    return gap;
  };
  const scroll0 = window.scrollY;
  const move = m => {
    dy = Math.max(minDy, Math.min(maxDy, m.clientY - startY + (window.scrollY - scroll0)));
    row.style.transform = `translateY(${dy}px)`;
    layout();
  };
  layout();

  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    document.body.style.userSelect = ""; line.remove();
    const gap = layout(), finalDy = gap - me.top;
    const finish = () => {
      // 只重排这一天的条目，其他天的顺序不动
      const ids = others.map(r => r.dataset.id); ids.splice(k, 0, row.dataset.id);
      const byId = new Map(w.events.map(x => [x.id, x])), wd = byId.get(row.dataset.id).wd;
      const sorted = ids.map(id => byId.get(id)); let n = 0;
      w.events = w.events.map(x => x.wd === wd ? sorted[n++] : x);
      Store.save(w, { now: true }); render();
    };
    if (reduceMotion() || k === i0 && Math.abs(dy) < 1) { row.classList.remove("dragging"); row.style.transform = ""; return k === i0 ? render() : finish(); }
    row.style.transition = "transform .16s ease-out, box-shadow .16s"; row.classList.add("settling");
    row.style.transform = `translateY(${finalDy}px)`;
    setTimeout(finish, 180);
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
}

function inlineEdit(el, val, save) {
  const i = document.createElement("input"); i.className = "edit-in"; i.value = val; el.textContent = ""; el.appendChild(i); i.focus();
  let f = false; const fin = ok => { if (f) return; f = true; const s = i.value.trim(); if (ok && s && s !== val) save(s); else render(); };
  i.onkeydown = e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") fin(true); if (e.key === "Escape") fin(false); };
  i.onblur = () => fin(true);
}

/* ---- 日记页面 ---- */
function renderDay() {
  const d = fromKey(selDay), list = dayList(selDay);
  $("dayTitle").textContent = `周${WD[weekday(d)]} · ${d.getMonth() + 1}月${d.getDate()}日`;
  $("dayTitle").style.setProperty("--h", DAY_HUE[weekday(d)]);
  $("dayCount").textContent = list.length ? `${list.length} 条` : "";
  $("dToday").hidden = selDay === dkey(new Date());
  // 置顶：这周的事里属于这一天的条目，用当天色卡作底色
  const w = Store.forDay(selDay), wd = weekday(d), pins = w.events.filter(e => e.wd === wd);
  const pin = $("pin"); pin.innerHTML = ""; pin.hidden = !pins.length; pin.style.setProperty("--h", DAY_HUE[wd]);
  if (pins.length) {
    const h = document.createElement("div"); h.className = "pin-h"; h.textContent = "这周的事 · 周" + WD[wd]; pin.appendChild(h);
    pins.forEach(e => pin.appendChild(eventRow(w, e, false)));
  }
  // 输入框：当天颜色的横线，左边是此刻的时间
  $("dayForm").style.setProperty("--h", DAY_HUE[wd]); tickNow();
  // 越近越靠上：按时间倒序（子条目跟着父条目走，同一层内也倒序）
  // 正在一条条往下写（回车新起、Tab 缩进）时先不重排，离开编辑再排，免得新行跳走
  const sorted = holdSort ? list : sortTree(list);
  if (sorted.some((e, i) => e !== list[i])) { list.splice(0, list.length, ...sorted); Store.save(Store.forDay(selDay)); }
  const box = $("outline"); box.innerHTML = "";
  list.forEach(e => box.appendChild(bullet(e)));
  if (!list.length) { const p = document.createElement("div"); p.className = "hint"; p.style.margin = "0"; p.textContent = "这一天还空着。在上面的横线上写一句，回车记下，会自动带上此刻的时间。"; box.appendChild(p); }
  requestAnimationFrame(drawTimeline);
}
// 大纲按时间倒序重排：先按缩进还原成树，每层兄弟按时间从新到旧排，再摊平。
// 没有时间戳的条目跟在它原来前面那一条后面，不乱跑。
let holdSort = false;
function sortTree(list) {
  const root = { kids: [] }, stack = [{ node: root, ind: -1 }];
  for (const e of list) {
    while (stack.length > 1 && stack[stack.length - 1].ind >= e.indent) stack.pop();
    const n = { e, kids: [] }; stack[stack.length - 1].node.kids.push(n); stack.push({ node: n, ind: e.indent });
  }
  const sortKids = kids => {
    let prev = Infinity;
    kids.forEach((n, i) => { n.key = n.e.ts ?? prev; n.i = i; prev = n.key; sortKids(n.kids); });
    kids.sort((a, b) => b.key - a.key || a.i - b.i);
  };
  sortKids(root.kids);
  const out = [], walk = (kids, depth) => kids.forEach(n => { n.e.indent = depth; out.push(n.e); walk(n.kids, depth + 1); });
  walk(root.kids, 0);
  return out;
}
// 连接各个顶层圆点的浅灰细线：从第一个顶层点画到最后一个
function drawTimeline() {
  const box = $("outline"), dots = [...box.querySelectorAll(".b.lv0 .dot")];
  if (dots.length < 2) { box.style.removeProperty("--tl-h"); return; }
  const b = box.getBoundingClientRect(), c = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 - b.top; };
  const a = c(dots[0]), z = c(dots[dots.length - 1]);
  box.style.setProperty("--tl-top", a + "px"); box.style.setProperty("--tl-h", (z - a) + "px");
}
window.addEventListener("resize", () => { if (view === "day") drawTimeline(); });
// 输入框左边的「此刻」时间，每分钟刷新一次
function tickNow() {
  const t = new Date(), el = $("dayNow");
  el.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}`; el.style.color = tsColor(t);
}
setInterval(() => { if (view === "day") tickNow(); }, 30000);
function bullet(e) {
  const r = document.createElement("div"); r.className = "b lv" + Math.min(e.indent, 3); r.dataset.id = e.id; r.style.setProperty("--ind", e.indent);
  const ts = document.createElement("div"); ts.className = "t";
  if (e.ts != null) {
    const t = new Date(e.ts), late = dkey(t) !== selDay;
    ts.style.color = tsColor(t);
    ts.innerHTML = `${pad(t.getHours())}:${pad(t.getMinutes())}` + (late ? `<small title="${t.getMonth() + 1}/${t.getDate()} 补记">补</small>` : "");
  } else { ts.classList.add("empty"); ts.textContent = "--:--"; }
  ts.title = "双击修改时间";
  ts.ondblclick = () => editTime(e, ts);
  const dot = document.createElement("div"); dot.className = "dot";
  const tx = document.createElement("div"); tx.className = "tx"; tx.dataset.ph = "写点什么";
  try { tx.contentEditable = "plaintext-only"; } catch (err) {}
  if (tx.contentEditable !== "plaintext-only") tx.contentEditable = "true";
  tx.textContent = e.text || "";
  tx.oninput = () => { e.text = tx.textContent; Store.save(Store.forDay(selDay)); drawTimeline(); };
  tx.onkeydown = ev => keys(ev, e, tx);
  tx.onfocus = () => { $("tools").hidden = false; $("tools").dataset.id = e.id; };
  tx.onblur = () => setTimeout(() => {
    if (!document.activeElement?.closest?.(".b,.tools")) { $("tools").hidden = true; dirty = false; holdSort = false; render(); }
  }, 150);
  r.append(ts, dot, tx); return r;
}
// 双击时间戳修改：改成当天的这个钟点（「补」标记随之消失）；清空就是不要时间戳
function editTime(e, el) {
  const i = document.createElement("input"); i.type = "time"; i.className = "time-in";
  if (e.ts != null) { const t = new Date(e.ts); i.value = `${pad(t.getHours())}:${pad(t.getMinutes())}`; }
  el.replaceChildren(i); el.classList.remove("empty"); i.focus();
  try { i.showPicker && matchMedia("(pointer: coarse)").matches && i.showPicker(); } catch (err) {}
  let done = false;
  const fin = ok => {
    if (done) return; done = true;
    if (ok) {
      const v = i.value;
      if (!v) e.ts = null;
      else { const [h, m] = v.split(":").map(Number), d = fromKey(selDay); d.setHours(h, m, 0, 0); e.ts = d.getTime(); }
      Store.save(Store.forDay(selDay), { now: true });
    }
    render();
  };
  i.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); fin(true); } if (ev.key === "Escape") fin(false); };
  i.onblur = () => fin(true);
}
function focusId(id) {
  const el = document.querySelector(`.b[data-id="${id}"] .tx`); if (!el) return; el.focus();
  const s = getSelection(), rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
}
function newAfter(id) {
  const list = dayList(selDay), idx = id ? list.findIndex(x => x.id === id) : list.length - 1;
  const e = { id: "e_" + uid(), ts: Date.now(), indent: idx >= 0 ? list[idx].indent : 0, text: "" };
  list.splice(idx + 1, 0, e); Store.save(Store.forDay(selDay)); holdSort = true; render();
  focusId(e.id);   // render 是同步的，新行已经在页面上，立刻聚焦，免得第一个字丢掉
}
function indent(id, delta) {
  const list = dayList(selDay), idx = list.findIndex(x => x.id === id); if (idx < 0) return;
  const e = list[idx], maxI = idx > 0 ? list[idx - 1].indent + 1 : 0, ni = Math.max(0, Math.min(maxI, e.indent + delta));
  if (ni === e.indent) return;
  e.indent = ni; const row = document.querySelector(`.b[data-id="${id}"]`);
  row.style.setProperty("--ind", ni); row.className = "b lv" + Math.min(ni, 3); drawTimeline();
  Store.save(Store.forDay(selDay), { now: true });
}
function keys(ev, e, tx) {
  if (ev.isComposing || ev.keyCode === 229) return;                 // 中文输入法选字中
  const list = dayList(selDay), idx = list.findIndex(x => x.id === e.id);
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); newAfter(e.id); }
  else if (ev.key === "Tab") { ev.preventDefault(); indent(e.id, ev.shiftKey ? -1 : 1); }
  else if (ev.key === "Backspace" && !tx.textContent) {
    ev.preventDefault(); const prev = list[idx - 1];
    list.splice(idx, 1); Store.save(Store.forDay(selDay), { now: true });
    tx.closest(".b").remove(); dirty = true; if (prev) focusId(prev.id);
  }
  else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
    const s = getSelection(); if (!s.rangeCount) return;
    const t = list[idx + (ev.key === "ArrowUp" ? -1 : 1)];
    const atEdge = ev.key === "ArrowUp" ? s.anchorOffset === 0 : s.anchorOffset >= tx.textContent.length;
    if (t && atEdge) { ev.preventDefault(); focusId(t.id); }
  }
}
$("dayForm").onsubmit = ev => {
  ev.preventDefault(); const s = $("dayIn").value.trim(); if (!s) return;
  const list = dayList(selDay);
  list.unshift({ id: "e_" + uid(), ts: Date.now(), indent: 0, text: s });   // 最新的在最上面
  Store.save(Store.forDay(selDay), { now: true }); $("dayIn").value = ""; render(); $("dayIn").focus();
};
const tid = () => $("tools").dataset.id;
$("tIn").onmousedown = $("tOut").onmousedown = e => e.preventDefault();
$("tIn").onclick = () => indent(tid(), 1); $("tOut").onclick = () => indent(tid(), -1);
$("tDone").onclick = () => { document.activeElement?.blur(); $("tools").hidden = true; holdSort = false; render(); };

/* ---- 快速跳转、回到顶部 ---- */
document.querySelectorAll("[data-jump]").forEach(a => a.onclick = ev => {
  ev.preventDefault(); $(a.dataset.jump).scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
});
$("toTop").onclick = () => window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
const topVis = () => { $("toTop").hidden = window.scrollY < 240 || !$("tools").hidden; };
window.addEventListener("scroll", topVis, { passive: true }); topVis();
new MutationObserver(topVis).observe($("tools"), { attributes: true, attributeFilter: ["hidden"] });   // 编辑日记时底部有工具条，先让开

/* ---- 周页面输入 ---- */
$("wkDay").onchange = () => $("wkForm").style.setProperty("--h", DAY_HUE[+$("wkDay").value]);
$("wkForm").onsubmit = ev => {
  ev.preventDefault(); const s = $("wkIn").value.trim(); if (!s) return;
  const w = Store.get(dkey(weekStart));
  const wd = Number($("wkDay").value), at = w.events.findIndex(x => x.wd === wd);
  const item = { id: "w_" + uid(), wd, text: s };
  if (at < 0) w.events.push(item); else w.events.splice(at, 0, item);   // 新记的放在那天最上面
  const f = foldState(w.week); if (f.delete(wd)) saveFold(w.week, f);   // 记到收起的那天就自动展开
  Store.save(w, { now: true }); $("wkIn").value = ""; render(); $("wkIn").focus();
};
$("goalForm").onsubmit = ev => {
  ev.preventDefault(); const s = $("goalIn").value.trim(); if (!s) return;
  const w = Store.get(dkey(weekStart));
  w.goals.push({ id: "g_" + uid(), text: s, done: false });
  Store.save(w, { now: true }); $("goalIn").value = ""; render();
};
$("extra").oninput = () => { const w = Store.get(dkey(weekStart)); w.extra = $("extra").value; Store.save(w); };
$("review").oninput = () => { const w = Store.get(dkey(weekStart)); w.review = $("review").value; Store.save(w); };
$("prev").onclick = () => { weekStart = addDays(weekStart, -7); render(); };
$("next").onclick = () => { weekStart = addDays(weekStart, 7); render(); };
$("now").onclick = () => { weekStart = monday(new Date()); render(); };

/* ---- 存储按钮 ---- */
$("linkDir").onclick = async () => {
  try {
    if ($("linkDir").dataset.regrant) { await Store.regrant(); delete $("linkDir").dataset.regrant; render(); return; }
    const n = await Store.linkDir(); status(`已连接，读入 ${n} 周`);
  } catch (e) { if (e.name !== "AbortError") status("没连上：" + e.message); }
};
$("exportWk").onclick = async () => { try { await Store.exportWeek(Store.get(dkey(weekStart))); } catch (e) { if (!/cancel/i.test(e.message || "")) status("导出失败：" + e.message); } };
$("importWk").onclick = () => $("importFile").click();
$("importFile").onchange = async () => { const n = await Store.importFiles([...$("importFile").files]); status(`导入了 ${n} 周`); $("importFile").value = ""; };

/* ---- 日记导航 ---- */
function goDay(k) { selDay = k; weekStart = monday(fromKey(k)); show("day"); }
$("back").onclick = () => { weekStart = monday(fromKey(selDay)); show("week"); };
$("dPrev").onclick = () => goDay(dkey(addDays(fromKey(selDay), -1)));
$("dNext").onclick = () => goDay(dkey(addDays(fromKey(selDay), 1)));
$("dToday").onclick = () => goDay(dkey(new Date()));

// 切回页面时读回在编辑器里改过的 .md
const refreshIfIdle = () => { if (!document.activeElement?.closest?.(".b,form,textarea")) Store.refresh(); };
window.addEventListener("focus", refreshIfIdle);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshIfIdle(); });

let lastToday = dkey(new Date());
setInterval(() => { const t = dkey(new Date()); if (t !== lastToday && !document.activeElement?.closest?.(".b,form,textarea")) { lastToday = t; render(); } }, 60000);

/* ---- 启动 ---- */
(function () {
  const h = location.hash;
  if (/^#d\d{4}-\d{2}-\d{2}$/.test(h)) { selDay = h.slice(2); weekStart = monday(fromKey(selDay)); view = "day"; $("weekView").hidden = true; $("dayView").hidden = false; }
  render();
  syncInfo(); Sync.soon(300);
  Store.restoreDir().then(r => {
    if (r === "lost") status("之前选的文件夹没有权限了（可能被移动或删除），请重新「连接数据文件夹」");
    if (r === "prompt") { $("linkDir").textContent = "重新连接数据文件夹"; $("linkDir").dataset.regrant = 1; status("点“重新连接数据文件夹”继续写入文件"); }
  }).catch(() => {});
})();
