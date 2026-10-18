// 条目合并的测试。运行：node tests/merge.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const ctx = vm.createContext({ window: {}, console });
for (const f of ["dates.js", "markdown.js", "merge.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8"), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
const MD = run("MD"), Merge = run("Merge");

const head = "---\nweek: 2026-W42\nstart: 2026-10-12\n---\n\n";
const mk = ({ goals = [], events = {}, diary = [], review = "" } = {}) => MD.parse(
  head + "## 周目标\n" + goals.map(g => `- [ ] ${g}`).join("\n") + "\n\n## 这周的事\n" +
  Object.entries(events).map(([d, l]) => `### 周${d}\n` + l.map(x => `- ${x}`).join("\n")).join("\n") +
  "\n\n## 日记\n### 10-18 周日\n" + diary.map(x => `- ${x}`).join("\n") + "\n\n## 复盘\n" + review + "\n");
const text = w => MD.serialize({ ...w, updated: null });
const merge = (b, a, s) => { const r = Merge.weeks(b, a, s); return { week: r.week, dropped: Array.from(r.dropped) }; };
const ev = r => Array.from(r.week.events, e => e.text);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("真实遇到过的冲突：两边内容相同、只有周日两条的顺序不同，没有 base → 零冲突，顺序跟服务器", () => {
  const server = mk({ events: { 日: ["做了网页", "部署服务", "开启加密"] }, diary: ["21:27 发布", "08:00 睡觉"] });
  const local = mk({ events: { 日: ["做了网页", "开启加密", "部署服务"] }, diary: ["21:27 发布", "08:00 睡觉"] });
  const r = merge(null, local, server);
  assert.deepStrictEqual(r.dropped, []);
  assert.strictEqual(text(r.week), text(server));
  assert.strictEqual(r.week.extra, "");
});
// 本机有真实日记文件（不进仓库）时，再用它验证一遍
const real = path.join(__dirname, "../2026-w42-f12.md");
if (fs.existsSync(real)) t("（本机文件）2026-w42-f12.md 里的真实冲突", () => {
  const [top, bottom] = fs.readFileSync(real, "utf8").split("## 冲突副本");
  const server = MD.parse(top);
  const local = MD.parse(head + bottom.split(String.fromCharCode(10)).slice(3).join(String.fromCharCode(10)).replace(/^##(#{2,})/gm, "$1"));
  const r = merge(null, local, server);
  assert.deepStrictEqual(r.dropped, []);
  assert.strictEqual(text(r.week), text(server));
});

const S0 = () => mk({ events: { 日: ["甲", "乙", "丙"] } });
t("只有服务器调整了顺序 → 用服务器的顺序", () => {
  const base = S0(), server = mk({ events: { 日: ["乙", "甲", "丙"] } });
  assert.strictEqual(text(merge(base, S0(), server).week), text(server));
});
t("只有本设备调整了顺序 → 用本设备的顺序", () => {
  const base = S0(), local = mk({ events: { 日: ["丙", "甲", "乙"] } });
  assert.strictEqual(text(merge(base, local, S0()).week), text(local));
});
t("两边都调整了顺序 → 以服务器为准", () => {
  const server = mk({ events: { 日: ["乙", "甲", "丙"] } }), local = mk({ events: { 日: ["丙", "甲", "乙"] } });
  assert.strictEqual(text(merge(S0(), local, server).week), text(server));
});
t("两边各加了不同的一条 → 都留下", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙", "丙", "本地新"] } }), mk({ events: { 日: ["甲", "乙", "丙", "服务器新"] } }));
  const names = ev(r).sort();
  assert.deepStrictEqual(names, ["丙", "乙", "甲", "服务器新", "本地新"].sort());
  assert.deepStrictEqual(r.dropped, []);
});
t("日记：两边在顶部各插一条 → 都留下，不冲突", () => {
  const b = ["10:00 旧"], a = ["12:00 手机写的", "10:00 旧"], s = ["11:00 电脑写的", "10:00 旧"];
  const r = merge(mk({ diary: b }), mk({ diary: a }), mk({ diary: s }));
  const day = Array.from(Object.values(r.week.days)[0], e => e.text);
  assert.deepStrictEqual(day.slice().sort(), ["旧", "手机写的", "电脑写的"].sort());
  assert.strictEqual(day.length, 3);
});
t("本地删了一条、服务器没动 → 删掉", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "丙"] } }), S0());
  assert.deepStrictEqual(ev(r), ["甲", "丙"]);
});
t("服务器删了一条、本地没动 → 删掉", () => {
  const r = merge(S0(), S0(), mk({ events: { 日: ["甲", "乙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙"]);
});
t("本地改了字、服务器没动 → 用本地改后的", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙改", "丙"] } }), S0());
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
  assert.deepStrictEqual(r.dropped, []);
});
t("服务器改了字、本地没动 → 用服务器改后的", () => {
  const r = merge(S0(), S0(), mk({ events: { 日: ["甲", "乙改", "丙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
});
t("同一条两边改成不同的字 → 以服务器为准，丢掉本地那条并报告", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙本地", "丙"] } }), mk({ events: { 日: ["甲", "乙服务器", "丙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙服务器", "丙"]);
  assert.strictEqual(r.dropped.length, 1);
  assert.ok(r.dropped[0].includes("乙本地"));
});
t("服务器删了一条、本地把它改了字 → 以服务器为准（删掉），并报告", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙改", "丙"] } }), mk({ events: { 日: ["甲", "丙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "丙"]);
  assert.strictEqual(r.dropped.length, 1);
});
t("本地改了一条的同时又新加了一条（不在同一个位置）→ 新加的不会被误丢", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙改", "丙", "新加"] } }), mk({ events: { 日: ["甲", "乙服务器", "丙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙服务器", "丙", "新加"]);
  assert.strictEqual(r.dropped.length, 1);
});
t("勾选：只有本地改了 → 用本地；两边都改了 → 服务器", () => {
  const g = d => MD.parse(head + `## 周目标\n- [${d}] 目标\n\n## 这周的事\n\n## 日记\n\n## 复盘\n`);
  assert.strictEqual(merge(g(" "), g("x"), g(" ")).week.goals[0].done, true);
  assert.strictEqual(merge(g(" "), g("x"), g("x")).week.goals[0].done, true);
  assert.strictEqual(merge(g("x"), g(" "), g("x")).week.goals[0].done, false);
});
t("复盘：只有本地改了 → 用本地；两边都改了 → 服务器", () => {
  assert.strictEqual(merge(mk({ review: "旧" }), mk({ review: "本地" }), mk({ review: "旧" })).week.review, "本地");
  assert.strictEqual(merge(mk({ review: "旧" }), mk({ review: "本地" }), mk({ review: "服务器" })).week.review, "服务器");
});
t("没有 base：只做并集，不传播删除", () => {
  const r = merge(null, mk({ events: { 日: ["甲", "丙"] } }), mk({ events: { 日: ["甲", "乙"] } }));
  assert.deepStrictEqual(ev(r).sort(), ["丙", "乙", "甲"].sort());
});
t("幂等：合并的结果再和自己合并，不变", () => {
  const r = merge(S0(), mk({ events: { 日: ["丙", "甲", "乙", "本地新"] } }), mk({ events: { 日: ["乙", "甲", "丙", "服务器新"] } })).week;
  assert.strictEqual(text(merge(r, r, r).week), text(r));
  assert.strictEqual(text(merge(null, r, r).week), text(r));
});
console.log(`\n${n} 项通过`);
