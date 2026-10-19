// 检查更新的测试：先 GitHub 后 Gitee、只有开了同步才自动查、一天最多一次、版本号比较。运行：node tests/updates.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const SRC = ["version.js", "updates.js"].map(f => fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8")).join("\n");

function open(ls = new Map()) {
  const c = vm.createContext({ window: {}, setTimeout, localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)) } });
  vm.runInContext(SRC + "\n;globalThis.U = Updates; globalThis.V = APP_VERSION;", c);
  return { U: c.U, V: c.V, ls };
}
const rel = (tag, extra = []) => ({ tag_name: tag, assets: [...extra, { name: "my-week.apk", browser_download_url: "https://x/" + tag + "/my-week.apk" }] });
// 假的网络：按地址决定返回什么或报错，并记下问了谁
function net(map) {
  const asked = [];
  const get = async url => { const k = url.includes("api.github.com") ? "github" : "gitee"; asked.push(k); const v = map[k]; if (v instanceof Error) throw v; return v; };
  return { get, asked };
}
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  " + name); };

(async () => {
  await t("version.js 的版本号和 package.json 一致", () => {
    assert.strictEqual(open().V, require("../package.json").version);
  });

  await t("版本号比较：按数字比，不按字符串；带不带 v 都行", () => {
    const { U } = open();
    assert.ok(U.newer("v0.3.10", "0.3.9"));
    assert.ok(U.newer("1.0.0", "0.9.9"));
    assert.ok(!U.newer("0.3.1", "v0.3.1"));
    assert.ok(!U.newer("0.3.0", "0.3.1"));
    assert.ok(!U.newer("乱写的", "0.3.1"));
  });

  await t("GitHub 能连上：用 GitHub 的版本和下载链接，不去问 Gitee", async () => {
    const { U } = open(), w = net({ github: rel("v0.3.2"), gitee: rel("v0.3.2") });
    const r = await U.check({ current: "0.3.1", get: w.get });
    assert.deepStrictEqual([r.update, r.version, r.source, r.url], [true, "0.3.2", "GitHub", "https://x/v0.3.2/my-week.apk"]);
    assert.deepStrictEqual(w.asked, ["github"]);
  });

  await t("GitHub 连不上 → 转 Gitee，下载链接用 Gitee 的", async () => {
    const { U } = open(), w = net({ github: new Error("连接被重置"), gitee: rel("v0.3.2", [{ name: "源码.zip", browser_download_url: "https://g/zip" }]) });
    const r = await U.check({ current: "0.3.1", get: w.get });
    assert.deepStrictEqual([r.source, r.url], ["Gitee", "https://x/v0.3.2/my-week.apk"]);
    assert.deepStrictEqual(w.asked, ["github", "gitee"]);
  });

  await t("GitHub 的发布里没有 APK（比如还在构建）→ 也转 Gitee", async () => {
    const { U } = open(), w = net({ github: { tag_name: "v0.3.2", assets: [] }, gitee: rel("v0.3.2") });
    assert.strictEqual((await U.check({ current: "0.3.1", get: w.get })).source, "Gitee");
  });

  await t("两边都连不上 → 报错，写明两边的原因", async () => {
    const { U } = open(), w = net({ github: new Error("超时"), gitee: new Error("返回 404") });
    await assert.rejects(U.check({ get: w.get }), e => e.message.includes("GitHub：超时") && e.message.includes("Gitee：返回 404"));
  });

  await t("自动检查：没开同步的用户一次都不联网", async () => {
    const { U } = open(), w = net({ github: rel("v9.9.9") });
    assert.strictEqual(await U.check({ auto: true, syncOn: false, get: w.get }), null);
    assert.deepStrictEqual(w.asked, []);
  });

  await t("自动检查：开了同步的用户一天最多查一次；手动「检查更新」不受限制", async () => {
    const { U } = open(), w = net({ github: rel("v0.3.2") }), day = 24 * 3600e3, t0 = 1_800_000_000_000;
    assert.ok(await U.check({ auto: true, syncOn: true, get: w.get, now: t0 }));
    assert.strictEqual(await U.check({ auto: true, syncOn: true, get: w.get, now: t0 + day - 1 }), null);
    assert.ok(await U.check({ get: w.get, now: t0 + 1000 }), "手动检查");
    assert.ok(await U.check({ auto: true, syncOn: true, get: w.get, now: t0 + 1000 + day }));
    assert.strictEqual(w.asked.length, 3);
  });

  await t("提示条：有新版本才提示；点了「这一版先不提醒」就不再提示这一版，出了更新的版本再提示", async () => {
    const { U } = open();
    await U.check({ current: "0.3.1", get: net({ github: rel("v0.3.1") }).get });
    assert.strictEqual(U.pending("0.3.1"), null, "已经是最新");
    await U.check({ current: "0.3.1", get: net({ github: rel("v0.3.2") }).get });
    assert.strictEqual(U.pending("0.3.1").version, "0.3.2");
    U.dismiss("0.3.2");
    assert.strictEqual(U.pending("0.3.1"), null);
    await U.check({ current: "0.3.1", get: net({ github: rel("v0.3.3") }).get });
    assert.strictEqual(U.pending("0.3.1").version, "0.3.3");
    assert.strictEqual(U.pending("0.3.3"), null, "装好新版本后不再提示");
  });

  console.log(`\n${n} 项通过`);
})().catch(e => { console.error("失败：", e); process.exit(1); });
