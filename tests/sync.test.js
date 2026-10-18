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

function device(srv, name, { setTimeout: st = () => 0, fetch: f } = {}) {
  const ls = new Map();
  const ctx = vm.createContext({
    window: {}, console: { log() {}, warn() {}, error: console.error },
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k),
                    key: i => [...ls.keys()][i], get length() { return ls.size; } },
    navigator: { onLine: true }, location: { protocol: "https:" }, fetch: f || ((u, o) => srv.fetch(u, o)),
    crypto: nodeCrypto.webcrypto, TextEncoder, TextDecoder, btoa, atob, setTimeout: st, clearTimeout() {}, addEventListener() {},
  });
  for (const f of ["dates.js", "markdown.js", "merge.js", "crypto.js", "history.js", "store.js", "sync.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8"), ctx, { filename: f });
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

  await t("同一条两边改成不同的字 → 后推送的设备为准，两边最后一致，后推送的一边提示被替换的条目", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => { w.events.find(e => e.text === "乙").text = "乙·手机"; });
    b.edit(w => { w.events.find(e => e.text === "乙").text = "乙·电脑"; });
    await a.sync();                                  // 手机先到服务器
    const rb = await b.sync();                       // 电脑后到：以电脑为准
    assert.strictEqual(rb.ok, true, JSON.stringify(rb));
    assert.ok(rb.notice && rb.notice.includes("乙·手机"), "应该提示另一台的版本被替换：" + rb.notice);
    await a.sync();
    assert.deepStrictEqual(b.items().slice().sort(), ["乙·电脑", "甲"].sort());
    assert.deepStrictEqual(a.items().slice().sort(), ["乙·电脑", "甲"].sort());
    assert.ok(!s.files.get("2026-W42").includes("冲突副本"));
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

  await t("合并时出错 → 本地内容原样保留、仍待上传，报错；别的周照常推送", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => w.events.push({ id: "x1", wd: 6, text: "手机加的" }));
    await a.sync();
    b.edit(w => w.events.push({ id: "x2", wd: 6, text: "电脑加的" }));
    b.run('(() => { const w = Store.get("2026-10-19"); w.goals.push({ text: "下周的目标", done: false }); Store.save(w, { now: true }); Sync.markDirty("2026-W43"); })()');
    b.run('Merge.weeks = () => { throw new Error("测试用的故障"); }');
    const before = s.files.get("2026-W42");
    const rb = await b.sync();
    assert.strictEqual(rb.ok, false);
    assert.ok(rb.error.includes("合并失败") && rb.error.includes("2026-W42"), rb.error);
    assert.deepStrictEqual(b.items().slice().sort(), ["乙", "甲", "电脑加的"].sort(), "本地改动不能被服务器的版本换掉");
    assert.strictEqual(s.files.get("2026-W42"), before, "服务器上的这一周不该被动");
    assert.ok((s.files.get("2026-W43") || "").includes("下周的目标"), "另一周应该照常推上去");
    assert.strictEqual(b.run("Sync.pendingCount"), 1, "合并失败的那一周仍然待上传");
  });

  await t("请求一直不返回 → 超时报错，之后能开始下一轮", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const timers = [];
    const a = device(s, "手机", {
      setTimeout: (fn, ms) => { if (ms === 15000) timers.push(fn); return 0; },   // 只让请求超时的计时器生效
      fetch: (u, o) => u.endsWith("/api/weeks") ? new Promise(() => {}) : s.fetch(u, o),
    });
    const p = a.sync();
    for (let i = 0; i < 20 && timers.length < 2; i++) await new Promise(r => setImmediate(r));
    assert.strictEqual(timers.length, 2, "/api/meta 和 /api/weeks 都应该设了超时");
    timers[1]();                                      // /api/weeks 那个请求超时
    const r = await p;
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes("没有响应"), r.error);
    const next = a.sync();
    for (let i = 0; i < 20 && timers.length < 4; i++) await new Promise(r => setImmediate(r));
    assert.strictEqual(timers.length, 4, "超时后应该真的开始了下一轮，而不是一直 busy");
    timers[3](); await next;
  });

  await t("待上传周数：改了之后是 1，同步完是 0", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机");
    await a.sync();
    assert.strictEqual(a.run("Sync.pendingCount"), 0);
    a.edit(w => w.events.push({ id: "x1", wd: 6, text: "新的" }));
    assert.strictEqual(a.run("Sync.pendingCount"), 1);
    await a.sync();
    assert.strictEqual(a.run("Sync.pendingCount"), 0);
  });

  await t("还在 600ms 防抖里的改动，flush 后立刻在本机存储里", async () => {
    const a = device(server(), "手机");
    a.run('(() => { const w = Store.get("2026-10-12"); w.goals.push({ text: "刚打的字", done: false }); Store.save(w); })()');
    assert.strictEqual(a.ls.get("myweek:2026-W42"), undefined, "防抖期间还没写");
    a.run("Store.flush()");
    assert.ok((a.ls.get("myweek:2026-W42") || "").includes("刚打的字"));
    assert.strictEqual(a.run('Store.pending("2026-W42")'), false);
  });

  /* ---- 本地快照 ---- */
  const snaps = async d => { await d.run('Snap.flushed("2026-W42")'); return JSON.parse(JSON.stringify(await d.run('Snap.list("2026-W42")'))); };

  await t("快照：拉取服务器的版本之前，本机原来那份先存下来", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    b.edit(w => { w.events = w.events.filter(e => e.text !== "乙"); });
    await b.sync();
    await a.sync();                                   // 手机拉下来：乙没了
    assert.deepStrictEqual(a.items(), ["甲"]);
    const l = await snaps(a);
    assert.strictEqual(l.length, 1);
    assert.strictEqual(l[0].reason, "pull");
    assert.ok(l[0].text.includes("- 乙"), "快照里应该还有乙");
  });

  await t("快照：同一条被两边改，服务器上被替换的那一版存成快照，同步记录里写明被替换的条目", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    a.edit(w => { w.events.find(e => e.text === "乙").text = "乙·手机"; });
    b.edit(w => { w.events.find(e => e.text === "乙").text = "乙·电脑"; });
    await a.sync(); await b.sync();
    const l = await snaps(b);
    const srv = l.find(x => x.reason === "server");
    assert.ok(srv && srv.text.includes("乙·手机"), "手机的版本应该能在电脑的历史版本里找到");
    assert.ok(l.some(x => x.reason === "merge" && x.text.includes("乙·电脑")), "合并之前本机那份也要存");
    const log = b.run("JSON.stringify(Sync.log)");
    assert.ok(JSON.parse(log).some(x => x.kind === "merge" && x.text.includes("乙·手机")), log);
  });

  await t("恢复旧版：内容换回去、算本地改动、同步到服务器；恢复前的内容也留了快照", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    const a = device(s, "手机"), b = device(s, "电脑");
    await a.sync(); await b.sync();
    b.edit(w => { w.events = w.events.filter(e => e.text !== "乙"); });   // 电脑误删了乙
    await b.sync(); await a.sync();
    assert.deepStrictEqual(a.items(), ["甲"]);
    const old = (await snaps(a)).find(x => x.reason === "pull");
    await a.run(`Store.restore("2026-W42", ${JSON.stringify(old.text)})`); a.run('Sync.markDirty("2026-W42")');
    assert.deepStrictEqual(a.items().slice().sort(), ["乙", "甲"].sort());
    assert.strictEqual(a.run("Sync.pendingCount"), 1);
    await a.sync(); await b.sync();
    assert.deepStrictEqual(b.items().slice().sort(), ["乙", "甲"].sort(), "恢复的内容应该同步到另一台");
    const before = (await snaps(a)).find(x => x.reason === "restore");
    assert.ok(before && !before.text.includes("- 乙"), "恢复之前那份（只有甲）也要存，万一恢复错了还能回来");
  });

  await t("快照：自己编辑每 10 分钟最多一份；和上一份一样的不重复存；每周最多 30 份", async () => {
    const a = device(server(), "手机");
    let now = 1_800_000_000_000; a.run(`Date.now = () => globalThis.__now`); a.run(`globalThis.__now = ${now}`);
    const add = txt => a.run(`(() => { const w = Store.get("2026-10-12"); w.goals.push({ text: ${JSON.stringify(txt)}, done: false }); return Store.save(w, { now: true }); })()`);
    await add("一"); await add("二"); await add("三");  // 第一次写入前本机是空的，不存；之后 10 分钟内只存一份
    let l = await snaps(a);
    assert.strictEqual(l.length, 1, JSON.stringify(l.map(x => x.text)));
    a.run(`globalThis.__now = ${now += 11 * 60 * 1000}`);
    await add("四");
    l = await snaps(a);
    assert.strictEqual(l.length, 2);
    assert.ok(l[0].text.includes("三") && !l[0].text.includes("四"), "存的是这次编辑之前的样子");
    for (let i = 0; i < 40; i++) { a.run(`globalThis.__now = ${now += 11 * 60 * 1000}`); await add("多" + i); }
    assert.strictEqual((await snaps(a)).length, 30);
  });

  /* ---- 同步记录 ---- */
  await t("同步记录：上传、下载各记一条；什么都没发生的轮次不记；同样的错误连着出现只记一条带次数", async () => {
    const s = server(); s.files.set("2026-W42", MD0);
    let down = false;
    const a = device(s, "手机", { fetch: (u, o) => down ? Promise.reject(new Error("Failed to fetch")) : s.fetch(u, o) });
    await a.sync();
    a.edit(w => w.events.push({ id: "x1", wd: 6, text: "新的" }));
    await a.sync(); await a.sync(); await a.sync();
    let log = JSON.parse(a.run("JSON.stringify(Sync.log)"));
    assert.deepStrictEqual(log.map(x => x.kind), ["push", "pull"], JSON.stringify(log));
    down = true; await a.sync(); await a.sync(); await a.sync();
    log = JSON.parse(a.run("JSON.stringify(Sync.log)"));
    assert.strictEqual(log[0].kind, "error");
    assert.strictEqual(log[0].n, 3);
    assert.ok(log[0].text.includes("连不上服务器"));
    assert.strictEqual(log.length, 3);
    a.run("Sync.clearLog()");
    assert.strictEqual(JSON.parse(a.run("JSON.stringify(Sync.log)")).length, 0);
  });

  console.log(`\n${n} 项通过`);
})().catch(e => { console.error("失败：", e); process.exit(1); });
