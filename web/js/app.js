const $ = id => document.getElementById(id);
document.documentElement.lang = LANG === "en" ? "en" : "zh-CN"; document.title = tr("我的一周"); trDom(document.body);   // 页面里写死的文字（英文界面时换成英文）
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
  const wait = n ? tr("{0} 周待上传", n) : "";
  const text = !on ? tr("未设置同步") : (syncMsg ? syncMsg + (wait && syncKind !== "warn" ? tr("（{0}）", wait) : "") : wait || (t ? tr("已同步 {0}", `${pad(t.getHours())}:${pad(t.getMinutes())}`) : tr("同步中…")));
  const cls = !on ? "off" : syncKind === "err" ? "err" : syncKind === "warn" ? "warn" : syncKind === "off" || n ? "" : t ? "ok" : "";
  $("syncInfo").textContent = text; $("syncDot").className = "sync-dot " + cls;
  document.querySelectorAll("[data-sync]").forEach(b => {
    b.className = "sync-pill " + cls;
    b.textContent = !on ? tr("未同步") : cls === "err" ? tr("同步出错") : cls === "warn" ? tr("有提醒") : cls === "ok" ? tr("已同步 {0}", `${pad(t.getHours())}:${pad(t.getMinutes())}`) : syncKind === "off" ? (n ? tr("离线 · {0}", wait) : tr("离线中")) : (wait || syncMsg || tr("同步中…"));
    b.title = text;
  });
}
let syncKind = "";   // "" / "warn"（提醒，比如同一条被两边改了）/ "err"（同步失败）/ "off"（离线）
let unseenWarn = "";   // 提醒要一直留着，直到用户点开胶囊看过；否则下一轮同步成功就把它冲掉了
Sync.hooks({ onStatus: (t, kind = t ? "err" : "") => {
  if (kind === "warn") unseenWarn = unseenWarn && unseenWarn !== t ? unseenWarn + tr("；") + t : t;
  else if (!kind && unseenWarn) { t = unseenWarn; kind = "warn"; }
  syncMsg = t; syncKind = kind; syncInfo(); renderLog(); if (typeof renderE2EE === "function") renderE2EE();
} });
(() => {
  const c = Sync.cfg; $("syncServer").value = c.server; $("syncToken").value = c.token;
  $("serverRow").hidden = !Sync.needsServer && !c.server;
  if (!Sync.enabled() && location.protocol.startsWith("http")) $("syncBox").open = true;
})();
// 手动同步：在面板里写清楚这一次的结果
async function syncByHand() {
  const out = $("syncResult"); out.className = "sync-result busy"; out.textContent = tr("正在连接服务器…");
  syncMsg = ""; syncInfo();
  const r = await Sync.run(); syncInfo(); renderE2EE(r && r.code);
  const t = new Date(), hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (!r || r.busy) { out.className = "sync-result"; out.textContent = tr("正在同步，稍等几秒再看"); return; }
  if (r.ok) {
    const parts = [];
    if (r.pushed) parts.push(tr("上传 {0} 周", r.pushed));
    if (r.pulled) parts.push(tr("下载 {0} 周", r.pulled));
    out.className = "sync-result ok";
    out.textContent = tr("✓ {0} 同步成功，", hm) + (parts.length ? parts.join(tr("、")) : tr("两边已经一致，没有要传的")) + (r.notice ? tr("。") + r.notice : "");
  } else {
    out.className = "sync-result err";
    out.textContent = tr("✗ {0} 没有同步成功：{1}", hm, r.error) + (r.error === tr("连不上服务器") ? tr("。检查服务器地址，或者代理是否拦住了这个网址") : r.error === tr("令牌不对") ? tr("。重新粘贴一次令牌试试") : "");
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
  $("e2eeState").textContent = locked ? tr("已开启端到端加密（密钥指纹 {0}）：服务器上只有密文。", E2EE.keyId)
    : needKey ? tr("这个账号开了端到端加密，这台设备还没有密钥。")
    : E2EE.enabled ? tr("正在开启端到端加密…") : tr("未加密：服务器上存的是明文。");
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
    $("e2eeInput").value = ""; $("e2eeMsg").className = "sync-result ok"; $("e2eeMsg").textContent = tr("✓ 恢复码对上了");
    await syncByHand();
  } catch (e) { $("e2eeMsg").className = "sync-result err"; $("e2eeMsg").textContent = "✗ " + e.message; }
};
$("e2eeShow").onclick = async () => {
  const shown = $("e2eeMsg").dataset.code === "1";
  $("e2eeMsg").className = "sync-result"; $("e2eeMsg").dataset.code = shown ? "" : "1";
  $("e2eeMsg").innerHTML = shown ? "" : "";
  if (!shown) { const c = document.createElement("code"); c.className = "e2ee-code"; c.textContent = await E2EE.recoveryCode(); $("e2eeMsg").append(tr("在新设备上输入这串恢复码："), c); }
  $("e2eeShow").textContent = shown ? tr("显示恢复码") : tr("收起恢复码");
};
function copyText(t, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = tr("已复制"); setTimeout(() => btn.textContent = o, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, () => selectCode());
  else selectCode();
  function selectCode() { const r = document.createRange(); r.selectNodeContents($("e2eeCode")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
E2EE.ready.then(() => renderE2EE());
document.querySelectorAll("[data-sync]").forEach(b => b.onclick = () => {
  if (view !== "week") { weekStart = monday(fromKey(selDay)); show("week"); }
  if (syncKind === "warn" || syncKind === "err") $("logBox").open = true;   // 有提醒或出错时，顺手展开同步记录
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
// 新版本由 sw.js 在后台整包装好后先等着，不和正在用的旧版本混。刚打开或切回前台时，只要没在打字、没有防抖中的保存，
// 就直接切过去并刷新；否则在页面底部提示「有新版本，点这里刷新」。
if (!IS_APP && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {   // App 自带文件，不需要离线缓存
  const sw = navigator.serviceWorker;
  let reg = null, switching = false, lastCheck = Date.now();
  const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(a.tagName) && !!a.value)); };
  const apply = async () => {
    if (!reg || !reg.waiting || switching) return;
    switching = true; $("updBtn").hidden = true;
    try { await Store.flush(); } catch (e) {}
    reg.waiting.postMessage("skip");   // 新 SW 激活后 controllerchange → 刷新
  };
  const ready = auto => {
    if (!reg || !reg.waiting || !sw.controller) return;   // 第一次安装没有旧版本，不用切
    if (auto && !Store.queuedCount && !typing()) apply(); else $("updBtn").hidden = false;
  };
  $("updBtn").onclick = apply;
  sw.addEventListener("controllerchange", () => { if (switching) location.reload(); });
  sw.register("sw.js").then(r => {
    reg = r; ready(true);
    r.addEventListener("updatefound", () => { const n = r.installing; n && n.addEventListener("statechange", () => { if (n.state === "installed") ready(false); }); });
  }).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !reg) return;
    ready(true);
    if (Date.now() - lastCheck > 10 * 60e3) { lastCheck = Date.now(); reg.update().catch(() => {}); }   // 一直开着的页面也能发现新版本
  });
}

