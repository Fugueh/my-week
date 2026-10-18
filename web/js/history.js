// 本地快照（参照 Obsidian 的「文件恢复」）。
// 本机某一周的内容每次要被别的东西换掉之前——从服务器拉取、合并、从文件夹读回、导入、恢复旧版——先把旧的存一份；
// 自己编辑时，每 10 分钟最多存一份编辑前的样子。合并时如果另一台设备的某条被替换了，服务器上那一版也存一份。
// 只存在这台设备上（IndexedDB），不上传：没网也能用，开了加密也不用去解密服务器上的东西。
// 每周保留最近 30 份；和上一份内容一样的不重复存。
const Snap = (() => {
  const KEEP = 30, EDIT_GAP = 10 * 60 * 1000;
  const REASON = {
    pull: "拉取服务器的版本之前", merge: "合并之前", server: "合并时服务器上的版本（另一台设备改的）",
    folder: "从文件夹读回之前", import: "导入之前", restore: "恢复旧版之前", edit: "编辑之前",
  };
  const same = (a, b) => a.replace(/^updated:.*$/m, "") === b.replace(/^updated:.*$/m, "");

  // 存储后端：浏览器里用 IndexedDB；没有 IndexedDB 或打不开（测试、无痕窗口）就只放在内存里
  let mem = [], memId = 0;
  const memory = {
    all: async week => mem.filter(r => r.week === week),
    add: async rec => { mem.push({ ...rec, id: ++memId }); },
    del: async ids => { mem = mem.filter(r => !ids.includes(r.id)); },
  };
  let backend = null;
  function pick() {
    if (backend) return backend;
    if (typeof indexedDB === "undefined") return (backend = Promise.resolve(memory));
    return (backend = new Promise(res => {
      const r = indexedDB.open("myweek-snaps", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("snaps", { keyPath: "id", autoIncrement: true }).createIndex("week", "week");
      r.onerror = () => res(memory);
      r.onsuccess = () => {
        const d = r.result;
        const tx = (mode, fn) => new Promise((ok, no) => {
          const t = d.transaction("snaps", mode), q = fn(t.objectStore("snaps"));
          t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error);
        });
        res({
          all: week => tx("readonly", s => s.index("week").getAll(week)),
          add: rec => tx("readwrite", s => s.add(rec)),
          del: ids => tx("readwrite", s => { ids.forEach(id => s.delete(id)); }),
        });
      };
    }));
  }

  // 同一周的存取排队进行，免得两次 keep 同时比对「上一份」
  const queue = new Map();
  function serial(week, fn) {
    const p = (queue.get(week) || Promise.resolve()).then(fn).catch(() => {});
    queue.set(week, p); return p;
  }

  async function list(week) {
    const b = await pick();
    return (await b.all(week)).sort((x, y) => y.at - x.at || y.id - x.id);
  }

  // text 是这一周即将被换掉的那份全文。返回 Promise，调用方一般不用等
  function keep(week, text, reason) {
    if (!text || !text.trim()) return Promise.resolve();
    const at = Date.now();
    return serial(week, async () => {
      const b = await pick(), old = await list(week);
      if (old.length && same(old[0].text, text)) return;
      if (reason === "edit" && old.length && at - old[0].at < EDIT_GAP) return;
      await b.add({ week, at, reason, text });
      if (old.length + 1 > KEEP) await b.del(old.slice(KEEP - 1).map(r => r.id));
    });
  }

  return { keep, list, label: r => REASON[r] || r, flushed: week => queue.get(week) || Promise.resolve() };
})();
