// 和 VPS 同步。每周一个 .md，服务器给每个版本一个版本号。
//
// 每台设备给每一周记两件事：base（上次和服务器对上时的版本号）和 dirty（之后本地改过没有）。
//   - 本地没改、服务器版本变了 → 拉下来
//   - 本地改过 → 带着 base 推上去；服务器发现 base 已经过时就回 409，
//     这时以服务器版本为准，把本地这份追加成「冲突副本」段落，再推上去。内容不会丢。
// 触发：每 30 秒、切回页面、恢复联网、本地保存后 2 秒。
const Sync = (() => {
  const CFG = "myweek-sync-cfg", META = "myweek-sync:";
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let cfg = load(CFG) || { server: "", token: "" };
  let running = false, again = false, timer = null, lastOk = null, onStatus = () => {}, notice = "";

  const meta = id => load(META + id) || { base: null, dirty: false };
  const setMeta = (id, m) => store(META + id, m);
  // 页面是从服务器打开的就用同一个地址；本地打开的页面需要填服务器地址
  const base = () => (cfg.server || "").replace(/\/+$/, "") || (location.protocol.startsWith("http") && !IS_APP ? "" : null);
  const enabled = () => !!cfg.token && base() !== null;

  async function api(path, opts = {}) {
    const r = await fetch(base() + path, {
      ...opts, cache: "no-store",
      headers: { Authorization: "Bearer " + cfg.token, ...(opts.headers || {}) },
    });
    if (r.status === 401) throw new Error("令牌不对");
    return r;
  }

  function dirtyIds() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(META) && meta(k.slice(META.length)).dirty) out.push(k.slice(META.length)); } } catch (e) {}
    return out;
  }
  function markDirty(id) {
    const m = meta(id); if (!m.dirty) { m.dirty = true; setMeta(id, m); }
  }
  function soon(ms = 2000) { clearTimeout(timer); timer = setTimeout(run, ms); }

  // 去掉 front matter，把标题降两级，作为冲突副本塞进文件末尾（解析时会原样保留）
  function asCopy(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
      .split("\n").map(l => l.replace(/^(#{2,})(\s)/, "##$1$2")).join("\n");
  }
  const sameContent = (a, b) => a.replace(/^updated:.*$/m, "") === b.replace(/^updated:.*$/m, "");

  let tally = { pulled: 0, pushed: 0 };
  async function pull(id) {
    const r = await api("/api/weeks/" + id);
    if (r.status === 404) return;
    if (!r.ok) throw new Error("拉取失败 " + r.status);
    const text = await r.text(), ver = r.headers.get("ETag");
    if (Store.pending(id) || meta(id).dirty) return;          // 拉的过程中又改了，下轮再说
    let w;
    try { w = MD.parse(text); }
    catch (e) { notice = `服务器上的 ${id}.md 格式读不懂（${e.message}），这一周先跳过，其他照常同步`; return; }
    await Store.replace(w);
    setMeta(id, { base: ver, dirty: false }); tally.pulled++;
  }

  async function push(id, attempt = 0) {
    const w = Store.byId(id) || Store.get(MD.startOfIsoWeek(id));   // 本地删空了的周也要推，免得服务器上的旧内容又被拉回来
    const m = meta(id), text = MD.serialize(w);
    const headers = { "Content-Type": "text/markdown; charset=utf-8" };
    if (m.base) headers["If-Match"] = m.base;
    const r = await api("/api/weeks/" + id, { method: "PUT", headers, body: text });
    if (r.ok) {
      const { version } = await r.json();
      // 推的过程中又改了的话，保持 dirty，下轮再推
      setMeta(id, { base: version, dirty: Store.pending(id) || MD.serialize(Store.byId(id) || w) !== text });
      tally.pushed++; return;
    }
    if (r.status === 409 && attempt < 2) {
      const { version, text: srv } = await r.json();
      if (sameContent(srv, text)) { setMeta(id, { base: version, dirty: false }); return; }
      const sw = MD.parse(srv), stamp = new Date().toLocaleString("zh-CN", { hour12: false });
      sw.extra = [sw.extra, `## 冲突副本 · ${stamp}\n这一周在两台设备上同时改过。上面是服务器上的版本，下面是本设备的版本，请手动合并后删掉这一段。\n\n${asCopy(text)}`]
        .filter(Boolean).join("\n\n");
      await Store.replace(sw);
      setMeta(id, { base: version, dirty: true });
      notice = `${id} 在两台设备上都改过，已存成「冲突副本」，在那周页面的最下面`;
      return push(id, attempt + 1);
    }
    throw new Error("推送失败 " + r.status);
  }

  // 返回这一轮的结果：{ ok, pulled, pushed, error, notice }
  async function run() {
    if (!cfg.token) return { ok: false, error: "令牌一栏是空的。如果框里显示了圆点，可能是浏览器自动填的、页面读不到，请删掉重新粘贴" };
    if (base() === null) return { ok: false, error: "请填上同步服务器的地址（以 https:// 开头）" };
    if (running) { again = true; return { ok: true, busy: true }; }
    if (!navigator.onLine) { onStatus("离线中，联网后自动同步"); return { ok: false, error: "现在没联网" }; }
    running = true; clearTimeout(timer); tally = { pulled: 0, pushed: 0 };
    let result;
    try {
      const r = await api("/api/weeks");
      if (!r.ok) throw new Error("服务器返回 " + r.status);
      const remote = new Map((await r.json()).weeks.map(x => [x.week, x.version]));
      // 第一次在这台设备上开同步：本地已有、但从没同步过的周，当作本地改动推上去
      for (const id of Store.localIds()) { const m = meta(id); if (!m.base && !m.dirty) markDirty(id); }
      for (const [id, ver] of remote) {
        const m = meta(id);
        if (!m.dirty && !Store.pending(id) && m.base !== ver) await pull(id);
      }
      for (const id of dirtyIds()) if (!Store.pending(id)) await push(id);
      lastOk = new Date(); result = { ok: true, ...tally, notice }; onStatus(notice); notice = "";
    } catch (e) {
      const msg = e.message === "Failed to fetch" ? "连不上服务器" : e.message;
      result = { ok: false, error: msg }; onStatus("同步没成功：" + msg);
    } finally {
      running = false;
      if (again) { again = false; soon(500); } else soon(30000);
    }
    return result;
  }

  return {
    get cfg() { return { ...cfg }; },
    configure(c) { cfg = { server: (c.server || "").trim(), token: (c.token || "").trim() }; store(CFG, cfg); },
    enabled, markDirty, soon, run,
    get lastOk() { return lastOk; },
    get needsServer() { return IS_APP || !location.protocol.startsWith("http"); },
    hooks(h) { onStatus = h.onStatus || onStatus; },
  };
})();