/* ---- 视图切换 ---- */
/* 进日记页压一条历史记录，安卓返回键（popstate）就回周记页而不是退出 App */
function show(v, fromPop) {
  const wasDay = view === "day";
  if (!fromPop) {
    try {
      if (v === "day" && !wasDay) history.pushState({ day: 1 }, "", "#d" + selDay);
      else if (v === "week" && history.state && history.state.day) { history.back(); return; }   // popstate 里完成切换
      else history.replaceState(history.state, "", v === "day" ? "#d" + selDay : "#week");
    } catch (e) {}
  }
  view = v; $("weekView").hidden = v !== "week"; $("dayView").hidden = v !== "day";
  window.scrollTo(0, 0); render();
}
window.addEventListener("popstate", () => {
  const openDlg = document.querySelector("dialog[open]");
  if (openDlg) { openDlg.close(); return; }   // 大图、新功能、历史版本开着时，返回键只关它
  const m = /^#d(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
  if (m && view === "day" && selDay === m[1]) return;      // 关大图时退回的就是当前这页
  if (m) { selDay = m[1]; weekStart = monday(fromKey(selDay)); show("day", true); }
  else if (view !== "week") show("week", true);
});
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
    c.setAttribute("aria-label", tr("打开{0} {1}的日记，{2}", dayName(i), monthDay(d), cnt(n)));
    c.innerHTML = `<span>${dayShort(i)}</span><span class="n">${n ? cntShort(n) : d.getDate()}</span>`;
    c.onclick = () => { selDay = k; show("day"); };
    $("bar").appendChild(c);
  }
  $("cap").textContent = isNowWeek ? tr("第 {0} / 7 天 · 点格子打开那天的日记", passed) : (weekStart > new Date() ? tr("还没到这周") : tr("点格子打开那天的日记"));

  // 这周的事：只标周几
  const sel = $("wkDay");
  if (!sel.options.length) WD.forEach((x, i) => { const o = document.createElement("option"); o.value = i; o.textContent = dayName(i); sel.appendChild(o); });
  if (document.activeElement !== sel && document.activeElement !== $("wkIn")) {
    const d = $("wkIn").value && Drafts.get("wkIn");   // 有草稿时用草稿选的周几
    sel.value = d && d.wd != null ? d.wd : isNowWeek ? weekday(new Date()) : 0;
  }
  $("wkForm").style.setProperty("--h", DAY_HUE[+sel.value]);
  // 越近的日子越靠上；同一天里按你排的顺序
  const ev = [...w.events].sort((a, b) => b.wd - a.wd);
  const box = $("wklog"); box.innerHTML = ""; let last = -1;
  if (!ev.length) box.innerHTML = `<div class="empty">${tr("还没有记下这周的事。")}</div>`;
  const folded = foldState(w.week);
  ev.forEach(e => {
    if (e.wd !== last) {
      last = e.wd;
      const n = ev.filter(x => x.wd === e.wd).length, isFold = folded.has(e.wd);
      const h = document.createElement("div"); h.className = "wday" + (isFold ? " folded" : ""); h.dataset.wd = e.wd; h.style.setProperty("--h", DAY_HUE[e.wd]);
      const name = document.createElement("span"); name.textContent = dayName(e.wd);
      const num = document.createElement("span"); num.className = "cnt"; num.textContent = isFold ? cnt(n) : "";
      const tg = document.createElement("button"); tg.type = "button"; tg.className = "fold"; tg.textContent = isFold ? tr("展开") : tr("收起");
      tg.setAttribute("aria-expanded", String(!isFold));
      tg.onclick = () => { isFold ? folded.delete(e.wd) : folded.add(e.wd); saveFold(w.week, folded); render(); };
      h.append(name, num, tg); box.appendChild(h);
    }
    const r = eventRow(w, e, true); if (folded.has(e.wd)) r.hidden = true; box.appendChild(r);
  });

  // 周目标
  $("goals").innerHTML = "";
  w.goals.forEach(g => {
    const li = document.createElement("li"); if (g.done) li.className = "ok";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!g.done; cb.id = "g_" + g.id;
    cb.onchange = () => { g.done = cb.checked; Store.save(w, { now: true }); render(); };
    const s = document.createElement("span"); s.textContent = g.text; s.title = tr("双击修改");
    s.ondblclick = () => inlineEdit(s, g.text, val => { g.text = val; Store.save(w, { now: true }); render(); });
    const x = xButton(() => { w.goals = w.goals.filter(y => y.id !== g.id); Store.save(w, { now: true }); render(); });
    li.append(cb, s, x); $("goals").appendChild(li);
  });

  const ta = $("review"); if (document.activeElement !== ta) ta.value = w.review;
  const ex = $("extra"); if (document.activeElement !== ex) ex.value = w.extra || "";
  $("extraSec").hidden = !(w.extra || "").trim() && document.activeElement !== ex;
  $("extraSec").classList.toggle("conflict", /^## 冲突副本/m.test(w.extra || ""));
  $("storeInfo").textContent = Store.dirName ? tr("数据文件夹：{0}/", Store.dirName) : IS_APP ? tr("只存在这个 App 里（卸载会清掉）") : tr("只存在这个浏览器里");
  $("linkDir").hidden = !Store.canLinkDir;
  if (Store.dirName) $("linkDir").textContent = tr("换一个文件夹");
}
// 每天的收起状态：只是这台设备上的显示偏好，存在浏览器里，不进 .md
function foldState(week) { try { return new Set(JSON.parse(localStorage.getItem("myweek-fold:" + week) || "[]")); } catch (e) { return new Set(); } }
function saveFold(week, set) { try { localStorage.setItem("myweek-fold:" + week, JSON.stringify([...set])); } catch (e) {} }

