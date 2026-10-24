// 按周存储，格式是 Markdown（见 markdown.js）。
// 总是存进浏览器 localStorage（键 myweek:2026-W42，值是那周的 .md 全文）；
// 连接了数据文件夹时，同时写成文件夹里的 2026-W42.md（明文，用任何编辑器都能改）。
// 文件夹有两种实现，方法一样：电脑上的 Chrome / Edge 用 File System Access，
// 安卓 App 用原生插件 FolderStore（系统的文件夹选择器，授权会一直保留）。
// 你在编辑器里改过的文件，页面会在写入前发现并先读回来，不会覆盖。
// 本机内容每次被别的东西换掉之前，先交给 Snap（history.js）存一份快照，「历史版本」里能恢复。
const Store = (() => {
  const PREFIX = "myweek:";
  const cache = new Map();          // "2026-W42" -> week object
  const seen = new Map();           // "2026-W42" -> 上次读写时文件的 lastModified
  const timers = new Map();
  const queued = new Map();         // "2026-W42" -> { w, go }：还在 600ms 等待里的改动，flush() 用
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
    catch (e) { onStatus(tr("浏览器存储写不进去：{0}", e.message)); }
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
    const go = async (flushed = false) => {
      timers.delete(w.week); queued.delete(w.week);
      if (dir && !isEmpty(w)) {
        try {
          const name = w.week + ".md";
          const mtime = await dir.stat(name);
          if (mtime != null && seen.has(w.week) && mtime > seen.get(w.week)) {
            // 文件在外面被改过：以文件为准，丢弃这次页面上的改动
            const f = await dir.read(name), fresh = MD.parse(f.text);
            Snap.keep(w.week, MD.serialize(w), "folder");      // 页面上没写进去的那份留个快照
            cache.set(w.week, fresh); seen.set(w.week, f.lastModified); writeLocal(fresh);
            onStatus(tr("{0} 在别处被改过，已重新读入（页面上刚才的改动没有写进去）", name)); onChange(); return;
          }
          seen.set(w.week, await dir.write(name, MD.serialize(w)));
          onStatus(tr("已存到 {0}", name));
        } catch (e) { onStatus(tr("文件没写成：{0}", e.message)); }
      }
      if (!flushed) keepEdit(w.week);
      writeLocal(w); onSaved(w.week);
    };
    if (now) return go();
    timers.set(w.week, setTimeout(go, 600)); queued.set(w.week, { w, go });
  }
  // 页面要被关掉或切到后台时调用：把还在等待的改动立刻写进本机存储。
  // localStorage 是同步写的，这一步一定能完成；写文件夹是异步的，来不来得及看运气。
  function flush() {
    return Promise.all([...queued].map(([id, { w, go }]) => { clearTimeout(timers.get(id)); keepEdit(id); writeLocal(w); return go(true); }));
  }
  // 自己编辑：把这次写入之前本机存着的那份交给快照（快照那边限制每 10 分钟最多一份）
  function keepEdit(id) {
    let prev = null; try { prev = localStorage.getItem(PREFIX + id); } catch (e) {}
    if (prev) Snap.keep(id, prev, "edit");
  }

  // 把某一周恢复成一份历史快照：当作一次本地编辑，会同步到其他设备。现在的内容先存成快照
  async function restore(id, text) {
    const cur = cache.get(id) || readLocal(id);
    if (cur && !isEmpty(cur)) await Snap.keep(id, MD.serialize(cur), "restore");
    const w = MD.parse(text);
    cache.set(id, w); await save(w, { now: true }); onChange();
    return w;
  }

  // 合并一份外来的周（导入）：updated 更新的那份胜出
  function merge(w) {
    const cur = get(w.start);
    if (isEmpty(cur) || !cur.updated || (w.updated && w.updated > cur.updated)) {
      if (!isEmpty(cur)) Snap.keep(w.week, MD.serialize(cur), "import");
      cache.set(w.week, w); writeLocal(w); return true;
    }
    return false;
  }

  /* ---- 数据文件夹 ---- */
  const FolderPlugin = () => window.Capacitor.Plugins.FolderStore;
  const hasAppFolder = IS_APP && !!(window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable("FolderStore"));
  const canLinkDir = hasAppFolder || (!IS_APP && "showDirectoryPicker" in window);
  // 两种后端，同一组方法：list() → [{name, lastModified}]，read(name) → {text, lastModified} 或 null，
  // stat(name) → lastModified 或 null，write(name, text) → 写完后的 lastModified
  function webFolder(h) {
    const file = async name => { try { return await (await h.getFileHandle(name)).getFile(); } catch (e) { return null; } };
    return {
      name: h.name,
      async list() { const out = []; for await (const [name, e] of h.entries()) if (e.kind === "file") out.push({ name, lastModified: (await e.getFile()).lastModified }); return out; },
      async read(name) { const f = await file(name); return f ? { text: await f.text(), lastModified: f.lastModified } : null; },
      async stat(name) { const f = await file(name); return f ? f.lastModified : null; },
      async write(name, text) {
        const fh = await h.getFileHandle(name, { create: true });
        const ws = await fh.createWritable(); await ws.write(text); await ws.close();
        return (await fh.getFile()).lastModified;
      },
    };
  }
  function appFolder({ uri, name }) {
    const P = FolderPlugin();
    return {
      name,
      list: async () => (await P.list({ uri })).files,
      read: async n => { try { return await P.read({ uri, name: n }); } catch (e) { return null; } },
      stat: async n => (await P.stat({ uri, name: n })).lastModified ?? null,
      write: async (n, text) => (await P.write({ uri, name: n, text })).lastModified,
    };
  }
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
    for (const { name, lastModified } of await dir.list()) {
      const m = name.match(/^(\d{4}-W\d{2})\.md$/); if (!m) continue;
      found.add(m[1]);
      if (timers.has(m[1])) continue;                       // 正在等着写入的周先不动
      if (seen.get(m[1]) === lastModified) continue;        // 没变过
      try {
        const f = await dir.read(name), w = MD.parse(f.text);
        const prev = cache.get(w.week) || readLocal(w.week);
        const changed = !prev || MD.serialize(prev) !== MD.serialize(w);
        if (changed && prev && !isEmpty(prev)) Snap.keep(w.week, MD.serialize(prev), "folder");
        cache.set(w.week, w); seen.set(w.week, f.lastModified); writeLocal(w);
        if (changed) { n++; onDirty(w.week); onSaved(w.week); }   // 在编辑器里改过的，也要同步上去
      } catch (e) { onStatus(tr("{0} 读不懂：{1}", name, e.message)); }
    }
    if (!quiet) {   // 本机存储里有、文件夹里没有的周，补写成文件
      loadAllLocal();
      for (const w of cache.values()) if (!isEmpty(w) && !found.has(w.week)) await save(w, { now: true });
    }
    return n;
  }
  async function attach(folder) { dir = folder; const n = await readDir(); onChange(); return n; }
  async function linkDir() {
    seen.clear();
    if (hasAppFolder) {
      const r = await FolderPlugin().pick();          // 系统的文件夹选择器
      try { localStorage.setItem("myweek-folder", JSON.stringify(r)); } catch (e) {}
      return attach(appFolder(r));
    }
    const h = await window.showDirectoryPicker({ id: "myweek", mode: "readwrite" });
    try { await idb("readwrite", s => s.put(h, "dir")); } catch (e) {}
    return attach(webFolder(h));
  }
  async function restoreDir() {
    if (!canLinkDir) return "unsupported";
    if (hasAppFolder) {
      let saved = null; try { saved = JSON.parse(localStorage.getItem("myweek-folder")); } catch (e) {}
      if (!saved) return "none";
      if ((await FolderPlugin().hasAccess({ uri: saved.uri })).ok) { await attach(appFolder(saved)); return "granted"; }
      return "lost";                                  // 授权没了（比如文件夹被删了），要重新选
    }
    let h = null; try { h = await idb("readonly", s => s.get("dir")); } catch (e) {}
    if (!h) return "none";
    if (await h.queryPermission({ mode: "readwrite" }) === "granted") { await attach(webFolder(h)); return "granted"; }
    restoreDir.pending = h; return "prompt";
  }
  async function regrant() {
    const h = restoreDir.pending; if (!h) return false;
    if (await h.requestPermission({ mode: "readwrite" }) !== "granted") return false;
    await attach(webFolder(h)); return true;
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
      catch (e) { onStatus(tr("{0} 读不懂：{1}", f.name, e.message)); }
    }
    onChange(); return n;
  }

  return {
    get, forDay, save, flush, restore, linkDir, restoreDir, regrant, refresh, exportWeek, importFiles, canLinkDir,
    get dirName() { return dir ? dir.name : null; },
    get queuedCount() { return queued.size; },   // 还在防抖里没写进本机的周数
    hooks(h) {
      onChange = h.onChange || onChange; onStatus = h.onStatus || onStatus;
      onDirty = h.onDirty || onDirty; onSaved = h.onSaved || onSaved;
    },
    // 给同步用：
    pending: id => timers.has(id),
    byId: id => { if (!cache.has(id)) { const w = readLocal(id); if (w) cache.set(id, w); } return cache.get(id) || null; },
    localIds() { loadAllLocal(); return [...cache.values()].filter(w => !isEmpty(w)).map(w => w.week); },
    // 用服务器上的版本（或合并结果）替换本地这一周（不改 updated，不算本地改动）。换掉之前先留快照
    async replace(w, reason = "pull") {
      const cur = cache.get(w.week) || readLocal(w.week);
      if (cur && !isEmpty(cur)) Snap.keep(w.week, MD.serialize(cur), reason);
      cache.set(w.week, w); writeLocal(w);
      if (dir) { try { seen.set(w.week, await dir.write(w.week + ".md", MD.serialize(w))); } catch (e) {} }
      onChange();
    },
  };
})();
