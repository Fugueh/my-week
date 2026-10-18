// 同步 + 合并的端到端测试：假服务器（内存里）+ 两台假设备。运行：node tests/sync.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), nodeCrypto = require("crypto");

function server() {
  const files = new Map(); let n = 0;
  const ver = t => nodeCrypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
  const meta = { e2ee: false };
  return {
    files, meta,
    async fetch(url, opts = {}) {
      const u = new URL(url, "http://x"), m = u.pathname.match(/^\/api\/weeks\/(.+)$/);
      const res = (status, body, headers = {}) => ({ status, ok: status < 400, headers: { get: k => headers[k] || null }, json: async () => body, text: async () => body });
      if (u.pathname === "/api/meta") {
        if (opts.method === "PUT") { const b = JSON.parse(opts.body); if (meta.e2ee && b.keyId !== meta.keyId) return res(409, {}); Object.assign(meta, b); }
        return res(200, { ...meta });
      }
      if (u.pathname === "/api/weeks") return res(200, { weeks: [...files].map(([week, t]) => ({ week, version: ver(t) })) });
      const id = m[1], cur = files.get(id);
      if (opts.method === "PUT" && meta.e2ee && !opts.body.startsWith("MYWEEK-E2EE/1 ")) return res(422, { error: "不收明文" });
      if (!opts.method || opts.method === "GET") return cur == null ? res(404, "") : res(200, cur, { ETag: ver(cur) });
      const body = opts.body, ifm = opts.headers && opts.headers["If-Match"];
      if (cur != null && ifm !== ver(cur) && cur !== body) return res(409, { error: "conflict", version: ver(cur), text: cur });
      files.set(id, body); n++; return res(200, { week: id, version: ver(body) }, { ETag: ver(body) });
    },
  };
}

function device(srv, name) {
  const ls = new Map();
  const ctx = vm.createContext({
    window: {}, console: { log() {}, warn() {}, error: console.error },
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k),
                    key: i => [...ls.keys()][i], get length() { return ls.size; } },
    navigator: { onLine: true }, location: { protocol: "https:" }, fetch: (u, o) => srv.fetch(u, o),
    crypto: nodeCrypto.webcrypto, TextEncoder, TextDecoder, btoa, atob, setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
  });
  for (const f of ["dates.js", "markdown.js", "merge.js", "crypto.js", "store.js", "sync.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8"), ctx, { filename: f });
  const run = c => vm.runInContext(c, ctx);
  run('Sync.configure({ server: "https://srv", token: "t" })');
  return {
    name, ls, run,
    sync: () => run("Sync.run()"),
    edit(fn) { run(`(() => { const w = Store.byId("2026-W42") || Store.get("2026-10-12"); (${fn.toString()})(w); Store.save(w, { now: true }); Sync.markDirty("2026-W42"); })()`); },
    items: () => JSON.parse(run('JSON.stringify(Store.byId("2026-W42").events.map(e => e.text))')),
  };
}

const MD0 = "---\nweek: 2026-W42\nstart: 2026-10-12\n---\n\n## 周目标\n\n## 这周的事\n### 周日\n- 甲\n- 乙\n\n## 日记\n\n## 复盘\n";
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  " + name); };

(async () => {
  await t("两台设备各加一条，先后同步 → 两边都有，没有冲突副本，最后一致", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => w.events.push({ id: "x1", wd: 6, text: "手机加的" }));
    b.edit(w => w.events.push({ id: "x2", wd: 6, text: "电脑加的" }));
    assert.strictEqual((await a.sync()).ok, true);
    const rb = await b.sync();
    assert.strictEqual(rb.ok, true, JSON.stringify(rb));
    await a.sync();
    const want = ["乙", "手机加的", "电脑加的", "甲"].sort();
    assert.deepStrictEqual(a.items().slice().sort(), want);
    assert.deepStrictEqual(b.items().slice().sort(), want);
    assert.ok(!s.files.get("2026-W42").includes("冲突副本"));
    assert.strictEqual(a.run('Store.byId("2026-W42").extra'), "");
  });

  await t("同一条两边改成不同的字 → 以服务器（先到的）为准，后到的设备提示丢了哪一条", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => { w.events.find(e => e.text === "乙").text = "乙·手机"; });
    b.edit(w => { w.events.find(e => e.text === "乙").text = "乙·电脑"; });
    await a.sync();
    const rb = await b.sync();
    assert.ok(rb.notice && rb.notice.includes("乙·电脑"), "应提示丢掉了电脑上的这条：" + rb.notice);
    assert.deepStrictEqual(b.items().slice().sort(), ["乙·手机", "甲"].sort());
  });

  await t("本地删了一条，另一台没动 → 同步后两边都没有", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => { w.events = w.events.filter(e => e.text !== "乙"); });
    b.edit(w => w.events.push({ id: "x3", wd: 6, text: "电脑加的" }));
    await a.sync(); await b.sync(); await a.sync();
    assert.deepStrictEqual(a.items().slice().sort(), ["电脑加的", "甲"].sort());
    assert.deepStrictEqual(b.items().slice().sort(), ["电脑加的", "甲"].sort());
  });

  await t("账号开了加密、服务器上还是明文、本地内容相同 → 不能当作已一致，要把密文推上去", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机");
    await a.sync();
    await a.run('E2EE.newCode().then(c => E2EE.useCode(c))');
    const r = await a.sync();                       // 设备替账号开启加密，并把所有周重新加密上传
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(s.files.get("2026-W42").startsWith("MYWEEK-E2EE/1 "), "服务器上应该是密文");
  });

  await t("409 且内容相同，但服务器上是明文、账号已开加密 → 仍然要推密文（修掉之前的疑点）", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机");
    await a.sync();
    await a.run("E2EE.newCode().then(c => E2EE.useCode(c))");
    s.meta.e2ee = true; s.meta.keyId = a.run("E2EE.keyId");
    s.files.set("2026-W42", MD0.replace("start:", "updated: 2026-10-18T00:00:00.000Z\nstart:"));   // 内容一样，版本号不同
    a.run('Sync.markDirty("2026-W42")');
    const r = await a.sync();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(s.files.get("2026-W42").startsWith("MYWEEK-E2EE/1 "), "服务器上应该是密文");
  });

  console.log(`\n${n} 项通过`);
})().catch(e => { console.error("失败：", e); process.exit(1); });