// 「这周的事」的一条：当天颜色的圆点（可拖动）、双击修改（修改时出现删除）
function eventRow(w, e, draggable) {
  const r = document.createElement("div"); r.className = "wrow"; r.dataset.id = e.id;
  r.style.setProperty("--h", DAY_HUE[e.wd]);
  const dot = document.createElement("span"); dot.className = "wdot";
  if (draggable) { dot.classList.add("grab"); dot.title = tr("拖动排序"); dot.onpointerdown = ev => startDrag(ev, r, w); }
  const tx = document.createElement("div"); tx.className = "tx"; tx.textContent = e.text; tx.title = tr("双击修改");
  tx.ondblclick = () => inlineEdit(tx, e.text, val => { e.text = val; Store.save(w, { now: true }); render(); });
  const a = document.createElement("div"); a.className = "acts";
  const bd = xButton(() => { w.events = w.events.filter(x => x.id !== e.id); Store.save(w, { now: true }); render(); });
  a.append(bd); r.append(dot, tx, a); return r;
}

// 叉叉：双击修改这一条时才出现；点一下变红，再点一下删除
function xButton(onDelete) {
  const b = document.createElement("button"); b.className = "x"; b.type = "button";
  b.setAttribute("aria-label", tr("删除")); b.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  b.onmousedown = ev => ev.preventDefault();   // 点叉叉时输入框不失焦，修改状态不会先被收掉
  b.onclick = () => {
    if (b.classList.contains("sure")) return onDelete();
    b.classList.add("sure"); b.title = tr("再点一下删除");
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
  const row = el.closest(".wrow, li"); if (row) row.classList.add("editing");   // 修改中：这一条的删除叉叉才显示
  const i = document.createElement("input"); i.className = "edit-in"; i.value = val; el.textContent = ""; el.appendChild(i); i.focus();
  let f = false; const fin = ok => { if (f) return; f = true; const s = i.value.trim(); if (ok && s && s !== val) save(s); else render(); };
  i.onkeydown = e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") fin(true); if (e.key === "Escape") fin(false); };
  i.onblur = () => fin(true);
}

/* ---- 日记页面 ---- */
function renderDay() {
  const d = fromKey(selDay), list = dayList(selDay);
  $("dayTitle").textContent = `${dayName(weekday(d))} · ${monthDay(d)}`;
  $("dayTitle").style.setProperty("--h", DAY_HUE[weekday(d)]);
  $("dayCount").textContent = list.length ? cnt(list.length) : "";
  $("dToday").hidden = selDay === dkey(new Date());
  // 置顶：这周的事里属于这一天的条目，用当天色卡作底色
  const w = Store.forDay(selDay), wd = weekday(d), pins = w.events.filter(e => e.wd === wd);
  const pin = $("pin"); pin.innerHTML = ""; pin.hidden = !pins.length; pin.style.setProperty("--h", DAY_HUE[wd]);
  if (pins.length) {
    const h = document.createElement("div"); h.className = "pin-h"; h.textContent = tr("这周的事") + " · " + dayName(wd); pin.appendChild(h);
    pins.forEach(e => pin.appendChild(eventRow(w, e, false)));
  }
  // 输入框：当天颜色的框，左边是此刻的时间
  $("dayForm").style.setProperty("--h", DAY_HUE[wd]); tickNow();
  // 越近越靠上：按时间倒序（子条目跟着父条目走，同一层内也倒序）
  // 正在一条条往下写（回车新起、Tab 缩进）时先不重排，离开编辑再排，免得新行跳走
  const sorted = holdSort ? list : sortTree(list);
  if (sorted.some((e, i) => e !== list[i])) { list.splice(0, list.length, ...sorted); Store.save(Store.forDay(selDay)); }
  const box = $("outline"); box.innerHTML = "";
  list.forEach(e => box.appendChild(bullet(e)));
  if (!list.length) { const p = document.createElement("div"); p.className = "hint"; p.style.margin = "0"; p.textContent = tr("这一天还空着。在上面的框里写一句，回车或点「记」记下，会自动带上此刻的时间。"); box.appendChild(p); }
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
    ts.innerHTML = `${pad(t.getHours())}:${pad(t.getMinutes())}` + (late ? `<small title="${tr("{0} 补记", `${t.getMonth() + 1}/${t.getDate()}`)}">${tr("补")}</small>` : "");
  } else { ts.classList.add("empty"); ts.textContent = "--:--"; }
  ts.title = tr("双击修改时间");
  ts.ondblclick = () => editTime(e, ts);
  const dot = document.createElement("div"); dot.className = "dot";
  const tx = document.createElement("div"); tx.className = "tx"; tx.dataset.ph = tr("写点什么");
  try { tx.contentEditable = "plaintext-only"; } catch (err) {}
  if (tx.contentEditable !== "plaintext-only") tx.contentEditable = "true";
  tx.textContent = e.text || "";
  tx.oninput = () => { e.text = tx.textContent; Store.save(Store.forDay(selDay)); drawTimeline(); };
  tx.onkeydown = ev => keys(ev, e, tx);
  tx.onfocus = () => { $("tools").hidden = false; $("tools").dataset.id = e.id; };
  tx.onblur = () => setTimeout(() => {
    if (!document.activeElement?.closest?.(".b,.tools")) { $("tools").hidden = true; dirty = false; holdSort = false; render(); }
  }, 150);
  const body = document.createElement("div"); body.className = "body"; body.appendChild(tx);
  // 删除这一条：点进去编辑时才出现；点一下变红，再点一下删除（有子条目的连它们一起删，图片也一起删）
  const list = dayList(selDay), at = list.findIndex(x => x.id === e.id), hasKids = at >= 0 && list[at + 1] && list[at + 1].indent > e.indent;
  const del = xButton(() => deleteEntry(e.id)); del.title = hasKids ? tr("删除这一条（连同下面的子条目）") : tr("删除这一条");
  body.appendChild(del);
  if (e.img || loading.some(j => j.target === e.id)) body.appendChild(thumbs(e));   // 正在解码的图也要显示出来（这一条原来还没有图时也一样）
  r.append(ts, dot, body); return r;
}

