// 和 VPS 同步。每周一个 .md，服务器给每个版本一个版本号。
//
// 每台设备给每一周记两件事：base（上次和服务器对上时的版本号）和 dirty（之后本地改过没有）。
//   - 本地没改、服务器版本变了 → 拉下来
//   - 本地改过 → 带着 base 推上去；服务器发现 base 已经过时就回 409，
//     这时以服务器版本为准，把本地这份追加成「冲突副本」段落，再推上去。内容不会丢。
// 触发：每 30 秒、切回页面、恢复联网、本地保存后 2 秒。
//
// 端到端加密（crypto.js）：账号开了加密后，推上去的是密文，拉下来先解密；
// 这台设备有没有密钥、密钥对不对，每轮同步开始时对照服务器的 /api/meta 检查一遍。
// 设备上有密钥 = 想要加密：账号还没开的话，这台设备会替它开启，并把所有周重新加密上传。
const Sync = (() => {
  const CFG = "myweek-sync-cfg", META = "myweek-sync:";
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let cfg = load(CFG) || { server: "", token: "" };
  let running = false, again = false, timer = null, lastOk = null, onStatus = () => {}, notice = "";
  let acct = { e2ee: false };   // 服务器上的账号设置，每轮同步刷新

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
    const blob = await r.text(), ver = r.headers.get("ETag");
    if (Store.pending(id) || meta(id).dirty) return;          // 拉的过程中又改了，下轮再说
    const plain = E2EE.isEncrypted(blob);
    let w;
    try { w = MD.parse(plain ? await E2EE.decrypt(blob, id) : blob); }
    catch (e) { notice = `服务器上的 ${id} 读不出来（${e.message}），这一周先跳过，其他照常同步`; return; }
    await Store.replace(w);
    // 账号开了加密，服务器上却还是明文（开启加密前留下的）：标成要推，下一步就会加密覆盖掉
    setMeta(id, { base: ver, dirty: acct.e2ee && !plain }); tally.pulled++;
  }

  async function push(id, attempt = 0) {
    const w = Store.byId(id) || Store.get(MD.startOfIsoWeek(id));   // 本地删空了的周也要推，免得服务器上的旧内容又被拉回来
    const m = meta(id), text = MD.serialize(w);
    const headers = { "Content-Type": "text/markdown; charset=utf-8" };
    if (m.base) headers["If-Match"] = m.base;
    const body = acct.e2ee ? await E2EE.encrypt(text, id) : text;
    const r = await api("/api/weeks/" + id, { method: "PUT", headers, body });
    if (r.ok) {
      const { version } = await r.json();
      // 推的过程中又改了的话，保持 dirty，下轮再推
      setMeta(id, { base: version, dirty: Store.pending(id) || MD.serialize(Store.byId(id) || w) !== text });
      tally.pushed++; return;
    }
    if (r.status === 409 && attempt < 2) {
      const { version, text: blob } = await r.json();
      const srv = E2EE.isEncrypted(blob) ? await E2EE.decrypt(blob, id) : blob;   // 在设备上解开再合并
      if (sameContent(srv, text)) { setMeta(id, { base: version, dirty: false }); return; }
      const sw = MD.parse(srv), stamp = new Date().toLocaleString("zh-CN", { hour12: false });
      sw.extra = [sw.extra, `## 冲突副本 · ${stamp}\n这一周在两台设备上同时改过。上面是服务器上的版本，下面是本设备的版本，请手动合并后删掉这一段。\n\n${asCopy(text)}`]
        .filter(Boolean).join("\n\n");
      await Store.replace(sw);
      setMeta(id, { base: version, dirty: true });
      notice = `${id} 在两台设备上都改过，已存成「冲突副本」，在那周页面的最下面`;
      return push(id, attempt + 1);
    }
    if (r.status === 422) throw new Error("服务器拒收明文：这个账号开了加密，请先在下面输入恢复码");
    throw new Error("推送失败 " + r.status);
  }

  // 对照服务器上的账号设置，确认这台设备能不能、该不该加密。返回 true 表示刚刚替账号开启了加密。
  async function checkAccount() {
    await E2EE.ready;
    const r = await api("/api/meta");
    acct = r.ok ? await r.json() : { e2ee: false };   // 旧版服务器没有 /api/meta，就当没开加密
    if (acct.e2ee) {
      if (!E2EE.enabled) { const e = new Error("这个账号开了端到端加密，请在下面输入恢复码"); e.code = "need-key"; throw e; }
      if (E2EE.keyId !== acct.keyId) { const e = new Error("这台设备上的密钥和账号对不上，请重新输入恢复码"); e.code = "need-key"; throw e; }
      return false;
    }
    if (!E2EE.enabled) return false;
    // 设备上有密钥、账号还没开：替账号开启
    const p = await api("/api/meta", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e2ee: true, keyId: E2EE.keyId }) });
    if (p.status === 409) { E2EE.forget(); const e = new Error("这个账号已经用另一把密钥加密了，请输入那把密钥的恢复码"); e.code = "need-key"; throw e; }
    if (!p.ok) throw new Error("开启加密失败 " + p.status);
    acct = await p.json();
    return true;
  }

  // 返回这一轮的结果：{ ok, pulled, pushed, error, notice }
  async function run() {
    if (!cfg.token) return { ok: false, error: "令牌一栏是空的。如果框里显示了圆点，可能是浏览器自动填的、页面读不到，请删掉重新粘贴" };
    if (base() === null) return { ok: false, error: "请填上同步服务器的地址（以 https:// 开头）" };
    if (running) { again = true; return { ok: true, busy: true }; }
    if (!navigator.onLine) { onStatus("离线中，联网后自动同步", "off"); return { ok: false, error: "现在没联网" }; }
    running = true; clearTimeout(timer); tally = { pulled: 0, pushed: 0 };
    let result;
    try {
      const justEnabled = await checkAccount();
      const r = await api("/api/weeks");
      if (!r.ok) throw new Error("服务器返回 " + r.status);
      const remote = new Map((await r.json()).weeks.map(x => [x.week, x.version]));
      // 第一次在这台设备上开同步：本地已有、但从没同步过的周，当作本地改动推上去
      for (const id of Store.localIds()) { const m = meta(id); if (!m.base && !m.dirty) markDirty(id); }
      for (const [id, ver] of remote) {
        const m = meta(id);
        if (!m.dirty && !Store.pending(id) && m.base !== ver) await pull(id);
      }
      // 刚开启加密：服务器上每一周都要换成密文
      if (justEnabled) { for (const id of new Set([...remote.keys(), ...Store.localIds()])) markDirty(id); notice = "已开启端到端加密，服务器上的数据都换成了密文"; }
      for (const id of dirtyIds()) if (!Store.pending(id)) await push(id);
      lastOk = new Date(); result = { ok: true, ...tally, notice }; onStatus(notice, notice ? "warn" : ""); notice = "";
    } catch (e) {
      const msg = e.message === "Failed to fetch" ? "连不上服务器" : e.message;
      result = { ok: false, error: msg, code: e.code }; onStatus("同步没成功：" + msg, "err");
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
    get account() { return { ...acct }; },

    // 在新设备上输入恢复码。账号已开加密时，先确认指纹对得上再装入
    async useRecoveryCode(code) {
      const id = await E2EE.idOfCode(code);
      if (acct.e2ee && acct.keyId && id !== acct.keyId) throw new Error("这个恢复码和账号的密钥对不上");
      await E2EE.useCode(code);
    },
    get needsServer() { return IS_APP || !location.protocol.startsWith("http"); },
    hooks(h) { onStatus = h.onStatus || onStatus; },
  };
})();
