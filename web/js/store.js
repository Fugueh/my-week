// 按周存储，格式是 Markdown（见 markdown.js）。
// 总是存进浏览器 localStorage（键 myweek:2026-W42，值是那周的 .md 全文）；
// 连接了数据文件夹时，同时写成文件夹里的 2026-W42.md。
// 你在编辑器里改过的文件，页面会在写入前发现并先读回来，不会覆盖。
const Store = (() => {
  const PREFIX = "myweek:";
  const cache = new Map();          // "2026-W42" -> week object
  const seen = new Map();           // "2026-W42" -> 上次读写时文件的 lastModified
  const timers = new Map();
  let dir = null;
  let onChange = () => {}, onStatus = () => {}, onDirty = () => {}, onSaved = () => {};

  function blank(startKey) {
    const s = fromKey(startKey);
    return { schema: 1, week: isoWeek(s), start: startKey, end: dkey(addDays(s, 6)), updated: null,
             events: [], goals: [], review: "", days: {}, extra: "" };
  }
  function isEmpty(w) {
    return !w.events.length && !w.goals.length && !w.review.trim() && !(w.extra || "").trim() &&
           !Object.values(w.days).some(a => a.length);
  }
  function readLocal(id) {
    try { const raw = localStorage.getItem(PREFIX + id); if (raw) return MD.parse(raw); } catch (e) {}
    return null;
  }
  function writeLocal(w) {
    try { if (isEmpty(w)) localStorage.removeItem(PREFIX + w.week); else localStorage.setItem(PREFIX + w.week, MD.serialize(w)); }
    catch (e) { onStatus("浏览器存储写不进去：" + e.message); }
  }

  function get(startKey) {
    const id = isoWeek(fromKey(startKey));
    if (!cache.has(id)) cache.set(id, readLocal(id) || blank(startKey));
    return cache.get(id);
  }
  const forDay = dayKey => get(dkey(monday(fromKey(dayKey))));

  // 改完某周后调用；默认延迟 600ms 合并连续输入
  function save(w, { now = false } = {}) {
    w.updated = new Date().toISOString();
    onDirty(w.week);
    clearTimeout(timers.get(w.week));
    const go = async () => {
      timers.delete(w.week);
      if (dir && !isEmpty(w)) {
        try {
          const name = w.week + ".md";
          let fh = null;
          try { fh = await dir.getFileHandle(name); } catch (e) {}
          if (fh) {
            const f = await fh.getFile();
            if (seen.has(w.week) && f.lastModified > seen.get(w.week)) {
              // 文件在外面被改过：以文件为准，丢弃这次页面上的改动
              const fresh = MD.parse(await f.text());
              cache.set(w.week, fresh); seen.set(w.week, f.lastModified); writeLocal(fresh);
              onStatus(`${name} 在别处被改过，已重新读入（页面上刚才的改动没有写进去）`); onChange(); return;
            }
          } else fh = await dir.getFileHandle(name, { create: true });
          const ws = await fh.createWritable(); await ws.write(MD.serialize(w)); await ws.close();
          seen.set(w.week, (await fh.getFile()).lastModified);
          onStatus("已存到 " + name);
        } catch (e) { onStatus("文件没写成：" + e.message); }
      }
      writeLocal(w); onSaved(w.week);
    };
    if (now) return go();
    timers.set(w.week, setTimeout(go, 600));
  }

  // 合并一份外来的周（导入）：updated 更新的那份胜出
  function merge(w) {
    const cur = get(w.start);
    if (isEmpty(cur) || !cur.updated || (w.updated && w.updated > cur.updated)) { cache.set(w.week, w); writeLocal(w); return true; }
    return false;
  }

  /* ---- 数据文件夹（Chrome / Edge 桌面版支持） ---- */
  const canLinkDir = "showDirectoryPicker" in window;
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open("myweek", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { const tx = r.result.transaction("kv", mode); const q = fn(tx.objectStore("kv")); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); };
      r.onerror = () => rej(r.error);
    });
  }
  // 读文件夹里所有 2026-Wnn.md；文件夹里的版本优先
  async function readDir({ quiet = false } = {}) {
    let n = 0; const found = new Set();
    for await (const [name, h] of dir.entries()) {
      const m = name.match(/^(\d{4}-W\d{2})\.md$/); if (h.kind !== "file" || !m) continue;
      found.add(m[1]);
      if (timers.has(m[1])) continue;                       // 正在等着写入的周先不动
      const f = await h.getFile();
      if (seen.get(m[1]) === f.lastModified) continue;      // 没变过
      try {
        const w = MD.parse(await f.text());
        cache.set(w.week, w); seen.set(w.week, f.lastModified); writeLocal(w); n++;
      } catch (e) { onStatus(`${name} 读不懂：${e.message}`); }
    }
    if (!quiet) {   // 浏览器里有、文件夹里没有的周，补写成文件
      loadAllLocal();
      for (const w of cache.values()) if (!isEmpty(w) && !found.has(w.week)) save(w, { now: true });
    }
    return n;
  }
  async function attach(h) { dir = h; const n = await readDir(); onChange(); return n; }
  async function linkDir() {
    const h = await window.showDirectoryPicker({ id: "myweek", mode: "readwrite" });
    seen.clear(); try { await idb("readwrite", s => s.put(h, "dir")); } catch (e) {}
    return attach(h);
  }
  async function restoreDir() {
    if (!canLinkDir) return "unsupported";
    let h = null; try { h = await idb("readonly", s => s.get("dir")); } catch (e) {}
    if (!h) return "none";
    if (await h.queryPermission({ mode: "readwrite" }) === "granted") { await attach(h); return "granted"; }
    restoreDir.pending = h; return "prompt";
  }
  async function regrant() {
    const h = restoreDir.pending; if (!h) return false;
    if (await h.requestPermission({ mode: "readwrite" }) !== "granted") return false;
    await attach(h); return true;
  }
  // 切回这个页面时，把在编辑器里改过的文件读回来
  async function refresh() {
    if (!dir) return;
    try { if (await readDir({ quiet: true })) onChange(); } catch (e) {}
  }
  function loadAllLocal() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!k.startsWith(PREFIX)) continue;
        const id = k.slice(PREFIX.length); if (cache.has(id)) continue;
        const w = readLocal(id); if (w) cache.set(id, w);
      }
    } catch (e) {}
  }

  /* ---- 导出 / 导入 ---- */
  async function exportWeek(w) {
    if (IS_APP) {
      // App 里没法直接下载文件：先写进缓存目录，再弹出系统的分享面板（存到文件、发给微信都行）
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const { uri } = await Filesystem.writeFile({ path: w.week + ".md", data: MD.serialize(w), directory: "CACHE", encoding: "utf8" });
      await Share.share({ title: w.week + ".md", files: [uri] });
      return;
    }
    const blob = new Blob([MD.serialize(w)], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = w.week + ".md";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importFiles(files) {
    let n = 0;
    for (const f of files) {
      try { const w = MD.parse(await f.text()); if (merge(w)) { n++; if (dir) await save(cache.get(w.week), { now: true }); } }
      catch (e) { onStatus(`${f.name} 读不懂：${e.message}`); }
    }
    onChange(); return n;
  }

  return {
    get, forDay, save, linkDir, restoreDir, regrant, refresh, exportWeek, importFiles, canLinkDir,
    get dirName() { return dir ? dir.name : null; },
    hooks(h) {
      onChange = h.onChange || onChange; onStatus = h.onStatus || onStatus;
      onDirty = h.onDirty || onDirty; onSaved = h.onSaved || onSaved;
    },
    // 给同步用：
    pending: id => timers.has(id),
    byId: id => { if (!cache.has(id)) { const w = readLocal(id); if (w) cache.set(id, w); } return cache.get(id) || null; },
    localIds() { loadAllLocal(); return [...cache.values()].filter(w => !isEmpty(w)).map(w => w.week); },
    // 用服务器上的版本替换本地这一周（不改 updated，不算本地改动）
    async replace(w) {
      cache.set(w.week, w); writeLocal(w);
      if (dir) {
        try {
          const fh = await dir.getFileHandle(w.week + ".md", { create: true });
          const ws = await fh.createWritable(); await ws.write(MD.serialize(w)); await ws.close();
          seen.set(w.week, (await fh.getFile()).lastModified);
        } catch (e) {}
      }
      onChange();
    },
  };
})();