/* ---- 日记图片：缩略图、加图、点开看大图 ---- */
// 一张缩略图：右上角 × 删除；loading 时调暗并盖「解码中」；fail 是失败原因（盖「没加上」，鼠标放上去能看到原因）
function thumbBox({ src, loading, fail, onOpen, onDel }) {
  const w = document.createElement("div"); w.className = "th" + (loading ? " loading" : "") + (fail ? " failed" : "");
  if (fail) w.title = fail;
  const im = document.createElement("img"); im.alt = tr("日记图片"); if (src) im.src = src; if (onOpen) im.onclick = onOpen;
  w.appendChild(im);
  if (loading) { const l = document.createElement("span"); l.className = "ld"; l.textContent = fail ? tr("没加上") : tr("解码中"); w.appendChild(l); }
  const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", tr("删除这张图片"));
  x.onmousedown = ev => ev.preventDefault();   // 别让正在写的那条失去焦点
  x.onclick = ev => { ev.stopPropagation(); onDel(); };
  w.appendChild(x); return w;
}
let loading = [];   // 正在解码的图：{ f, url, target（条目 ID，null 是输入框）, day, cancelled, failed（失败原因，留在原地等用户点 × 去掉）}
const decoding = j => !j.failed;
function thumbs(e) {
  const box = document.createElement("div"); box.className = "imgs";
  (e.img || "").split(",").filter(Boolean).forEach(id => {
    const w = thumbBox({
      onOpen: () => openViewer(e, id),
      onDel: () => { if (!confirm(tr("删除这张图片？其他设备和服务器上的这张图也会一起删掉，无法恢复。"))) return; e.img = e.img.split(",").filter(x => x && x !== id).join(","); Store.save(Store.forDay(selDay), { now: true }); Img.remove(id); render(); },
    });
    Img.url(id, true).then(u => {
      if (u) { w.querySelector("img").src = u; return; }
      const m = document.createElement("div"); m.className = "miss"; m.textContent = Sync.enabled() ? tr("图片看不到：已被删除，或现在连不上服务器") : tr("图片不在这台设备上"); w.querySelector("img").replaceWith(m);
    });
    box.appendChild(w);
  });
  loading.filter(j => j.target === e.id).forEach(j => box.appendChild(loadingBox(j)));
  return box;
}
const loadingBox = j => thumbBox({ src: j.url, loading: true, fail: j.failed, onDel: () => { j.cancelled = true; loading = loading.filter(x => x !== j); URL.revokeObjectURL(j.url); j.target == null ? renderPend() : render(); } });
let viewing = null, picTarget = null, pend = [];
function openViewer(e, id) {
  Img.url(id, false).then(u => {
    if (!u) return;
    viewing = { e, id }; $("imgBig").src = u;
    try { history.pushState({ img: 1 }, "", location.href); } catch (err) {}   // 安卓返回键先关大图
    $("imgDlg").showModal();
  });
}
$("imgDlg").onclick = ev => { if (ev.target.closest(".viewer-bar button") === null) $("imgDlg").close(); };
$("imgClose").onclick = () => $("imgDlg").close();
$("imgDlg").addEventListener("close", () => { if (history.state && history.state.img) history.back(); });

/* ---- 更新后第一次打开：新功能弹窗（whatsnew.js） ---- */
function showWhatsNew() {
  const notes = WhatsNew.pending(APP_VERSION, Store.localIds().length > 0 || Sync.enabled());
  if (!notes.length) { WhatsNew.seen(APP_VERSION); return; }
  $("newTitle").textContent = tr("新功能 · v{0}", APP_VERSION);
  const body = $("newBody"); body.textContent = "";
  notes.forEach(n => {
    if (notes.length > 1) { const h = document.createElement("div"); h.className = "new-ver"; h.textContent = "v" + n.version; body.appendChild(h); }
    const ul = document.createElement("ol"); ul.className = "new-list";   // 有序列表：一条一条数着看
    n.items.forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    body.appendChild(ul);
  });
  try { history.pushState({ dlg: 1 }, "", location.href); } catch (err) {}   // 安卓返回键先关弹窗
  $("newDlg").showModal();
}
$("newDlg").addEventListener("close", () => { WhatsNew.seen(APP_VERSION); if (history.state && history.state.dlg) history.back(); });
$("newOk").onclick = $("newClose").onclick = () => $("newDlg").close();
$("imgDel").onclick = ev => {
  ev.stopPropagation(); if (!viewing || !confirm(tr("删除这张图片？其他设备和服务器上的这张图也会一起删掉，无法恢复。"))) return;
  const { e, id } = viewing;
  e.img = e.img.split(",").filter(x => x && x !== id).join(",");
  Store.save(Store.forDay(selDay), { now: true }); Img.remove(id); $("imgDlg").close(); render();
};
function renderPend() {
  const box = $("dayPend"); box.innerHTML = ""; box.hidden = !pend.length && !loading.some(j => j.target == null);
  pend.forEach(id => {
    const w = thumbBox({ onDel: () => { pend = pend.filter(x => x !== id); Img.remove(id); renderPend(); } });
    Img.url(id, true).then(u => { if (u) w.querySelector("img").src = u; });
    box.appendChild(w);
  });
  loading.filter(j => j.target == null).forEach(j => box.appendChild(loadingBox(j)));
}
$("dayPic").onclick = () => { picTarget = null; $("picFile").click(); };
$("tPic").onmousedown = ev => ev.preventDefault();
$("tPic").onclick = () => { picTarget = tid(); $("picFile").click(); };
// 选好图后：马上显示调暗的预览和「解码中」，好了换成缩略图。
// 全局排队，一次只解一张（几张大图同时解会把手机内存撑爆）；失败的不悄悄消失，留一个标着「没加上」的格子，原因放在鼠标提示和状态栏里。
let decodeChain = Promise.resolve();
async function addPicked(files, target) {
  const day = selDay, jobs = files.map(f => ({ f, url: URL.createObjectURL(f), target, day, cancelled: false }));
  loading.push(...jobs); const redraw = () => (target == null ? renderPend() : render()); redraw();
  for (const j of jobs) {
    if (!j.cancelled) {
      try {
        const run = decodeChain.then(() => Img.add(j.f)); decodeChain = run.catch(() => {});
        const id = await run;
        if (j.cancelled) Img.remove(id);   // 解码中被取消的，刚存下的也删掉
        else {
          if (target == null) pend.push(id);
          else { const en = dayList(day).find(x => x.id === target); if (en) { en.img = [en.img, id].filter(Boolean).join(","); Store.save(Store.forDay(day), { now: true }); } }
        }
      } catch (err) {
        console.error("[图片]", j.f.name, j.f.type, j.f.size, err);
        if (!j.cancelled) { j.failed = err.message; status(tr("图片没加上：{0}", err.message)); redraw(); continue; }   // 留在原地，用户点 × 才去掉
      }
    }
    loading = loading.filter(x => x !== j); URL.revokeObjectURL(j.url); redraw();
  }
}
// 粘贴图片（截图、复制的图片文件）：在输入框里粘贴 = 加到待记的图；在某一条里粘贴 = 加到这一条。只有粘贴板里有图时才接管，文字照常粘贴
document.addEventListener("paste", ev => {
  if (view !== "day" || $("imgDlg").open) return;
  const files = [...(ev.clipboardData ? ev.clipboardData.files : [])].filter(f => f.type.startsWith("image/"));
  if (!files.length) return;
  ev.preventDefault();
  const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".b") : null;
  addPicked(files, row ? row.dataset.id : null);
});
$("picFile").onchange = ev => { const files = [...ev.target.files]; ev.target.value = ""; const target = picTarget; picTarget = null; if (files.length) addPicked(files, target); };
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
// 删掉一条日记：连同它下面的子条目；里面的图片也一起删（本机、服务器和别的设备上的）
function deleteEntry(id) {
  const list = dayList(selDay), idx = list.findIndex(x => x.id === id); if (idx < 0) return;
  let end = idx + 1; while (end < list.length && list[end].indent > list[idx].indent) end++;
  list.splice(idx, end - idx).forEach(g => (g.img || "").split(",").filter(Boolean).forEach(i => Img.remove(i)));
  Store.save(Store.forDay(selDay), { now: true });
  $("tools").hidden = true; dirty = false; holdSort = false; render();
}
function focusId(id) {
  const el = document.querySelector(`.b[data-id="${id}"] .tx`); if (!el) return; el.focus();
  const s = getSelection(), rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
}
function newAfter(id) {
  const list = dayList(selDay), idx = id ? list.findIndex(x => x.id === id) : list.length - 1;
  const e = { id: MD.newId(), ts: Date.now(), indent: idx >= 0 ? list[idx].indent : 0, text: "", img: "" };
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
  else if (ev.key === "Backspace" && !tx.textContent && !e.img) {
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
  ev.preventDefault(); const s = $("dayIn").value.trim(); if (!s && !pend.length && !loading.some(j => j.target == null && decoding(j))) return;
  if (loading.some(j => j.target == null && decoding(j))) { status(tr("图片还在解码，好了再记")); return; }
  const list = dayList(selDay);
  list.unshift({ id: MD.newId(), ts: Date.now(), indent: 0, text: s, img: pend.join(",") });   // 最新的在最上面
  pend = []; renderPend();
  Store.save(Store.forDay(selDay), { now: true }); $("dayIn").value = ""; draftChanged("dayIn"); render(); $("dayIn").focus();
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
  const item = { id: MD.newId(), wd, text: s };
  if (at < 0) w.events.push(item); else w.events.splice(at, 0, item);   // 新记的放在那天最上面
  const f = foldState(w.week); if (f.delete(wd)) saveFold(w.week, f);   // 记到收起的那天就自动展开
  Store.save(w, { now: true }); $("wkIn").value = ""; draftChanged("wkIn"); render(); $("wkIn").focus();
};
$("goalForm").onsubmit = ev => {
  ev.preventDefault(); const s = $("goalIn").value.trim(); if (!s) return;
  const w = Store.get(dkey(weekStart));
  w.goals.push({ id: MD.newId(), text: s, done: false });
  Store.save(w, { now: true }); $("goalIn").value = ""; draftChanged("goalIn"); render();
};

/* ---- 草稿：输入框里还没记下的字，存在本机，关掉再打开还在（drafts.js） ---- */
const DRAFT_INPUTS = ["dayIn", "wkIn", "goalIn"];
// 有字、又没在输入时，在框里标「未记下」
function draftTag(id) {
  const i = $(id), tag = i.parentElement.querySelector(".draft-tag");
  if (tag) tag.hidden = !i.value.trim() || document.activeElement === i;
}
function draftChanged(id) {
  Drafts.set(id, $(id).value, id === "wkIn" ? { wd: +$("wkDay").value } : null);
  draftTag(id);
}
DRAFT_INPUTS.forEach(id => {
  const i = $(id), d = Drafts.get(id);
  if (d && !i.value) i.value = d.text;   // 「这周的事」草稿选的周几，在 render 里设（那时周几的选项才建好）
  i.addEventListener("input", () => draftChanged(id));
  i.addEventListener("focus", () => draftTag(id));
  i.addEventListener("blur", () => draftTag(id));
  draftTag(id);
});
$("wkDay").addEventListener("change", () => { if ($("wkIn").value.trim()) draftChanged("wkIn"); });
$("extra").oninput = () => { const w = Store.get(dkey(weekStart)); w.extra = $("extra").value; Store.save(w); };
$("review").oninput = () => { const w = Store.get(dkey(weekStart)); w.review = $("review").value; Store.save(w); };
$("prev").onclick = () => { weekStart = addDays(weekStart, -7); render(); };
$("next").onclick = () => { weekStart = addDays(weekStart, 7); render(); };
$("now").onclick = () => { weekStart = monday(new Date()); render(); };

/* ---- 存储按钮 ---- */
$("linkDir").onclick = async () => {
  try {
    if ($("linkDir").dataset.regrant) { await Store.regrant(); delete $("linkDir").dataset.regrant; render(); return; }
    const n = await Store.linkDir(); status(tr("已连接，读入 {0} 周", n));
  } catch (e) { if (e.name !== "AbortError") status(tr("没连上：{0}", e.message)); }
};
$("exportWk").onclick = async () => { try { await Store.exportWeek(Store.get(dkey(weekStart))); } catch (e) { if (!/cancel/i.test(e.message || "")) status(tr("导出失败：{0}", e.message)); } };
$("importWk").onclick = () => $("importFile").click();
$("importFile").onchange = async () => { const n = await Store.importFiles([...$("importFile").files]); status(tr("导入了 {0} 周", n)); $("importFile").value = ""; };

/* ---- 历史版本（本机快照） ---- */
const when = t => { const d = new Date(t); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// 一周里的条目，用来和现在比「多了几条、少了几条」
const itemsOf = w => [...w.goals.map(g => "g" + g.text), ...w.events.map(e => "e" + e.wd + e.text),
                      ...Object.entries(w.days).flatMap(([k, l]) => l.map(e => "d" + k + e.ts + e.text)), ...(w.review.trim() ? ["r" + w.review.trim()] : [])];
function diffText(snap, cur) {
  const a = new Set(itemsOf(snap)), b = new Set(itemsOf(cur));
  const more = [...a].filter(x => !b.has(x)).length, less = [...b].filter(x => !a.has(x)).length;
  return more || less ? tr("比现在") + (more ? tr(" 多 {0} 条", more) : "") + (less ? tr(" 少 {0} 条", less) : "") : tr("条目和现在一样");
}
let histWeek = null, histPick = null;
async function openHist() {
  const cur = Store.get(dkey(weekStart)); histWeek = cur.week;
  $("histTitle").textContent = tr("{0} 的历史版本", cur.week);
  $("histView").hidden = true; $("histList").hidden = false;
  const list = await Snap.list(histWeek), ul = $("histList"); ul.textContent = "";
  if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = tr("这一周在这台设备上还没有存过旧版本。"); ul.append(li); }
  for (const s of list) {
    const li = document.createElement("li"), b = document.createElement("button"); b.type = "button";
    let d = ""; try { d = diffText(MD.parse(s.text), cur); } catch (e) { d = tr("读不懂"); }
    const t = document.createElement("time"), why = document.createElement("span"), df = document.createElement("span");
    t.textContent = when(s.at); why.className = "why"; why.textContent = Snap.label(s.reason); df.className = "diff"; df.textContent = d;
    b.append(t, why, df); b.onclick = () => showSnap(s); li.append(b); ul.append(li);
  }
  if (!$("histDlg").open) $("histDlg").showModal();
}
function showSnap(s) {
  histPick = s;
  $("histMeta").textContent = `${when(s.at)} · ${Snap.label(s.reason)}`;
  $("histText").textContent = s.text;
  $("histList").hidden = true; $("histView").hidden = false;
}
$("histWk").onclick = () => openHist().catch(e => status(tr("历史版本打不开：{0}", e.message)));
$("histClose").onclick = () => $("histDlg").close();
$("histBack").onclick = () => { $("histView").hidden = true; $("histList").hidden = false; };
$("histRestore").onclick = async () => {
  if (!histPick || !confirm(tr("把 {0} 换成 {1} 的这一版？现在的内容会先存成一份历史版本，恢复后会同步到其他设备。", histWeek, when(histPick.at)))) return;
  await Store.restore(histWeek, histPick.text);
  $("histDlg").close(); render(); status(tr("已恢复成 {0} 的版本", when(histPick.at)));
};

/* ---- 同步记录 ---- */
function renderLog() {
  if (!$("logBox").open) return;
  const ul = $("logList"); ul.textContent = "";
  const l = Sync.log;
  if (!l.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = tr("还没有记录。上传、下载、合并和出错都会记在这里。"); ul.append(li); return; }
  for (const x of l.slice(0, 100)) {
    const li = document.createElement("li"), t = document.createElement("time"), s = document.createElement("span");
    li.className = "k-" + x.kind; t.textContent = when(x.at); s.textContent = x.text + (x.n > 1 ? tr("（连续 {0} 次）", x.n) : "");
    li.append(t, s); ul.append(li);
  }
}
$("logBox").addEventListener("toggle", renderLog);
$("logClear").onclick = () => { Sync.clearLog(); renderLog(); };

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

/* ---- App 新版本（updates.js）：开了同步的自动查（一天一次），没开同步的只在点「检查更新」时查 ---- */
function showAppUpdate() {
  const p = IS_APP && Updates.pending();
  $("appUpd").hidden = !p;
  if (p) $("appUpdGo").textContent = tr("新版本 v{0} · 点这里下载", p.version);
}
const autoCheckUpdate = () => {
  if (!IS_APP || !navigator.onLine) return;
  Updates.check({ auto: true, syncOn: Sync.enabled() }).then(showAppUpdate).catch(() => {});   // 自动检查失败不打扰
};
$("checkUpd").hidden = !IS_APP;
$("checkUpd").title = tr("当前版本 v{0}", APP_VERSION);
$("checkUpd").onclick = async () => {
  status(tr("正在检查更新…"));
  try {
    const r = await Updates.check();
    if (r.update) { Updates.dismiss(null); showAppUpdate(); status(tr("有新版本 v{0}（来自 {1}），点底部的提示下载", r.version, r.source)); }
    else status(tr("已经是最新版本 v{0}", APP_VERSION));
  } catch (e) { status(e.message); }
};
$("appUpdGo").onclick = async () => {
  const p = Updates.pending(); if (!p) return;
  if (!confirm(tr("在浏览器里打开 {0} 上的 v{1} 安装包。\n\n下载后直接点开安装，覆盖现在的 App，日记、草稿、同步设置都会保留。不要先卸载。\n\n如果安卓提示「签名不一致」或要求先卸载旧版，说明这个安装包不是正版，不要安装。", p.source, p.version))) return;
  try { await Store.flush(); } catch (e) {}
  location.href = p.url;   // App 里打开别的网址会交给系统浏览器，不会离开 App 本身
};
$("appUpdX").onclick = () => { const p = Updates.pending(); if (p) Updates.dismiss(p.version); showAppUpdate(); };
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoCheckUpdate(); });

/* ---- 启动 ---- */
(function () {
  const h = location.hash;
  if (/^#d\d{4}-\d{2}-\d{2}$/.test(h)) { selDay = h.slice(2); weekStart = monday(fromKey(selDay)); view = "day"; $("weekView").hidden = true; $("dayView").hidden = false;
    try { history.replaceState(null, "", "#week"); history.pushState({ day: 1 }, "", h); } catch (e) {}   // 直接打开日记页时，返回键也先回周记
  }
  render();
  syncInfo(); Sync.soon(300);
  showAppUpdate(); setTimeout(autoCheckUpdate, 3000);   // 等第一轮同步先跑
  setTimeout(showWhatsNew, 600);
  Store.restoreDir().then(r => {
    if (r === "lost") status(tr("之前选的文件夹没有权限了（可能被移动或删除），请重新「连接数据文件夹」"));
    if (r === "prompt") { $("linkDir").textContent = tr("重新连接数据文件夹"); $("linkDir").dataset.regrant = 1; status(tr("点“重新连接数据文件夹”继续写入文件")); }
  }).catch(() => {});
})();
